import { Router, type Request, type Response } from 'express';

import { jsonCompletion, isAvailable as isLLMAvailable } from './llm.js';

import type Database from 'better-sqlite3';

// ── Embedding Pipeline (shared with dedup.ts via same singleton) ─────────────

let extractorPromise: Promise<any> | null = null;

async function getExtractor() {
    if (!extractorPromise) {
        extractorPromise = (async () => {
            const { pipeline } = await import('@huggingface/transformers');
            console.log('[layer-suggest] Loading embedding model...');
            const ext = await pipeline(
                'feature-extraction',
                'Xenova/all-MiniLM-L6-v2',
                {
                    dtype: 'fp32'
                }
            );
            console.log('[layer-suggest] Embedding model ready');
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip namespace prefix (schema:AccountingService → AccountingService) */
function stripPrefix(label: string): string {
    const idx = label.indexOf(':');
    return idx >= 0 ? label.substring(idx + 1) : label;
}

/** Split camelCase/PascalCase into words (AccountingService → Accounting Service) */
function splitCamelCase(str: string): string {
    return str
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/** Build human-readable text for embedding a base layer item */
function baseItemText(item: {
    label: string;
    local_name: string;
    description: string | null;
}): string {
    const name = splitCamelCase(stripPrefix(item.label || item.local_name));
    return item.description ? `${name}: ${item.description}` : name;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface LayerSuggestion {
    node_id: number;
    node_name: string;
    node_description: string | null;
    node_type: string;
    match: {
        item_id: number;
        layer_id: number;
        layer_name: string;
        layer_slug: string;
        uri: string;
        label: string;
        local_name: string;
        description: string | null;
        item_type: string;
        parent_uri: string | null;
    };
    similarity: number;
    match_type?: 'same' | 'is_a' | 'related'; // from LLM evaluation
}

// ── Dismissals table ────────────────────────────────────────────────────────

function ensureDismissalsTable(db: Database.Database) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS onto_layer_suggestion_dismissals (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
      node_id    INTEGER NOT NULL,
      item_id    INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, node_id, item_id)
    )
  `);
}

// ── LLM Evaluation ──────────────────────────────────────────────────────────

interface EmbeddingCandidate {
    nodeIdx: number;
    itemIdx: number;
    similarity: number;
}

interface LLMEvaluation {
    nodeIdx: number;
    itemIdx: number;
    match_type: 'same' | 'is_a' | 'related' | 'no_match';
    confidence: number;
}

async function evaluateCandidatesWithLLM(
    candidates: EmbeddingCandidate[],
    customNodes: Array<{
        id: number;
        name: string;
        description: string | null;
        node_type: string;
    }>,
    baseItems: any[]
): Promise<LLMEvaluation[]> {
    if (!isLLMAvailable() || candidates.length === 0) return [];

    // Build pairs for evaluation
    const pairs = candidates.map((c, i) => {
        const node = customNodes[c.nodeIdx];
        const item = baseItems[c.itemIdx];
        const itemName = splitCamelCase(
            stripPrefix(item.label || item.local_name)
        );
        return {
            id: i,
            custom: {
                name: node.name,
                description: node.description || '',
                type: node.node_type
            },
            base: {
                name: itemName,
                uri: item.uri,
                description: item.description || '',
                layer: item.layer_name
            },
            embedding_sim: c.similarity
        };
    });

    // Process in batches of ~15 pairs per LLM call (smaller to avoid rate limits)
    const BATCH_SIZE = 15;
    const allResults: LLMEvaluation[] = [];

    for (
        let batchStart = 0;
        batchStart < pairs.length;
        batchStart += BATCH_SIZE
    ) {
        const batch = pairs.slice(batchStart, batchStart + BATCH_SIZE);

        // Delay between batches to avoid rate limits
        if (batchStart > 0) await new Promise(r => setTimeout(r, 3000));

        const prompt = `You are an ontology alignment expert. For each pair below, determine the semantic relationship between a CUSTOM term (from a domain-specific ontology) and a BASE vocabulary term (from a standard ontology like Schema.org, PROV-O, etc.).

Classify each pair as ONE of:
- "same": The custom term represents essentially the same concept as the base term (e.g., "Accounting Service" ↔ "schema:AccountingService")
- "is_a": The custom term is a specific type/subclass of the base term (e.g., "Data Extraction" is_a "schema:Action", "Tax Software" is_a "schema:SoftwareApplication")
- "related": Meaningfully related but neither identical nor a subclass relationship
- "no_match": No meaningful ontological relationship

Consider the MEANING and PURPOSE of each term, not just surface text similarity. A "Data Extraction" process IS an Action. A "CRM" IS a SoftwareApplication. An "Email Agent" IS a SoftwareAgent.

Be precise: "same" means truly equivalent concepts. "is_a" means strict taxonomic subsumption.

Return a JSON array of objects: [{"id": <number>, "match_type": "<same|is_a|related|no_match>", "confidence": <0.0-1.0>}]
Return ONLY the JSON array, no other text.

Pairs to evaluate:
${JSON.stringify(batch, null, 2)}`;

        try {
            const parsed = await jsonCompletion<any>({
                prompt,
                temperature: 0.1
            });
            const results = Array.isArray(parsed)
                ? parsed
                : parsed.results || parsed.evaluations || parsed.pairs || [];

            for (const r of results) {
                if (r.match_type === 'no_match') continue;
                const pair = batch.find(p => p.id === r.id);
                if (!pair) continue;
                const candidate = candidates[pair.id];
                allResults.push({
                    nodeIdx: candidate.nodeIdx,
                    itemIdx: candidate.itemIdx,
                    match_type: r.match_type,
                    confidence: r.confidence || 0.7
                });
            }
        } catch (err: any) {
            console.error('[layer-suggest] LLM evaluation error:', err.message);
        }
    }

    return allResults;
}

// ── Core Logic ──────────────────────────────────────────────────────────────

async function findLayerSuggestions(
    db: Database.Database,
    projectId: number,
    threshold: number = 0.7,
    useLLM: boolean = true
): Promise<LayerSuggestion[]> {
    // Get custom nodes (no layer_id — these are extracted, not from base layers)
    const customNodes = db
        .prepare(
            `SELECT id, name, description, node_type
     FROM onto_nodes
     WHERE project_id = ? AND layer_id IS NULL`
        )
        .all(projectId) as Array<{
        id: number;
        name: string;
        description: string | null;
        node_type: string;
    }>;

    if (customNodes.length === 0) return [];

    // Get base layer items from activated layers for this project
    const baseItems = db
        .prepare(
            `SELECT bli.id as item_id, bli.layer_id, bli.item_type, bli.uri, bli.local_name,
            bli.label, bli.description, bli.parent_uri,
            bl.name as layer_name, bl.slug as layer_slug
     FROM onto_base_layer_items bli
     JOIN onto_project_layers pl ON pl.layer_id = bli.layer_id AND pl.project_id = ?
     JOIN onto_base_layers bl ON bl.id = bli.layer_id
     WHERE bli.item_type IN ('class', 'individual')`
        )
        .all(projectId) as any[];

    if (baseItems.length === 0) return [];

    // Load dismissals
    ensureDismissalsTable(db);
    const dismissals = db
        .prepare(
            `SELECT node_id, item_id FROM onto_layer_suggestion_dismissals WHERE project_id = ?`
        )
        .all(projectId) as Array<{ node_id: number; item_id: number }>;
    const dismissedSet = new Set(
        dismissals.map(d => `${d.node_id}-${d.item_id}`)
    );

    // Build text arrays for embedding — use human-readable text for base items
    const nodeTexts = customNodes.map(n =>
        n.description ? `${n.name}: ${n.description}` : n.name
    );
    const itemTexts = baseItems.map((i: any) => baseItemText(i));

    const allTexts = [...nodeTexts, ...itemTexts];

    // Get embeddings in one batch
    const extractor = await getExtractor();
    const output = await extractor(allTexts, {
        pooling: 'mean',
        normalize: true
    });

    const data = output.data as Float32Array;
    const dims = output.dims as number[];
    const embDim = dims[1];

    // Split embeddings
    const nodeEmbeddings: number[][] = [];
    for (let i = 0; i < customNodes.length; i++) {
        nodeEmbeddings.push(
            Array.from(data.slice(i * embDim, (i + 1) * embDim))
        );
    }
    const itemEmbeddings: number[][] = [];
    const offset = customNodes.length;
    for (let i = 0; i < baseItems.length; i++) {
        itemEmbeddings.push(
            Array.from(
                data.slice((offset + i) * embDim, (offset + i + 1) * embDim)
            )
        );
    }

    // Phase 1: Find top-K embedding candidates per custom node
    const TOP_K = 5;
    // Use a lower embedding threshold to cast a wider net for LLM evaluation
    const embeddingThreshold = useLLM ? Math.min(threshold, 0.35) : threshold;
    const allCandidates: EmbeddingCandidate[] = [];

    for (let ni = 0; ni < customNodes.length; ni++) {
        const node = customNodes[ni];
        const scored: Array<{ idx: number; sim: number }> = [];

        for (let ii = 0; ii < baseItems.length; ii++) {
            if (dismissedSet.has(`${node.id}-${baseItems[ii].item_id}`))
                continue;

            const sim = dotProduct(nodeEmbeddings[ni], itemEmbeddings[ii]);
            if (sim >= embeddingThreshold) {
                scored.push({ idx: ii, sim });
            }
        }

        // Keep top-K
        scored.sort((a, b) => b.sim - a.sim);
        for (const s of scored.slice(0, TOP_K)) {
            allCandidates.push({
                nodeIdx: ni,
                itemIdx: s.idx,
                similarity: s.sim
            });
        }
    }

    // Phase 2: LLM evaluation (if enabled and API key available)
    let llmResults: LLMEvaluation[] = [];
    if (useLLM && isLLMAvailable() && allCandidates.length > 0) {
        try {
            llmResults = await evaluateCandidatesWithLLM(
                allCandidates,
                customNodes,
                baseItems
            );
        } catch (err: any) {
            console.error(
                '[layer-suggest] LLM evaluation failed, falling back to embeddings only:',
                err.message
            );
        }
    }

    // Phase 3: Build final suggestions
    const suggestions: LayerSuggestion[] = [];

    if (llmResults.length > 0) {
        // LLM mode: use LLM evaluations, prioritize by confidence
        // Group by node — pick the best match per node
        const bestByNode = new Map<number, LLMEvaluation>();
        for (const eval_ of llmResults) {
            const existing = bestByNode.get(eval_.nodeIdx);
            // Prefer 'same' over 'is_a' over 'related', then by confidence
            const typeRank = (t: string) =>
                t === 'same' ? 3 : t === 'is_a' ? 2 : 1;
            if (
                !existing ||
                typeRank(eval_.match_type) > typeRank(existing.match_type) ||
                (typeRank(eval_.match_type) === typeRank(existing.match_type) &&
                    eval_.confidence > existing.confidence)
            ) {
                bestByNode.set(eval_.nodeIdx, eval_);
            }
        }

        for (const entry of Array.from(bestByNode.entries())) {
            const [nodeIdx, eval_] = entry;
            const node = customNodes[nodeIdx];
            const item = baseItems[eval_.itemIdx];
            const embCandidate = allCandidates.find(
                c => c.nodeIdx === nodeIdx && c.itemIdx === eval_.itemIdx
            );

            suggestions.push({
                node_id: node.id,
                node_name: node.name,
                node_description: node.description,
                node_type: node.node_type,
                match: {
                    item_id: item.item_id,
                    layer_id: item.layer_id,
                    layer_name: item.layer_name,
                    layer_slug: item.layer_slug,
                    uri: item.uri,
                    label: item.label,
                    local_name: item.local_name,
                    description: item.description,
                    item_type: item.item_type,
                    parent_uri: item.parent_uri
                },
                similarity: embCandidate
                    ? Math.round(embCandidate.similarity * 1000) / 1000
                    : eval_.confidence,
                match_type: eval_.match_type as 'same' | 'is_a' | 'related'
            });
        }
    } else {
        // Fallback: embedding-only mode (original behavior but with better text)
        // One best match per node
        for (let ni = 0; ni < customNodes.length; ni++) {
            const node = customNodes[ni];
            const nodeCandidates = allCandidates.filter(c => c.nodeIdx === ni);
            if (nodeCandidates.length === 0) continue;
            const best = nodeCandidates[0]; // already sorted by sim desc
            if (best.similarity < threshold) continue;

            const item = baseItems[best.itemIdx];
            suggestions.push({
                node_id: node.id,
                node_name: node.name,
                node_description: node.description,
                node_type: node.node_type,
                match: {
                    item_id: item.item_id,
                    layer_id: item.layer_id,
                    layer_name: item.layer_name,
                    layer_slug: item.layer_slug,
                    uri: item.uri,
                    label: item.label,
                    local_name: item.local_name,
                    description: item.description,
                    item_type: item.item_type,
                    parent_uri: item.parent_uri
                },
                similarity: Math.round(best.similarity * 1000) / 1000
            });
        }
    }

    // Sort by similarity/confidence descending
    suggestions.sort((a, b) => {
        // Group by match_type first: same > is_a > related > undefined
        const typeRank = (t?: string) =>
            t === 'same' ? 3 : t === 'is_a' ? 2 : t === 'related' ? 1 : 0;
        const rankDiff = typeRank(b.match_type) - typeRank(a.match_type);
        if (rankDiff !== 0) return rankDiff;
        return b.similarity - a.similarity;
    });

    return suggestions;
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerLayerSuggestionRoutes(
    r: Router,
    db: Database.Database
): void {
    ensureDismissalsTable(db);

    // Scan for custom nodes that match base layer items
    r.get(
        '/api/ontologica/projects/:projectId/layer-suggestions',
        async (req: Request, res: Response) => {
            try {
                const projectId = Number(req.params.projectId);
                const threshold = Number(req.query.threshold) || 0.7;
                const useLLM = req.query.llm !== 'false'; // default true, pass ?llm=false to disable
                const project = db
                    .prepare('SELECT id FROM onto_projects WHERE id = ?')
                    .get(projectId);
                if (!project)
                    return res.status(404).json({ error: 'Project not found' });

                const suggestions = await findLayerSuggestions(
                    db,
                    projectId,
                    Math.max(0.5, Math.min(0.99, threshold)),
                    useLLM
                );
                res.json({
                    suggestions,
                    threshold,
                    computed_at: new Date().toISOString()
                });
            } catch (err: any) {
                console.error('[layer-suggest] Scan error:', err);
                res.status(500).json({
                    error: err.message || 'Layer suggestion scan failed'
                });
            }
        }
    );

    // Accept suggestion: link custom node to base layer item
    r.post(
        '/api/ontologica/projects/:projectId/layer-suggestions/accept',
        (req: Request, res: Response) => {
            try {
                const projectId = Number(req.params.projectId);
                const { node_id, item_id, layer_id, base_item_uri } = req.body;
                if (!node_id || !item_id)
                    return res
                        .status(400)
                        .json({ error: 'node_id and item_id required' });

                db.prepare(
                    `UPDATE onto_nodes SET layer_id = ?, base_item_uri = ?, updated_at = datetime('now')
         WHERE id = ? AND project_id = ?`
                ).run(layer_id, base_item_uri, node_id, projectId);

                const node = db
                    .prepare('SELECT * FROM onto_nodes WHERE id = ?')
                    .get(node_id);
                res.json({ ok: true, node });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        }
    );

    // Mark as subclass: create is_a edge from custom node to a new node representing the base item
    r.post(
        '/api/ontologica/projects/:projectId/layer-suggestions/subclass',
        (req: Request, res: Response) => {
            try {
                const projectId = Number(req.params.projectId);
                const {
                    node_id,
                    item_id,
                    layer_id,
                    base_item_uri,
                    base_item_name
                } = req.body;
                if (!node_id || !item_id)
                    return res
                        .status(400)
                        .json({ error: 'node_id and item_id required' });

                const tx = db.transaction(() => {
                    // Check if a node for this base item already exists in the project
                    let parentNode = db
                        .prepare(
                            `SELECT id FROM onto_nodes WHERE project_id = ? AND base_item_uri = ?`
                        )
                        .get(projectId, base_item_uri) as any;

                    if (!parentNode) {
                        // Create a node for the base layer item
                        const result = db
                            .prepare(
                                `INSERT INTO onto_nodes (project_id, node_type, name, description, uri, confidence, status, layer_id, base_item_uri)
             VALUES (?, 'class', ?, ?, ?, 1.0, 'approved', ?, ?)`
                            )
                            .run(
                                projectId,
                                base_item_name,
                                `Standard vocabulary term from base layer`,
                                base_item_uri,
                                layer_id,
                                base_item_uri
                            );
                        parentNode = { id: result.lastInsertRowid };
                    }

                    // Set the custom node's parent to the base item node
                    db.prepare(
                        `UPDATE onto_nodes SET parent_id = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`
                    ).run(parentNode.id, node_id, projectId);

                    // Create is_a edge if it doesn't exist
                    const existingEdge = db
                        .prepare(
                            `SELECT id FROM onto_edges WHERE project_id = ? AND source_node_id = ? AND target_node_id = ? AND edge_type = 'is_a'`
                        )
                        .get(projectId, node_id, parentNode.id);

                    if (!existingEdge) {
                        db.prepare(
                            `INSERT INTO onto_edges (project_id, edge_type, name, source_node_id, target_node_id, confidence, status)
             VALUES (?, 'is_a', 'subClassOf', ?, ?, 1.0, 'approved')`
                        ).run(projectId, node_id, parentNode.id);
                    }

                    // Update counts
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
                res.json({ ok: true });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        }
    );

    // Dismiss suggestion: don't show this pair again
    r.post(
        '/api/ontologica/projects/:projectId/layer-suggestions/dismiss',
        (req: Request, res: Response) => {
            try {
                const projectId = Number(req.params.projectId);
                const { node_id, item_id } = req.body;
                if (!node_id || !item_id)
                    return res
                        .status(400)
                        .json({ error: 'node_id and item_id required' });

                db.prepare(
                    `INSERT OR IGNORE INTO onto_layer_suggestion_dismissals (project_id, node_id, item_id) VALUES (?, ?, ?)`
                ).run(projectId, node_id, item_id);

                res.json({ ok: true });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        }
    );

    // Clear all suggestion dismissals
    r.delete(
        '/api/ontologica/projects/:projectId/layer-suggestions/dismissals',
        (req: Request, res: Response) => {
            try {
                const projectId = Number(req.params.projectId);
                const result = db
                    .prepare(
                        'DELETE FROM onto_layer_suggestion_dismissals WHERE project_id = ?'
                    )
                    .run(projectId);
                res.json({ ok: true, cleared: result.changes });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        }
    );
}
