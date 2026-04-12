import { Router, type Request, type Response } from 'express';

import type Database from 'better-sqlite3';

// ── Local Embedding Pipeline (singleton) ─────────────────────────────────────

let extractorPromise: Promise<any> | null = null;

async function getExtractor() {
    if (!extractorPromise) {
        extractorPromise = (async () => {
            const { pipeline } = await import('@huggingface/transformers');
            console.log(
                '[dedup] Loading embedding model (first time may download ~80MB)...'
            );
            const ext = await pipeline(
                'feature-extraction',
                'Xenova/all-MiniLM-L6-v2',
                {
                    dtype: 'fp32'
                }
            );
            console.log('[dedup] Embedding model ready');
            return ext;
        })();
    }
    return extractorPromise;
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
}

// Union-Find for clustering
class UnionFind {
    parent: number[];
    rank: number[];
    constructor(n: number) {
        this.parent = Array.from({ length: n }, (_, i) => i);
        this.rank = Array.from({ length: n }, () => 0);
    }
    find(x: number): number {
        if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
        return this.parent[x];
    }
    union(x: number, y: number) {
        const rx = this.find(x),
            ry = this.find(y);
        if (rx === ry) return;
        if (this.rank[rx] < this.rank[ry]) this.parent[rx] = ry;
        else if (this.rank[rx] > this.rank[ry]) this.parent[ry] = rx;
        else {
            this.parent[ry] = rx;
            this.rank[rx]++;
        }
    }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface DuplicateCluster {
    nodes: Array<{
        id: number;
        name: string;
        description: string | null;
        node_type: string;
        status: string;
        edge_count: number;
        parent_name: string | null;
    }>;
    max_similarity: number;
}

// ── Core Logic ───────────────────────────────────────────────────────────────

interface ScanResult {
    clusters: DuplicateCluster[];
    // Thresholds (in 1% steps) that would yield ≥1 cluster, sorted descending
    available_thresholds: number[];
}

async function findDuplicateClusters(
    db: Database.Database,
    projectId: number,
    threshold: number = 0.85
): Promise<ScanResult> {
    const nodes = db
        .prepare(
            `SELECT n.id, n.name, n.description, n.node_type, n.status,
       (SELECT COUNT(*) FROM onto_edges e WHERE e.source_node_id = n.id OR e.target_node_id = n.id) as edge_count,
       p.name as parent_name
     FROM onto_nodes n
     LEFT JOIN onto_nodes p ON n.parent_id = p.id
     WHERE n.project_id = ?`
        )
        .all(projectId) as any[];

    if (nodes.length < 2) return { clusters: [], available_thresholds: [] };

    // Load dismissed pairs (node pairs user already marked as "not duplicates")
    const dismissals = db
        .prepare(
            `SELECT node_a_id, node_b_id FROM onto_dedup_dismissals WHERE project_id = ?`
        )
        .all(projectId) as Array<{ node_a_id: number; node_b_id: number }>;
    const dismissedSet = new Set(
        dismissals.map(
            d =>
                `${Math.min(d.node_a_id, d.node_b_id)}-${Math.max(d.node_a_id, d.node_b_id)}`
        )
    );

    // Build node ID index for fast pair lookups
    const nodeIdToIdx = new Map<number, number>();
    nodes.forEach((n: any, i: number) => nodeIdToIdx.set(n.id, i));

    // Build text for embedding: "name: description" or just "name"
    const texts = nodes.map(n =>
        n.description ? `${n.name}: ${n.description}` : n.name
    );

    // Get embeddings
    const extractor = await getExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });

    // Extract float arrays from the Tensor
    const embeddings: number[][] = [];
    const data = output.data as Float32Array;
    const dims = output.dims as number[]; // [n, 384]
    const embDim = dims[1];
    for (let i = 0; i < nodes.length; i++) {
        embeddings.push(Array.from(data.slice(i * embDim, (i + 1) * embDim)));
    }

    // Compute ALL pairwise similarities above 50%, excluding dismissed pairs
    const allPairs: Array<{ i: number; j: number; sim: number }> = [];
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            // Skip if different node types (don't mix classes and individuals)
            if (nodes[i].node_type !== nodes[j].node_type) continue;

            // Skip if this pair was dismissed
            const aId = Math.min(nodes[i].id, nodes[j].id);
            const bId = Math.max(nodes[i].id, nodes[j].id);
            if (dismissedSet.has(`${aId}-${bId}`)) continue;

            const sim = dotProduct(embeddings[i], embeddings[j]);
            if (sim >= 0.5) {
                allPairs.push({ i, j, sim });
            }
        }
    }

    // Compute available thresholds (which 1% steps have clusters)
    const available_thresholds: number[] = [];
    for (let pct = 99; pct >= 50; pct--) {
        const t = pct / 100;
        const ufCheck = new UnionFind(nodes.length);
        for (const p of allPairs) {
            if (p.sim >= t) ufCheck.union(p.i, p.j);
        }
        // Check if any cluster has 2+ members
        const roots = new Map<number, number>();
        for (let k = 0; k < nodes.length; k++) {
            const root = ufCheck.find(k);
            roots.set(root, (roots.get(root) || 0) + 1);
        }
        for (const count of roots.values()) {
            if (count >= 2) {
                available_thresholds.push(pct / 100);
                break;
            }
        }
    }

    // Now cluster at the requested threshold
    const uf = new UnionFind(nodes.length);
    const pairSims: Map<string, number> = new Map();

    for (const p of allPairs) {
        if (p.sim >= threshold) {
            uf.union(p.i, p.j);
            pairSims.set(`${p.i}-${p.j}`, p.sim);
        }
    }

    // Group by cluster root
    const clusterMap = new Map<number, number[]>();
    for (let i = 0; i < nodes.length; i++) {
        const root = uf.find(i);
        if (!clusterMap.has(root)) clusterMap.set(root, []);
        clusterMap.get(root)!.push(i);
    }

    // Build result (only clusters with 2+ members)
    const clusters: DuplicateCluster[] = [];
    for (const [, members] of clusterMap) {
        if (members.length < 2) continue;

        // Find max similarity within this cluster
        let maxSim = 0;
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                const a = Math.min(members[i], members[j]);
                const b = Math.max(members[i], members[j]);
                const sim = pairSims.get(`${a}-${b}`) || 0;
                if (sim > maxSim) maxSim = sim;
            }
        }

        clusters.push({
            nodes: members.map(idx => ({
                id: nodes[idx].id,
                name: nodes[idx].name,
                description: nodes[idx].description,
                node_type: nodes[idx].node_type,
                status: nodes[idx].status,
                edge_count: nodes[idx].edge_count,
                parent_name: nodes[idx].parent_name || null
            })),
            max_similarity: Math.round(maxSim * 1000) / 1000
        });
    }

    // Sort by highest similarity first
    clusters.sort((a, b) => b.max_similarity - a.max_similarity);
    return { clusters, available_thresholds };
}

