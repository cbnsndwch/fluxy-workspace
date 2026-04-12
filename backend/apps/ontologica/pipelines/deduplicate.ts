/**
 * Deduplicate Pipeline
 *
 * Runs embedding-based duplicate detection on all nodes in a project,
 * produces merge proposals for human review (supervised mode) or
 * auto-applies them (automated mode).
 *
 * Stages: embed → compare → propose → done
 */

import { checkAbort } from './dispatch.js';

import type Database from 'better-sqlite3';

// Reuse the existing embedding pipeline from dedup.ts
let extractorPromise: Promise<any> | null = null;

async function getExtractor() {
    if (!extractorPromise) {
        extractorPromise = (async () => {
            const { pipeline } = await import('@huggingface/transformers');
            console.log('[dedup-pipeline] Loading embedding model...');
            const ext = await pipeline(
                'feature-extraction',
                'Xenova/all-MiniLM-L6-v2',
                {
                    dtype: 'fp32'
                }
            );
            console.log('[dedup-pipeline] Embedding model ready');
            return ext;
        })();
    }
    return extractorPromise;
}

function dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
}

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

function log(
    db: Database.Database,
    jobId: number,
    stage: string,
    level: string,
    title: string,
    detail?: string,
    meta?: any
) {
    db.prepare(
        'INSERT INTO onto_pipeline_logs (job_id, stage, level, title, detail, meta) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
        jobId,
        stage,
        level,
        title,
        detail || null,
        meta ? JSON.stringify(meta) : null
    );
    console.log(`[dedup-pipeline] Job #${jobId} [${stage}] ${title}`);
}

function updateJob(
    db: Database.Database,
    jobId: number,
    updates: Record<string, any>
) {
    const sets = Object.keys(updates)
        .map(k => `${k} = ?`)
        .join(', ');
    db.prepare(`UPDATE onto_extraction_jobs SET ${sets} WHERE id = ?`).run(
        ...Object.values(updates),
        jobId
    );
}

function completeStage(db: Database.Database, jobId: number, stage: string) {
    const job = db
        .prepare(
            'SELECT stages_complete FROM onto_extraction_jobs WHERE id = ?'
        )
        .get(jobId) as any;
    const stages: string[] = JSON.parse(job?.stages_complete || '[]');
    if (!stages.includes(stage)) {
        stages.push(stage);
        db.prepare(
            'UPDATE onto_extraction_jobs SET stages_complete = ? WHERE id = ?'
        ).run(JSON.stringify(stages), jobId);
    }
}

