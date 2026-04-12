/**
 * Unified Pipeline Dispatch
 *
 * Creates pipeline jobs and dispatches them:
 * - Extract → agent CRON (existing behavior)
 * - Deduplicate → in-process (embeddings + optional LLM)
 * - Map → in-process (embeddings + LLM)
 * - Review → generates review package, awaits response
 */

import { PIPELINE_TYPES } from './types.js';

import type { PipelineType, PipelineMode } from './types.js';
import type Database from 'better-sqlite3';

// ── Abort registry — in-process pipelines register here ──────────────────────
const abortControllers = new Map<number, AbortController>();

export function registerAbort(jobId: number): AbortSignal {
    const ac = new AbortController();
    abortControllers.set(jobId, ac);
    return ac.signal;
}

export function unregisterAbort(jobId: number) {
    abortControllers.delete(jobId);
}

/** Abort a running in-process pipeline. Returns true if signal was sent. */
export function abortPipeline(jobId: number): boolean {
    const ac = abortControllers.get(jobId);
    if (ac) {
        ac.abort();
        abortControllers.delete(jobId);
        return true;
    }
    return false;
}

/** Check if a signal has been aborted; throw if so. */
export function checkAbort(
    signal: AbortSignal | undefined,
    db: Database.Database,
    jobId: number
) {
    if (signal?.aborted) {
        db.prepare(
            "UPDATE onto_extraction_jobs SET status = 'failed', error = 'Aborted by user', completed_at = datetime('now') WHERE id = ?"
        ).run(jobId);
        db.prepare(
            "INSERT INTO onto_pipeline_logs (job_id, stage, level, title) VALUES (?, 'pipeline', 'warn', 'Pipeline aborted by user')"
        ).run(jobId);
        throw new Error('Pipeline aborted');
    }
}

export interface CreatePipelineOpts {
    projectId: number;
    type: PipelineType;
    mode?: PipelineMode;
    config?: Record<string, any>;
    documentId?: number;
}

/**
 * Create a pipeline job record and return its ID.
 * Does NOT dispatch — call dispatchPipeline() separately.
 */
export function createPipelineJob(
    db: Database.Database,
    opts: CreatePipelineOpts
): number {
    const { projectId, type, mode, config, documentId } = opts;
    const typeDef = PIPELINE_TYPES[type];
    if (!typeDef) throw new Error(`Unknown pipeline type: ${type}`);

    const result = db
        .prepare(`
    INSERT INTO onto_extraction_jobs (project_id, document_id, type, pipeline_stage, status, config)
    VALUES (?, ?, ?, 'pending', 'queued', ?)
  `)
        .run(
            projectId,
            documentId || null,
            type,
            JSON.stringify({ mode: mode || 'supervised', ...config })
        );

    return Number(result.lastInsertRowid);
}

/**
 * Dispatch a pipeline job based on its type.
 * - Extract: generates task file + oneShot CRON (agent-driven)
 * - Deduplicate/Map: runs in-process (returns when done)
 * - Review: generates review package
 */
export async function dispatchPipeline(
    db: Database.Database,
    jobId: number
): Promise<void> {
    const job = db
        .prepare('SELECT * FROM onto_extraction_jobs WHERE id = ?')
        .get(jobId) as any;
    if (!job) throw new Error(`Job ${jobId} not found`);

    const type = (job.type || 'extract') as PipelineType;

    switch (type) {
        case 'extract': {
            // Use existing agent dispatch mechanism
            const mod = await import('../generate-task.js');
            mod.generateExtractionTask(db, jobId);
            break;
        }

        case 'deduplicate': {
            const signal = registerAbort(jobId);
            try {
                const mod = await import('./deduplicate.js');
                await mod.runDeduplicatePipeline(db, jobId, signal);
            } finally {
                unregisterAbort(jobId);
            }
            break;
        }

        case 'map': {
            const signal = registerAbort(jobId);
            try {
                const mod = await import('./map.js');
                await mod.runMapPipeline(db, jobId, signal);
            } finally {
                unregisterAbort(jobId);
            }
            break;
        }

        case 'review': {
            // TODO: generate review package
            db.prepare(
                "UPDATE onto_extraction_jobs SET status = 'running', pipeline_stage = 'generate', started_at = datetime('now') WHERE id = ?"
            ).run(jobId);
            // For now, just mark as awaiting response
            db.prepare(
                "UPDATE onto_extraction_jobs SET pipeline_stage = 'await_response', current_step = 'Waiting for reviewer response...' WHERE id = ?"
            ).run(jobId);
            break;
        }

        default:
            throw new Error(`No dispatcher for pipeline type: ${type}`);
    }
}
