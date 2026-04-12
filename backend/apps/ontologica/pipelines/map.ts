/**
 * Map Pipeline
 *
 * Comprehensive base layer mapping: scans all custom nodes against
 * active base vocabularies, uses embedding + LLM to produce proposals
 * for linking/subclassing/dismissing.
 *
 * Stages: scan → embed → evaluate → propose → done
 */

import { jsonCompletion, isAvailable as isLLMAvailable } from '../llm.js';
import { checkAbort } from './dispatch.js';

import type Database from 'better-sqlite3';

// ── Embedding (shared singleton) ────────────────────────────────────────────

let extractorPromise: Promise<any> | null = null;

async function getExtractor() {
    if (!extractorPromise) {
        extractorPromise = (async () => {
            const { pipeline } = await import('@huggingface/transformers');
            console.log('[map-pipeline] Loading embedding model...');
            const ext = await pipeline(
                'feature-extraction',
                'Xenova/all-MiniLM-L6-v2',
                {
                    dtype: 'fp32'
                }
            );
            console.log('[map-pipeline] Embedding model ready');
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

function stripPrefix(label: string): string {
    const idx = label.indexOf(':');
    return idx >= 0 ? label.substring(idx + 1) : label;
}

function splitCamelCase(str: string): string {
    return str
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

function baseItemText(item: {
    label: string;
    local_name: string;
    description: string | null;
}): string {
    const name = splitCamelCase(stripPrefix(item.label || item.local_name));
    return item.description ? `${name}: ${item.description}` : name;
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
    console.log(`[map-pipeline] Job #${jobId} [${stage}] ${title}`);
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

export async function runMapPipeline(
    db: Database.Database,
    jobId: number,
    signal?: AbortSignal
): Promise<void> {
    const job = db
        .prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?')
        .get(jobId) as any;
    if (!job) throw new Error(`Job ${jobId} not found`);

    const config = JSON.parse(job.config || '{}');
    const threshold = config.threshold || 0.35; // Low threshold for wide net
    const mode = config.mode || 'supervised';
    const projectId = job.project_id;

    try {
        // ── Stage: scan ───────────────────────────────────────────────────────────
        updateJob(db, jobId, {
            status: 'running',
            pipeline_stage: 'scan',
            progress_pct: 5,
            current_step: 'Scanning custom nodes and base layers...',
            started_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
        });

        const customNodes = db
            .prepare(`
      SELECT id, name, description, node_type
      FROM onto_nodes WHERE project_id = ? AND layer_id IS NULL
    `)
            .all(projectId) as any[];

        const baseItems = db
            .prepare(`
      SELECT bli.id as item_id, bli.layer_id, bli.item_type, bli.uri, bli.local_name,
             bli.label, bli.description, bli.parent_uri,
             bl.name as layer_name, bl.slug as layer_slug
      FROM onto_base_layer_items bli
      JOIN onto_project_layers pl ON pl.layer_id = bli.layer_id AND pl.project_id = ?
      JOIN onto_base_layers bl ON bl.id = bli.layer_id
      WHERE bli.item_type IN ('class', 'individual')
    `)
            .all(projectId) as any[];

        // Load dismissals
        const dismissals = db
            .prepare(
                'SELECT node_id, item_id FROM onto_layer_suggestion_dismissals WHERE project_id = ?'
            )
            .all(projectId) as any[];
        const dismissedSet = new Set(
            dismissals.map((d: any) => `${d.node_id}-${d.item_id}`)
        );

        log(
            db,
            jobId,
            'scan',
            'info',
            `Found ${customNodes.length} unmapped nodes, ${baseItems.length} base items`
        );
        completeStage(db, jobId, 'scan');
        checkAbort(signal, db, jobId);

        if (customNodes.length === 0) {
            log(db, jobId, 'scan', 'info', 'No unmapped nodes to process');
            updateJob(db, jobId, {
                status: 'completed',
                pipeline_stage: 'done',
                progress_pct: 100,
                current_step: 'No unmapped nodes'
            });
            log(
                db,
                jobId,
                'pipeline',
                'milestone',
                'Pipeline complete!',
                'All nodes already mapped'
            );
            return;
        }

        if (baseItems.length === 0) {
            log(
                db,
                jobId,
                'scan',
                'warn',
                'No base layer items available — activate layers first'
            );
            updateJob(db, jobId, {
                status: 'completed',
                pipeline_stage: 'done',
                progress_pct: 100,
                current_step: 'No base layers active'
            });
            log(
                db,
                jobId,
                'pipeline',
                'milestone',
                'Pipeline complete!',
                'No base layers to map against'
            );
            return;
        }

        // ── Stage: embed ──────────────────────────────────────────────────────────
        updateJob(db, jobId, {
            pipeline_stage: 'embed',
            progress_pct: 15,
            current_step: `Embedding ${customNodes.length} nodes + ${baseItems.length} base items...`
        });

        const nodeTexts = customNodes.map((n: any) =>
            n.description ? `${n.name}: ${n.description}` : n.name
        );
        const itemTexts = baseItems.map((i: any) => baseItemText(i));

        const extractor = await getExtractor();
        const output = await extractor([...nodeTexts, ...itemTexts], {
            pooling: 'mean',
            normalize: true
        });

        const data = output.data as Float32Array;
        const embDim = (output.dims as number[])[1];

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

        log(
            db,
            jobId,
            'embed',
            'success',
            `Embedded ${customNodes.length + baseItems.length} items`
        );
        completeStage(db, jobId, 'embed');
        checkAbort(signal, db, jobId);

        // ── Stage: evaluate ───────────────────────────────────────────────────────
        updateJob(db, jobId, {
            pipeline_stage: 'evaluate',
            progress_pct: 35,
            current_step: `Scoring ${customNodes.length * baseItems.length} pairs by embedding similarity...`
        });

        // Find top-5 candidates per node
        const TOP_K = 5;
        interface Candidate {
            nodeIdx: number;
            itemIdx: number;
            similarity: number;
        }
        const allCandidates: Candidate[] = [];

        for (let ni = 0; ni < customNodes.length; ni++) {
            const scored: Array<{ idx: number; sim: number }> = [];
            for (let ii = 0; ii < baseItems.length; ii++) {
                if (
                    dismissedSet.has(
                        `${customNodes[ni].id}-${baseItems[ii].item_id}`
                    )
                )
                    continue;
                const sim = dotProduct(nodeEmbeddings[ni], itemEmbeddings[ii]);
                if (sim >= threshold) scored.push({ idx: ii, sim });
            }
            scored.sort((a, b) => b.sim - a.sim);
            for (const s of scored.slice(0, TOP_K)) {
                allCandidates.push({
                    nodeIdx: ni,
                    itemIdx: s.idx,
                    similarity: s.sim
                });
            }
        }

        log(
            db,
            jobId,
            'evaluate',
            'info',
            `Found ${allCandidates.length} embedding candidates across ${customNodes.length} nodes`
        );

        // LLM evaluation (Claude) — with project-level caching for resumability
        let llmResults: Array<{
            nodeIdx: number;
            itemIdx: number;
            match_type: string;
            confidence: number;
        }> = [];
        const llmAvailable = isLLMAvailable();

        if (llmAvailable && allCandidates.length > 0) {
            updateJob(db, jobId, { current_step: 'Checking LLM cache...' });

            // ── Load cached LLM results ────────────────────────────────────────────
            const cachedRows = db
                .prepare(
                    'SELECT node_id, item_id, match_type, confidence FROM onto_map_cache WHERE project_id = ?'
                )
                .all(projectId) as any[];
            const cacheMap = new Map<
                string,
                { match_type: string; confidence: number }
            >();
            for (const row of cachedRows) {
                cacheMap.set(`${row.node_id}-${row.item_id}`, {
                    match_type: row.match_type,
                    confidence: row.confidence
                });
            }

            // ── Separate cached vs uncached candidates ─────────────────────────────
            const uncachedCandidates: typeof allCandidates = [];
            let cachedHits = 0;

            for (const c of allCandidates) {
                const nodeId = customNodes[c.nodeIdx].id;
                const itemId = baseItems[c.itemIdx].item_id;
                const cached = cacheMap.get(`${nodeId}-${itemId}`);
                if (cached) {
                    if (cached.match_type !== 'no_match') {
                        llmResults.push({
                            nodeIdx: c.nodeIdx,
                            itemIdx: c.itemIdx,
                            match_type: cached.match_type,
                            confidence: cached.confidence
                        });
                    }
                    cachedHits++;
                } else {
                    uncachedCandidates.push(c);
                }
            }

            if (cachedHits > 0) {
                log(
                    db,
                    jobId,
                    'evaluate',
                    'info',
                    `${cachedHits} pairs loaded from cache, ${uncachedCandidates.length} need LLM evaluation`
                );
            }

            // ── LLM evaluate only uncached pairs ───────────────────────────────────
            if (uncachedCandidates.length > 0) {
                updateJob(db, jobId, {
                    current_step: `Running LLM evaluation — ${uncachedCandidates.length} uncached pairs...`
                });

                const pairs = uncachedCandidates.map((c, i) => {
                    const node = customNodes[c.nodeIdx];
                    const item = baseItems[c.itemIdx];
                    return {
                        id: i,
                        custom: {
                            name: node.name,
                            description: node.description || '',
                            type: node.node_type
                        },
                        base: {
                            name: splitCamelCase(
                                stripPrefix(item.label || item.local_name)
                            ),
                            uri: item.uri,
                            description: item.description || '',
                            layer: item.layer_name
                        },
                        embedding_sim: c.similarity
                    };
                });

                const insertCache = db.prepare(
                    'INSERT OR REPLACE INTO onto_map_cache (project_id, node_id, item_id, match_type, confidence) VALUES (?, ?, ?, ?, ?)'
                );

                const BATCH_SIZE = 15;
                const totalBatches = Math.ceil(pairs.length / BATCH_SIZE);
                const totalPairs = pairs.length + cachedHits;

                for (
                    let batchStart = 0;
                    batchStart < pairs.length;
                    batchStart += BATCH_SIZE
                ) {
                    const batch = pairs.slice(
                        batchStart,
                        batchStart + BATCH_SIZE
                    );
                    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
                    const pairsProcessed = batchStart + cachedHits;
                    const pct =
                        35 + Math.round((pairsProcessed / totalPairs) * 30);
                    updateJob(db, jobId, {
                        progress_pct: pct,
                        current_step: `Batch ${batchNum}/${totalBatches} · ${pairsProcessed}/${totalPairs} pairs evaluated`
                    });

                    // Check abort before each batch
                    checkAbort(signal, db, jobId);

                    // Delay between batches to avoid rate limits
                    if (batchStart > 0)
                        await new Promise(r => setTimeout(r, 3000));

                    try {
                        const parsed = await jsonCompletion<any>({
                            prompt: `You are an ontology alignment expert. For each pair, classify the relationship between a CUSTOM domain term and a BASE vocabulary term.

Classify as ONE of:
- "same": Essentially the same concept (identical or near-identical meaning)
- "is_a": Custom is a specific type/subclass of base (e.g. "Golden Retriever" is_a "Dog")
- "related": Meaningfully related but not identical or hierarchical
- "no_match": No meaningful semantic relationship

Be precise: "same" means truly equivalent concepts, not just related ones. "is_a" means strict taxonomic subsumption.

Return a JSON array: [{"id": <number>, "match_type": "<same|is_a|related|no_match>", "confidence": <0.0-1.0>}]

Pairs:
${JSON.stringify(batch, null, 2)}`,
                            temperature: 0.1,
                            maxTokens: 4096,
                            onRetry: event => {
                                try {
                                    const waitSec = Math.round(
                                        event.waitMs / 1000
                                    );
                                    const h = event.headers || {};

                                    // Show all headers that could be useful for debugging rate limits
                                    const interesting = [
                                        'retry-after',
                                        'x-ratelimit-limit-requests',
                                        'x-ratelimit-limit-tokens',
                                        'x-ratelimit-remaining-requests',
                                        'x-ratelimit-remaining-tokens',
                                        'x-ratelimit-reset-requests',
                                        'x-ratelimit-reset-tokens',
                                        'x-should-retry',
                                        'request-id',
                                        'anthropic-organization-id'
                                    ];
                                    const headerParts: string[] = [];
                                    for (const key of interesting) {
                                        if (h[key])
                                            headerParts.push(
                                                `${key}: ${h[key]}`
                                            );
                                    }
                                    const headerStr =
                                        headerParts.length > 0
                                            ? headerParts.join(' · ')
                                            : 'no rate-limit headers (OAuth)';

                                    updateJob(db, jobId, {
                                        current_step: `Rate limited (${event.status}) — waiting ${waitSec}s, retry ${event.attempt}/${event.maxRetries} (batch ${batchNum}/${totalBatches})`
                                    });
                                    log(
                                        db,
                                        jobId,
                                        'evaluate',
                                        'warn',
                                        `Rate limited (${event.status}) — retry ${event.attempt}/${event.maxRetries}, waiting ${waitSec}s`,
                                        `Batch ${batchNum}/${totalBatches}\n${headerStr}`,
                                        {
                                            chunk: batchNum,
                                            total: totalBatches,
                                            headers: h
                                        }
                                    );
                                } catch (e) {
                                    // NEVER let onRetry throw — it kills the retry loop
                                    console.error(
                                        '[map-pipeline] onRetry callback error (swallowed):',
                                        e
                                    );
                                }
                            }
                        });

                        const results = Array.isArray(parsed)
                            ? parsed
                            : parsed.results ||
                              parsed.evaluations ||
                              parsed.pairs ||
                              [];

                        // Cache ALL results (including no_match) so we never re-evaluate the same pair
                        let batchMatches = 0;
                        const cacheTx = db.transaction(() => {
                            for (const r of results) {
                                const pair = batch.find(
                                    (p: any) => p.id === r.id
                                );
                                if (!pair) continue;
                                const candidate = uncachedCandidates[pair.id];
                                const nodeId =
                                    customNodes[candidate.nodeIdx].id;
                                const itemId =
                                    baseItems[candidate.itemIdx].item_id;
                                const confidence = r.confidence || 0.7;

                                insertCache.run(
                                    projectId,
                                    nodeId,
                                    itemId,
                                    r.match_type,
                                    confidence
                                );

                                if (r.match_type !== 'no_match') {
                                    llmResults.push({
                                        nodeIdx: candidate.nodeIdx,
                                        itemIdx: candidate.itemIdx,
                                        match_type: r.match_type,
                                        confidence
                                    });
                                    batchMatches++;
                                }
                            }
                        });
                        cacheTx();

                        const pairsAfter =
                            Math.min(batchStart + BATCH_SIZE, pairs.length) +
                            cachedHits;
                        const pctAfter =
                            35 + Math.round((pairsAfter / totalPairs) * 30);
                        updateJob(db, jobId, {
                            progress_pct: pctAfter,
                            current_step: `Batch ${batchNum}/${totalBatches} done · ${pairsAfter}/${totalPairs} pairs · ${llmResults.length} matches so far`
                        });
                        log(
                            db,
                            jobId,
                            'evaluate',
                            'info',
                            `Batch ${batchNum}/${totalBatches} — ${batchMatches} matches (${llmResults.length} total)`,
                            undefined,
                            { chunk: batchNum, total: totalBatches }
                        );
                    } catch (err: any) {
                        log(
                            db,
                            jobId,
                            'evaluate',
                            'warn',
                            `Batch ${batchNum}/${totalBatches} failed: ${err.message}`,
                            undefined,
                            { chunk: batchNum, total: totalBatches }
                        );
                    }
                }
            } else {
                log(
                    db,
                    jobId,
                    'evaluate',
                    'info',
                    'All pairs served from cache — no LLM calls needed'
                );
            }

            const cacheLabel =
                cachedHits > 0 ? ` (${cachedHits} from cache)` : '';
            log(
                db,
                jobId,
                'evaluate',
                'success',
                `LLM found ${llmResults.length} matches${cacheLabel}`
            );
        } else if (!llmAvailable) {
            log(
                db,
                jobId,
                'evaluate',
                'warn',
                'LLM unavailable — using embeddings only'
            );
        }

        completeStage(db, jobId, 'evaluate');

        // ── Stage: propose ────────────────────────────────────────────────────────
        updateJob(db, jobId, {
            pipeline_stage: 'propose',
            progress_pct: 70,
            current_step: `Creating proposals from ${llmResults.length} LLM matches...`
        });

        const insertProposal = db.prepare(`
      INSERT INTO onto_pipeline_proposals (job_id, project_id, proposal_type, source_id, target_id, payload, confidence, status, decided_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        let proposalCount = 0;

        const tx = db.transaction(() => {
            if (llmResults.length > 0) {
                // Pick best match per node from LLM results
                const bestByNode = new Map<number, (typeof llmResults)[0]>();
                const typeRank = (t: string) =>
                    t === 'same' ? 3 : t === 'is_a' ? 2 : 1;

                for (const eval_ of llmResults) {
                    const existing = bestByNode.get(eval_.nodeIdx);
                    if (
                        !existing ||
                        typeRank(eval_.match_type) >
                            typeRank(existing.match_type) ||
                        (typeRank(eval_.match_type) ===
                            typeRank(existing.match_type) &&
                            eval_.confidence > existing.confidence)
                    ) {
                        bestByNode.set(eval_.nodeIdx, eval_);
                    }
                }

                for (const entry of Array.from(bestByNode.entries())) {
                    const [nodeIdx, eval_] = entry;
                    const node = customNodes[nodeIdx];
                    const item = baseItems[eval_.itemIdx];

                    // Determine proposal type based on match
                    const proposalType =
                        eval_.match_type === 'same'
                            ? 'link_to_base'
                            : eval_.match_type === 'is_a'
                              ? 'subclass_of'
                              : 'link_to_base';

                    const embCandidate = allCandidates.find(
                        c =>
                            c.nodeIdx === nodeIdx && c.itemIdx === eval_.itemIdx
                    );
                    const itemName = splitCamelCase(
                        stripPrefix(item.label || item.local_name)
                    );

                    insertProposal.run(
                        jobId,
                        projectId,
                        proposalType,
                        node.id,
                        item.item_id,
                        JSON.stringify({
                            node_id: node.id,
                            node_name: node.name,
                            node_description: node.description,
                            item_id: item.item_id,
                            layer_id: item.layer_id,
                            layer_name: item.layer_name,
                            layer_slug: item.layer_slug,
                            base_item_uri: item.uri,
                            base_item_name: itemName,
                            base_item_description: item.description,
                            match_type: eval_.match_type,
                            embedding_similarity: embCandidate?.similarity || 0,
                            llm_confidence: eval_.confidence
                        }),
                        eval_.confidence,
                        mode === 'automated' ? 'approved' : 'pending',
                        mode === 'automated' ? 'system' : null
                    );
                    proposalCount++;
                }
            } else {
                // Embedding-only fallback
                for (let ni = 0; ni < customNodes.length; ni++) {
                    const nodeCandidates = allCandidates.filter(
                        c => c.nodeIdx === ni
                    );
                    if (nodeCandidates.length === 0) continue;
                    const best = nodeCandidates[0];
                    if (best.similarity < 0.6) continue; // Higher threshold without LLM

                    const node = customNodes[ni];
                    const item = baseItems[best.itemIdx];
                    const itemName = splitCamelCase(
                        stripPrefix(item.label || item.local_name)
                    );

                    insertProposal.run(
                        jobId,
                        projectId,
                        'link_to_base',
                        node.id,
                        item.item_id,
                        JSON.stringify({
                            node_id: node.id,
                            node_name: node.name,
                            item_id: item.item_id,
                            layer_id: item.layer_id,
                            layer_name: item.layer_name,
                            base_item_uri: item.uri,
                            base_item_name: itemName,
                            embedding_similarity: best.similarity
                        }),
                        best.similarity,
                        mode === 'automated' ? 'approved' : 'pending',
                        mode === 'automated' ? 'system' : null
                    );
                    proposalCount++;
                }
            }
        });
        tx();

        log(
            db,
            jobId,
            'propose',
            'success',
            `Created ${proposalCount} mapping proposals`,
            mode === 'automated' ? 'Auto-approved' : 'Awaiting review'
        );

        completeStage(db, jobId, 'propose');

        // ── Complete ──────────────────────────────────────────────────────────────
        const finalStep =
            mode === 'automated'
                ? `${proposalCount} mappings auto-applied`
                : `${proposalCount} mapping proposals awaiting review`;

        // Ensure stages_complete is set even if incremental calls failed
        const completedStages = ['scan', 'embed', 'evaluate', 'propose'];
        updateJob(db, jobId, {
            status: 'completed',
            pipeline_stage: 'done',
            progress_pct: 100,
            current_step: finalStep,
            nodes_created: proposalCount,
            stages_complete: JSON.stringify(completedStages),
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
    } catch (err: any) {
        // checkAbort already wrote status + log — don't double-write
        if (err.message === 'Pipeline aborted') return;
        console.error(`[map-pipeline] Job #${jobId} failed:`, err);
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