export async function runDeduplicatePipeline(
    db: Database.Database,
    jobId: number,
    signal?: AbortSignal
): Promise<void> {
    const job = db
        .prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?')
        .get(jobId) as any;
    if (!job) throw new Error(`Job ${jobId} not found`);

    const config = JSON.parse(job.config || '{}');
    const threshold = config.threshold || 0.85;
    const mode = config.mode || 'supervised';
    const projectId = job.project_id;

    try {
        // ── Stage: embed ──────────────────────────────────────────────────────────
        updateJob(db, jobId, {
            status: 'running',
            pipeline_stage: 'embed',
            progress_pct: 10,
            current_step: 'Computing embeddings...',
            started_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
        });

        const nodes = db
            .prepare(`
      SELECT n.id, n.name, n.description, n.node_type, n.status,
        (SELECT COUNT(*) FROM onto_edges e WHERE e.source_node_id = n.id OR e.target_node_id = n.id) as edge_count,
        p.name as parent_name
      FROM onto_nodes n
      LEFT JOIN onto_nodes p ON n.parent_id = p.id
      WHERE n.project_id = ?
    `)
            .all(projectId) as any[];

        if (nodes.length < 2) {
            log(
                db,
                jobId,
                'embed',
                'info',
                'Not enough nodes to compare',
                `Only ${nodes.length} node(s) in project`
            );
            updateJob(db, jobId, {
                status: 'completed',
                pipeline_stage: 'done',
                progress_pct: 100,
                current_step: 'No duplicates possible (< 2 nodes)'
            });
            log(
                db,
                jobId,
                'pipeline',
                'milestone',
                'Pipeline complete!',
                'No duplicates possible with fewer than 2 nodes'
            );
            return;
        }

        log(db, jobId, 'embed', 'info', `Embedding ${nodes.length} nodes`);

        const texts = nodes.map((n: any) =>
            n.description ? `${n.name}: ${n.description}` : n.name
        );
        const extractor = await getExtractor();
        const output = await extractor(texts, {
            pooling: 'mean',
            normalize: true
        });

        const embeddings: number[][] = [];
        const data = output.data as Float32Array;
        const embDim = (output.dims as number[])[1];
        for (let i = 0; i < nodes.length; i++) {
            embeddings.push(
                Array.from(data.slice(i * embDim, (i + 1) * embDim))
            );
        }

        log(
            db,
            jobId,
            'embed',
            'success',
            `Computed ${nodes.length} embeddings`,
            `Dimension: ${embDim}`
        );
        completeStage(db, jobId, 'embed');
        checkAbort(signal, db, jobId);

        // ── Stage: compare ────────────────────────────────────────────────────────
        updateJob(db, jobId, {
            pipeline_stage: 'compare',
            progress_pct: 40,
            current_step: 'Finding similar pairs...'
        });

        // Load dismissed pairs
        const dismissals = db
            .prepare(
                'SELECT node_a_id, node_b_id FROM onto_dedup_dismissals WHERE project_id = ?'
            )
            .all(projectId) as any[];
        const dismissedSet = new Set(
            dismissals.map(
                (d: any) =>
                    `${Math.min(d.node_a_id, d.node_b_id)}-${Math.max(d.node_a_id, d.node_b_id)}`
            )
        );

        // Pairwise comparison
        const pairs: Array<{ i: number; j: number; sim: number }> = [];
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                if (nodes[i].node_type !== nodes[j].node_type) continue;
                const aId = Math.min(nodes[i].id, nodes[j].id);
                const bId = Math.max(nodes[i].id, nodes[j].id);
                if (dismissedSet.has(`${aId}-${bId}`)) continue;
                const sim = dotProduct(embeddings[i], embeddings[j]);
                if (sim >= threshold) {
                    pairs.push({ i, j, sim });
                }
            }
        }

        log(
            db,
            jobId,
            'compare',
            'info',
            `Found ${pairs.length} similar pairs above ${Math.round(threshold * 100)}%`
        );

        // Cluster with Union-Find
        const uf = new UnionFind(nodes.length);
        for (const p of pairs) uf.union(p.i, p.j);

        const clusterMap = new Map<number, number[]>();
        for (let i = 0; i < nodes.length; i++) {
            const root = uf.find(i);
            if (!clusterMap.has(root)) clusterMap.set(root, []);
            clusterMap.get(root)!.push(i);
        }

        // Filter to clusters with 2+ members
        const clusters: Array<{ members: number[]; maxSim: number }> = [];
        for (const [, members] of clusterMap) {
            if (members.length < 2) continue;
            let maxSim = 0;
            for (let i = 0; i < members.length; i++) {
                for (let j = i + 1; j < members.length; j++) {
                    const sim = dotProduct(
                        embeddings[members[i]],
                        embeddings[members[j]]
                    );
                    if (sim > maxSim) maxSim = sim;
                }
            }
            clusters.push({ members, maxSim });
        }
        clusters.sort((a, b) => b.maxSim - a.maxSim);

        log(
            db,
            jobId,
            'compare',
            'success',
            `Found ${clusters.length} duplicate clusters`,
            `${clusters.reduce((s, c) => s + c.members.length, 0)} nodes involved`
        );

        completeStage(db, jobId, 'compare');
        checkAbort(signal, db, jobId);

        // ── Stage: propose ────────────────────────────────────────────────────────
        updateJob(db, jobId, {
            pipeline_stage: 'propose',
            progress_pct: 70,
            current_step: `Creating ${clusters.length} proposals...`
        });

        if (clusters.length === 0) {
            log(db, jobId, 'propose', 'info', 'No duplicate clusters found');
            updateJob(db, jobId, {
                status: 'completed',
                pipeline_stage: 'done',
                progress_pct: 100,
                current_step: `No duplicates found above ${Math.round(threshold * 100)}%`
            });
            log(
                db,
                jobId,
                'pipeline',
                'milestone',
                'Pipeline complete!',
                'No duplicates found'
            );
            return;
        }

        const insertProposal = db.prepare(`
      INSERT INTO onto_pipeline_proposals (job_id, project_id, proposal_type, source_id, target_id, payload, confidence, status, decided_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        let proposalCount = 0;
        const tx = db.transaction(() => {
            for (const cluster of clusters) {
                // Pick canonical: prefer approved > suggested, then most edges, then alphabetical
                const clusterNodes = cluster.members.map(idx => nodes[idx]);
                clusterNodes.sort((a: any, b: any) => {
                    if (a.status === 'approved' && b.status !== 'approved')
                        return -1;
                    if (b.status === 'approved' && a.status !== 'approved')
                        return 1;
                    if (a.edge_count !== b.edge_count)
                        return b.edge_count - a.edge_count;
                    return a.name.localeCompare(b.name);
                });

                const canonical = clusterNodes[0];
                const duplicates = clusterNodes.slice(1);

                if (mode === 'automated') {
                    // Auto-approve
                    insertProposal.run(
                        jobId,
                        projectId,
                        'merge',
                        canonical.id,
                        null,
                        JSON.stringify({
                            canonical_id: canonical.id,
                            canonical_name: canonical.name,
                            duplicate_ids: duplicates.map((d: any) => d.id),
                            duplicate_names: duplicates.map((d: any) => d.name),
                            similarity: cluster.maxSim
                        }),
                        cluster.maxSim,
                        'approved',
                        'system'
                    );
                } else {
                    // Supervised — leave as pending
                    insertProposal.run(
                        jobId,
                        projectId,
                        'merge',
                        canonical.id,
                        null,
                        JSON.stringify({
                            canonical_id: canonical.id,
                            canonical_name: canonical.name,
                            duplicate_ids: duplicates.map((d: any) => d.id),
                            duplicate_names: duplicates.map((d: any) => d.name),
                            cluster_nodes: clusterNodes.map((n: any) => ({
                                id: n.id,
                                name: n.name,
                                description: n.description,
                                node_type: n.node_type,
                                status: n.status,
                                edge_count: n.edge_count
                            })),
                            similarity: cluster.maxSim
                        }),
                        cluster.maxSim,
                        'pending',
                        null
                    );
                }
                proposalCount++;
            }
        });
        tx();

        log(
            db,
            jobId,
            'propose',
            'success',
            `Created ${proposalCount} merge proposals`,
            mode === 'automated'
                ? 'Auto-approved (automated mode)'
                : 'Awaiting human review'
        );

        completeStage(db, jobId, 'propose');

        // ── Complete ──────────────────────────────────────────────────────────────
        const finalStatus = mode === 'automated' ? 'completed' : 'completed';
        const finalStep =
            mode === 'automated'
                ? `${proposalCount} merges auto-applied`
                : `${proposalCount} merge proposals awaiting review`;

        updateJob(db, jobId, {
            status: finalStatus,
            pipeline_stage: 'done',
            progress_pct: 100,
            current_step: finalStep,
            completed_at: new Date()
                .toISOString()
                .replace('T', ' ')
                .slice(0, 19)
        });

        log(
            db,
            jobId,
            'pipeline',
            'milestone',
            'Pipeline complete!',
            finalStep
        );

        // If automated, apply the proposals now
        if (mode === 'automated') {
            const approved = db
                .prepare(
                    "SELECT * FROM onto_pipeline_proposals WHERE job_id = ? AND status = 'approved'"
                )
                .all(jobId) as any[];
            // Dynamic import to avoid circular deps
            // The apply logic is in proposals.ts but we inline it here for simplicity
            for (const proposal of approved) {
                const payload = JSON.parse(proposal.payload);
                applyMerge(
                    db,
                    projectId,
                    payload.canonical_id,
                    payload.duplicate_ids
                );
                db.prepare(
                    "UPDATE onto_pipeline_proposals SET status = 'applied', applied_at = datetime('now') WHERE id = ?"
                ).run(proposal.id);
            }
            log(
                db,
                jobId,
                'pipeline',
                'success',
                `Applied ${approved.length} merges`
            );
        }
    } catch (err: any) {
        if (err.message === 'Pipeline aborted') return;
        console.error(`[dedup-pipeline] Job #${jobId} failed:`, err);
        updateJob(db, jobId, {
            status: 'failed',
            error: err.message,
            completed_at: new Date()
                .toISOString()
                .replace('T', ' ')
                .slice(0, 19)
        });
        log(db, jobId, 'pipeline', 'error', 'Pipeline failed', err.message);
    }
}