function mergeNodes(
    db: Database.Database,
    projectId: number,
    canonicalId: number,
    duplicateIds: number[]
): { edges_redirected: number; nodes_deleted: number } {
    let edgesRedirected = 0;
    let nodesDeleted = 0;

    const tx = db.transaction(() => {
        for (const dupId of duplicateIds) {
            // Redirect outgoing edges
            const r1 = db
                .prepare(
                    `UPDATE onto_edges SET source_node_id = ? WHERE source_node_id = ? AND project_id = ?`
                )
                .run(canonicalId, dupId, projectId);
            edgesRedirected += r1.changes;

            // Redirect incoming edges
            const r2 = db
                .prepare(
                    `UPDATE onto_edges SET target_node_id = ? WHERE target_node_id = ? AND project_id = ?`
                )
                .run(canonicalId, dupId, projectId);
            edgesRedirected += r2.changes;

            // Remove self-loops created by merging
            db.prepare(
                `DELETE FROM onto_edges WHERE source_node_id = target_node_id AND project_id = ?`
            ).run(projectId);

            // Deduplicate edges: if same (source, target, edge_type), keep higher confidence
            const dupeEdges = db
                .prepare(`
        SELECT e1.id as id1, e2.id as id2, e1.confidence as c1, e2.confidence as c2
        FROM onto_edges e1
        JOIN onto_edges e2 ON e1.source_node_id = e2.source_node_id
          AND e1.target_node_id = e2.target_node_id
          AND e1.edge_type = e2.edge_type
          AND e1.id < e2.id
        WHERE e1.project_id = ?
      `)
                .all(projectId) as any[];
            for (const d of dupeEdges) {
                const removeId = d.c1 >= d.c2 ? d.id2 : d.id1;
                db.prepare('DELETE FROM onto_edges WHERE id = ?').run(removeId);
            }

            // Update parent_id references
            db.prepare(
                `UPDATE onto_nodes SET parent_id = ? WHERE parent_id = ? AND project_id = ?`
            ).run(canonicalId, dupId, projectId);

            // Delete the duplicate node
            db.prepare(
                `DELETE FROM onto_nodes WHERE id = ? AND project_id = ?`
            ).run(dupId, projectId);
            nodesDeleted++;
        }

        // Update project counts
        const nodeCount = (
            db
                .prepare(
                    'SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?'
                )
                .get(projectId) as any
        ).c;
        const edgeCount = (
            db
                .prepare(
                    'SELECT COUNT(*) as c FROM onto_edges WHERE project_id = ?'
                )
                .get(projectId) as any
        ).c;
        db.prepare(
            "UPDATE onto_projects SET node_count = ?, edge_count = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(nodeCount, edgeCount, projectId);
    });

    tx();
    return { edges_redirected: edgesRedirected, nodes_deleted: nodesDeleted };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerDedupRoutes(r: Router, db: Database.Database): void {
    // Scan for duplicates
    r.get(
        '/api/ontologica/projects/:projectId/duplicates',
        async (req: Request, res: Response) => {
            try {
                const projectId = Number(req.params.projectId);
                const threshold = Number(req.query.threshold) || 0.85;
                const project = db
                    .prepare('SELECT id FROM onto_projects WHERE id = ?')
                    .get(projectId);
                if (!project)
                    return res.status(404).json({ error: 'Project not found' });

                const result = await findDuplicateClusters(
                    db,
                    projectId,
                    Math.max(0.5, Math.min(0.99, threshold))
                );
                res.json({
                    clusters: result.clusters,
                    available_thresholds: result.available_thresholds,
                    threshold,
                    computed_at: new Date().toISOString()
                });
            } catch (err: any) {
                console.error('[dedup] Scan error:', err);
                res.status(500).json({
                    error: err.message || 'Deduplication scan failed'
                });
            }
        }
    );

    // Merge duplicates (also accepts dismissals to persist "not duplicates" decisions)
    r.post(
        '/api/ontologica/projects/:projectId/merge',
        (req: Request, res: Response) => {
            try {
                const projectId = Number(req.params.projectId);
                const project = db
                    .prepare('SELECT id FROM onto_projects WHERE id = ?')
                    .get(projectId);
                if (!project)
                    return res.status(404).json({ error: 'Project not found' });

                const { merges, dismissals } = req.body as {
                    merges?: Array<{
                        canonical_id: number;
                        duplicate_ids: number[];
                    }>;
                    dismissals?: Array<{ node_ids: number[] }>;
                };

                // Save dismissals — store all pairwise combos so they never resurface
                let dismissalsSaved = 0;
                if (dismissals?.length) {
                    const insertDismissal = db.prepare(
                        `INSERT OR IGNORE INTO onto_dedup_dismissals (project_id, node_a_id, node_b_id) VALUES (?, ?, ?)`
                    );
                    const saveTx = db.transaction(() => {
                        for (const group of dismissals) {
                            for (let i = 0; i < group.node_ids.length; i++) {
                                for (
                                    let j = i + 1;
                                    j < group.node_ids.length;
                                    j++
                                ) {
                                    const a = Math.min(
                                        group.node_ids[i],
                                        group.node_ids[j]
                                    );
                                    const b = Math.max(
                                        group.node_ids[i],
                                        group.node_ids[j]
                                    );
                                    insertDismissal.run(projectId, a, b);
                                    dismissalsSaved++;
                                }
                            }
                        }
                    });
                    saveTx();
                }

                if (!merges?.length && !dismissals?.length) {
                    return res
                        .status(400)
                        .json({ error: 'No merges or dismissals provided' });
                }

                // Validate all merge node IDs belong to the project
                let totalEdges = 0,
                    totalNodes = 0;
                if (merges?.length) {
                    const allIds = merges.flatMap(m => [
                        m.canonical_id,
                        ...m.duplicate_ids
                    ]);
                    const existing = new Set(
                        (
                            db
                                .prepare(
                                    `SELECT id FROM onto_nodes WHERE project_id = ? AND id IN (${allIds.map(() => '?').join(',')})`
                                )
                                .all(projectId, ...allIds) as any[]
                        ).map(r => r.id)
                    );
                    const missing = allIds.filter(id => !existing.has(id));
                    if (missing.length)
                        return res.status(400).json({
                            error: `Node IDs not found: ${missing.join(', ')}`
                        });

                    for (const m of merges) {
                        const result = mergeNodes(
                            db,
                            projectId,
                            m.canonical_id,
                            m.duplicate_ids
                        );
                        totalEdges += result.edges_redirected;
                        totalNodes += result.nodes_deleted;
                    }
                }

                res.json({
                    ok: true,
                    total_edges_redirected: totalEdges,
                    total_nodes_deleted: totalNodes,
                    dismissals_saved: dismissalsSaved
                });
            } catch (err: any) {
                console.error('[dedup] Merge error:', err);
                res.status(500).json({ error: err.message || 'Merge failed' });
            }
        }
    );

    // Clear all dismissals for a project (in case you want to re-evaluate everything)
    r.delete(
        '/api/ontologica/projects/:projectId/dismissals',
        (req: Request, res: Response) => {
            try {
                const projectId = Number(req.params.projectId);
                const result = db
                    .prepare(
                        'DELETE FROM onto_dedup_dismissals WHERE project_id = ?'
                    )
                    .run(projectId);
                res.json({ ok: true, cleared: result.changes });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        }
    );
}