function applyMerge(
    db: Database.Database,
    projectId: number,
    canonicalId: number,
    duplicateIds: number[]
) {
    const tx = db.transaction(() => {
        for (const dupId of duplicateIds) {
            db.prepare(
                'UPDATE onto_edges SET source_node_id = ? WHERE source_node_id = ? AND project_id = ?'
            ).run(canonicalId, dupId, projectId);
            db.prepare(
                'UPDATE onto_edges SET target_node_id = ? WHERE target_node_id = ? AND project_id = ?'
            ).run(canonicalId, dupId, projectId);
            db.prepare(
                'DELETE FROM onto_edges WHERE source_node_id = target_node_id AND project_id = ?'
            ).run(projectId);
            db.prepare(
                'UPDATE onto_nodes SET parent_id = ? WHERE parent_id = ? AND project_id = ?'
            ).run(canonicalId, dupId, projectId);
            db.prepare(
                'DELETE FROM onto_nodes WHERE id = ? AND project_id = ?'
            ).run(dupId, projectId);
        }
        // Dedup edges
        const dupeEdges = db
            .prepare(`
      SELECT e1.id as id1, e2.id as id2, e1.confidence as c1, e2.confidence as c2
      FROM onto_edges e1 JOIN onto_edges e2
        ON e1.source_node_id = e2.source_node_id AND e1.target_node_id = e2.target_node_id
        AND e1.edge_type = e2.edge_type AND e1.id < e2.id
      WHERE e1.project_id = ?
    `)
            .all(projectId) as any[];
        for (const d of dupeEdges) {
            db.prepare('DELETE FROM onto_edges WHERE id = ?').run(
                d.c1 >= d.c2 ? d.id2 : d.id1
            );
        }
        // Update counts
        const nc = (
            db
                .prepare(
                    'SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?'
                )
                .get(projectId) as any
        ).c;
        const ec = (
            db
                .prepare(
                    'SELECT COUNT(*) as c FROM onto_edges WHERE project_id = ?'
                )
                .get(projectId) as any
        ).c;
        db.prepare(
            "UPDATE onto_projects SET node_count = ?, edge_count = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(nc, ec, projectId);
    });
    tx();
}
