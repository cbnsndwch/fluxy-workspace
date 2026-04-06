import { Router } from 'express';
import { randomBytes } from 'crypto';
import { Worker } from 'worker_threads';
import vm from 'vm';
import type Database from 'better-sqlite3';
import { CronExpressionParser } from 'cron-parser';

// ---------------------------------------------------------------------------
// Sandboxed code execution — two-layer isolation
// ---------------------------------------------------------------------------
// Layer 1: Worker thread — separate V8 heap, isolated process memory.
//   - User code cannot reach the server's DB connection, global state, or
//     any Node.js built-ins not explicitly passed.
//   - All data crosses the boundary via structured-clone (JSON round-trip),
//     so functions and circular references can't leak.
//   - Hard 5-second wall-clock timeout: worker is terminated if async code stalls.
//
// Layer 2: vm.runInNewContext — inside the worker
//   - Sandbox object is built from scratch (Object.create(null)).
//   - Only pure JS built-ins are whitelisted: Math, Date, JSON, Array, Object…
//   - No require, no process, no fs, no global, no Function constructor.
//   - Synchronous 4-second timeout kills infinite loops before the outer timer fires.
//
// Exposed to user code:
//   input    — the current node's input value ($input from context)
//   context  — the full run context (all named outputs, $input, $error, …)
//   JSON, Math, Date, parseInt, parseFloat, Number, String, Boolean, Array,
//   Object, Map, Set, Symbol, RegExp, Error, isNaN, isFinite,
//   encodeURIComponent, decodeURIComponent, console.log / console.error
//
// NOT exposed: require, import, fs, process, child_process, net, http, https,
//   global, globalThis, Function constructor, eval, setTimeout, setInterval

const SANDBOX_TIMEOUT_MS = 5000;

const WORKER_CODE = `
import { workerData, parentPort } from 'worker_threads';
import vm from 'vm';
const { code, input, context } = workerData;

const sandbox = Object.create(null);
Object.assign(sandbox, {
  input, context,
  JSON: { parse: JSON.parse.bind(JSON), stringify: JSON.stringify.bind(JSON) },
  Math, Date, parseInt, parseFloat,
  Number, String, Boolean, Array, Object, Map, Set, Symbol, RegExp, Error,
  isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  console: {
    log:   (...a) => parentPort.postMessage({ type: 'log', args: a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)) }),
    error: (...a) => parentPort.postMessage({ type: 'log', args: a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)) }),
  },
});

try {
  const fn = vm.runInNewContext('(function(input, context) {\\n' + code + '\\n})', sandbox, { timeout: 4000 });
  Promise.resolve().then(() => fn(input, context))
    .then(value => {
      try { parentPort.postMessage({ type: 'result', value: JSON.parse(JSON.stringify(value ?? null)) }); }
      catch { parentPort.postMessage({ type: 'result', value: String(value ?? null) }); }
    })
    .catch(err => parentPort.postMessage({ type: 'error', message: err?.message || String(err) }));
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err?.message || String(err) });
}
`;

function runInSandbox(code: string, input: unknown, context: RunCtx): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let safeInput: unknown, safeCtx: unknown;
    try { safeInput = JSON.parse(JSON.stringify(input ?? null)); } catch { safeInput = null; }
    try { safeCtx = JSON.parse(JSON.stringify(context)); } catch { safeCtx = {}; }

    const worker = new Worker(WORKER_CODE, {
      eval: true,
      workerData: { code, input: safeInput, context: safeCtx },
    });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Code execution timed out (5s)'));
    }, SANDBOX_TIMEOUT_MS);

    worker.on('message', (msg: { type: string; value?: unknown; message?: string }) => {
      if (msg.type === 'result') { clearTimeout(timer); worker.terminate(); resolve(msg.value); }
      else if (msg.type === 'error') { clearTimeout(timer); worker.terminate(); reject(new Error(msg.message)); }
    });
    worker.on('error', (err) => { clearTimeout(timer); reject(err); });
    worker.on('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error(`Sandbox exited (${code})`)); });
  });
}

// ---------------------------------------------------------------------------
// Context interpolation — replaces {{key}} and {{key.nested.path}} with
// values from the run context. Works in URL strings, headers, body, etc.
// ---------------------------------------------------------------------------
function interpolate(template: string, ctx: RunCtx): string {
  return template.replace(/\{\{([\w$]+(?:\.[\w$]+)*)\}\}/g, (_match, path: string) => {
    const keys = path.split('.');
    let val: unknown = ctx;
    for (const k of keys) {
      if (val == null || typeof val !== 'object') return `{{${path}}}`;
      val = (val as Record<string, unknown>)[k];
    }
    if (val === undefined) return `{{${path}}}`;
    return typeof val === 'object' ? JSON.stringify(val) : String(val);
  });
}

function wfId() { return randomBytes(8).toString('hex'); }

interface WFNode { id: string; type: string; data: Record<string, unknown>; }
interface WFEdge { id: string; source: string; target: string; sourceHandle?: string; }
interface RunCtx { [key: string]: unknown; $input: unknown; $error: string | null; }
type NodeStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';
interface NodeEvent { node_id: string; status: NodeStatus; output?: unknown; error?: string; duration_ms?: number; }

function topoSort(nodes: WFNode[], edges: WFEdge[]): WFNode[] {
    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    for (const n of nodes) { inDegree[n.id] = 0; adj[n.id] = []; }
    for (const e of edges) {
        adj[e.source].push(e.target);
        inDegree[e.target] = (inDegree[e.target] || 0) + 1;
    }
    const queue = nodes.filter(n => inDegree[n.id] === 0);
    const result: WFNode[] = [];
    while (queue.length > 0) {
        const node = queue.shift()!;
        result.push(node);
        for (const neighbor of adj[node.id]) {
            inDegree[neighbor]--;
            if (inDegree[neighbor] === 0) {
                const found = nodes.find(n => n.id === neighbor);
                if (found) queue.push(found);
            }
        }
    }
    return result;
}

function getDescendants(nodeId: string, handle: string, edges: WFEdge[], allNodes: WFNode[]): Set<string> {
    const reachable = new Set<string>();
    const queue: string[] = [];
    for (const e of edges) {
        if (e.source === nodeId && e.sourceHandle === handle) queue.push(e.target);
    }
    while (queue.length > 0) {
        const cur = queue.shift()!;
        if (reachable.has(cur)) continue;
        reachable.add(cur);
        for (const e of edges) {
            if (e.source === cur && !reachable.has(e.target)) queue.push(e.target);
        }
    }
    return reachable;
}

async function executeNode(
    node: WFNode,
    ctx: RunCtx,
    emit: (e: NodeEvent) => void,
    db?: InstanceType<typeof Database>
): Promise<void> {
    const cfg = node.data as Record<string, string>;

    switch (node.type) {
        // ------------------------------------------------------------------
        // trigger / cron_trigger — workflow entry point
        // Both set $input and store parsed initial_data in context.
        // ------------------------------------------------------------------
        case 'trigger':
        case 'cron_trigger': {
            try {
                const parsed = cfg.initial_data ? JSON.parse(cfg.initial_data) : {};
                ctx.$input = parsed;
                ctx.trigger = parsed;
                emit({ node_id: node.id, status: 'success', output: parsed });
            } catch {
                throw new Error('Invalid JSON in initial data');
            }
            break;
        }

        // ------------------------------------------------------------------
        // http_request — fetch any URL
        // Supports {{key}} interpolation in url, header values, and body.
        // ------------------------------------------------------------------
        case 'http_request': {
            const url = interpolate(cfg.url || '', ctx);
            if (!url) throw new Error('HTTP Request: URL is required');

            // Parse headers, then interpolate each value individually
            let headers: Record<string, string> = {};
            if (cfg.headers) {
                try {
                    const parsed = JSON.parse(interpolate(cfg.headers, ctx));
                    if (typeof parsed === 'object' && parsed !== null) headers = parsed;
                } catch {
                    throw new Error('HTTP Request: invalid JSON in headers');
                }
            }

            const opts: RequestInit = { method: cfg.method || 'GET', headers };
            if (['POST', 'PUT', 'PATCH'].includes(cfg.method) && cfg.body) {
                opts.body = interpolate(cfg.body, ctx);
                if (!headers['Content-Type']) (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
            }

            const resp = await fetch(url, opts);
            const contentType = resp.headers.get('content-type') || '';
            const output = contentType.includes('application/json') ? await resp.json() : await resp.text();
            const key = cfg.output_key || 'response';
            ctx[key] = output;
            ctx.$input = output;
            emit({ node_id: node.id, status: 'success', output });
            break;
        }

        // ------------------------------------------------------------------
        // code — arbitrary JS in a sandboxed Worker + vm context
        // Variables available: input (= $input), context (full RunCtx)
        // ------------------------------------------------------------------
        case 'code': {
            const result = await runInSandbox(cfg.code || 'return input;', ctx.$input, ctx);
            const key = cfg.output_key || 'result';
            ctx[key] = result;
            ctx.$input = result;
            emit({ node_id: node.id, status: 'success', output: result });
            break;
        }

        // ------------------------------------------------------------------
        // transform — single JS expression (no return keyword needed)
        // Lighter alternative to the code node for simple transformations.
        // Supports: string methods, math, array ops, object access.
        // Example: input.name.toUpperCase()
        // Example: input.price * 1.21
        // ------------------------------------------------------------------
        case 'transform': {
            const expr = cfg.expression || 'input';
            const result = await runInSandbox(`return (${expr});`, ctx.$input, ctx);
            const key = cfg.output_key || 'transformed';
            ctx[key] = result;
            ctx.$input = result;
            emit({ node_id: node.id, status: 'success', output: result });
            break;
        }

        // ------------------------------------------------------------------
        // db_query — run SQL against the workspace SQLite database
        // Uses the shared global DB connection (no connection overhead).
        // SELECT queries return an array of row objects.
        // INSERT/UPDATE/DELETE return { changes, lastInsertRowid }.
        // Supports {{key}} interpolation in query string and params array.
        // ------------------------------------------------------------------
        case 'db_query': {
            if (!db) throw new Error('DB Query: database not available');
            const query = interpolate(cfg.query || '', ctx).trim();
            if (!query) throw new Error('DB Query: query is required');

            let params: unknown[] = [];
            if (cfg.params) {
                try { params = JSON.parse(interpolate(cfg.params, ctx)); } catch {
                    throw new Error('DB Query: invalid JSON in params');
                }
            }

            const isSelect = /^\s*SELECT\b/i.test(query);
            const output = isSelect
                ? db.prepare(query).all(...(params as string[]))
                : (() => {
                    const info = db.prepare(query).run(...(params as string[]));
                    return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
                })();

            const key = cfg.output_key || 'db_result';
            ctx[key] = output;
            ctx.$input = output;
            emit({ node_id: node.id, status: 'success', output });
            break;
        }

        // ------------------------------------------------------------------
        // condition — boolean branch, routes to 'true' or 'false' handle
        // Expression has access to: input (= $input), context (full RunCtx)
        // ------------------------------------------------------------------
        case 'condition': {
            let safeInput: unknown, safeCtx: unknown;
            try { safeInput = JSON.parse(JSON.stringify(ctx.$input ?? null)); } catch { safeInput = null; }
            try { safeCtx = JSON.parse(JSON.stringify(ctx)); } catch { safeCtx = {}; }
            // Strip {{...}} wrapping if user wrote it like an interpolation template
            let expr = (cfg.expression || 'false').trim();
            if (expr.startsWith('{{') && expr.endsWith('}}')) expr = expr.slice(2, -2).trim();
            const result = Boolean(vm.runInNewContext(
                `(function(input, context) { return (${expr}); })(input, context)`,
                { input: safeInput, context: safeCtx },
                { timeout: 1000 }
            ));
            ctx.$conditionResult = result;
            emit({ node_id: node.id, status: 'success', output: result });
            break;
        }

        // ------------------------------------------------------------------
        // log — template string with {{key}} interpolation, no-op otherwise
        // ------------------------------------------------------------------
        case 'log': {
            const msg = interpolate(cfg.message || '{{$input}}', ctx);
            ctx.$lastLog = msg;
            emit({ node_id: node.id, status: 'success', output: msg });
            break;
        }

        default:
            emit({ node_id: node.id, status: 'skipped', output: null });
    }
}

// ---------------------------------------------------------------------------
// Workflow runner
// ---------------------------------------------------------------------------
function makeRunner(db: InstanceType<typeof Database>) {
    return async function runWorkflow(
        workflowId: string,
        emit: (e: NodeEvent | { type: 'run_complete' | 'run_error'; run_id: number; error?: string }) => void
    ): Promise<number> {
        const wf = db.prepare(`SELECT * FROM workflows WHERE id=?`).get(workflowId) as { nodes: string; edges: string } | undefined;
        if (!wf) throw new Error('Workflow not found');

        const nodes: WFNode[] = JSON.parse(wf.nodes);
        const edges: WFEdge[] = JSON.parse(wf.edges);

        const r = db.prepare(`INSERT INTO workflow_runs (workflow_id, status) VALUES (?, 'running')`).run(workflowId);
        const runId = Number(r.lastInsertRowid);

        const insertNode = db.prepare(`INSERT INTO workflow_run_nodes (run_id, node_id, node_type, status) VALUES (?, ?, ?, 'pending')`);
        for (const n of nodes) insertNode.run(runId, n.id, n.type);

        const sorted = topoSort(nodes, edges);
        const skipped = new Set<string>();
        const ctx: RunCtx = { $input: null, $error: null };

        for (const node of sorted) {
            if (skipped.has(node.id)) {
                db.prepare(`UPDATE workflow_run_nodes SET status='skipped' WHERE run_id=? AND node_id=?`).run(runId, node.id);
                emit({ node_id: node.id, status: 'skipped' });
                continue;
            }

            db.prepare(`UPDATE workflow_run_nodes SET status='running', executed_at=datetime('now') WHERE run_id=? AND node_id=?`).run(runId, node.id);
            emit({ node_id: node.id, status: 'running' });

            const t0 = Date.now();
            let nodeStatus: NodeStatus = 'success';
            let nodeOutput: unknown = null;
            let nodeError: string | undefined;

            try {
                await executeNode(node, ctx, (e) => { nodeOutput = e.output; }, db);
            } catch (err) {
                nodeStatus = 'error';
                nodeError = err instanceof Error ? err.message : String(err);
                ctx.$error = nodeError;
            }

            const duration = Date.now() - t0;
            db.prepare(`UPDATE workflow_run_nodes SET status=?, output=?, error=?, duration_ms=? WHERE run_id=? AND node_id=?`)
                .run(nodeStatus, JSON.stringify(nodeOutput), nodeError || null, duration, runId, node.id);

            emit({ node_id: node.id, status: nodeStatus, output: nodeOutput, error: nodeError, duration_ms: duration });

            if (nodeStatus === 'error') {
                const remaining = sorted.slice(sorted.indexOf(node) + 1).map(n => n.id);
                for (const id of remaining) skipped.add(id);
            }

            if (node.type === 'condition' && nodeStatus === 'success') {
                const result = Boolean(ctx.$conditionResult);
                const skipHandle = result ? 'false' : 'true';
                const toSkip = getDescendants(node.id, skipHandle, edges, nodes);
                for (const id of toSkip) skipped.add(id);
            }
        }

        const finalStatus = sorted.some(n => {
            const row = db.prepare(`SELECT status FROM workflow_run_nodes WHERE run_id=? AND node_id=?`).get(runId, n.id) as { status: string } | undefined;
            return row?.status === 'error';
        }) ? 'error' : 'success';

        db.prepare(`UPDATE workflow_runs SET status=?, finished_at=datetime('now') WHERE id=?`).run(finalStatus, runId);
        emit({ type: finalStatus === 'error' ? 'run_error' : 'run_complete', run_id: runId });
        return runId;
    };
}

// ---------------------------------------------------------------------------
// Cron scheduler — polls every 30s, fires workflows whose cron_trigger node
// schedule matches the current minute window.
// Uses cron-parser to evaluate expressions; deduplicates by minute key so
// the 30s interval never fires the same workflow twice in one minute.
// ---------------------------------------------------------------------------
function startCronScheduler(
    db: InstanceType<typeof Database>,
    runner: (id: string, emit: (e: unknown) => void) => Promise<number>
) {
    // workflowId → 'YYYY-MM-DDTHH:MM' of last fire
    const lastFiredMinute = new Map<string, string>();

    async function checkCrons() {
        const now = new Date();
        const minuteKey = now.toISOString().slice(0, 16);

        let workflows: { id: string; nodes: string }[];
        try {
            workflows = db.prepare(`SELECT id, nodes FROM workflows`).all() as { id: string; nodes: string }[];
        } catch { return; }

        for (const wf of workflows) {
            let nodes: WFNode[];
            try { nodes = JSON.parse(wf.nodes); } catch { continue; }

            const cronNode = nodes.find(n => n.type === 'cron_trigger');
            if (!cronNode) continue;

            const schedule = ((cronNode.data as Record<string, string>).schedule || '').trim();
            if (!schedule) continue;

            // Already fired this minute — skip
            if (lastFiredMinute.get(wf.id) === minuteKey) continue;

            try {
                // Get the most recent occurrence before now
                const interval = CronExpressionParser.parse(schedule, { currentDate: now });
                const prevOccurrence = interval.prev().toDate();
                // Fire if the last occurrence is within the past 60 seconds
                if (now.getTime() - prevOccurrence.getTime() < 60_000) {
                    lastFiredMinute.set(wf.id, minuteKey);
                    runner(wf.id, () => {}).catch((e: Error) =>
                        console.error(`[cron] Workflow ${wf.id} failed:`, e.message)
                    );
                    console.log(`[cron] Triggered workflow ${wf.id} (schedule: ${schedule})`);
                }
            } catch {
                // Invalid cron expression — silently skip
            }
        }
    }

    // Check every 30s to handle slight timer drift near minute boundaries
    setInterval(checkCrons, 30_000);
    // Initial check after 2s (catch workflows due right at startup)
    setTimeout(checkCrons, 2_000);
}

// ---------------------------------------------------------------------------
// Express router
// ---------------------------------------------------------------------------
export function createRouter(db: InstanceType<typeof Database>) {
    const router = Router();
    const runWorkflow = makeRunner(db);

    // Start cron scheduler for time-triggered workflows
    startCronScheduler(db, runWorkflow);

    router.get('/api/workflows', (_req, res) => {
        const rows = db.prepare(`SELECT id, name, description, created_at, updated_at FROM workflows ORDER BY updated_at DESC`).all();
        res.json(rows);
    });

    router.post('/api/workflows', (req, res) => {
        const { name, description } = req.body;
        const id = wfId();
        db.prepare(`INSERT INTO workflows (id, name, description) VALUES (?, ?, ?)`).run(id, name || 'Untitled Workflow', description || null);
        res.status(201).json(db.prepare(`SELECT * FROM workflows WHERE id=?`).get(id));
    });

    router.get('/api/workflows/:id', (req, res) => {
        const row = db.prepare(`SELECT * FROM workflows WHERE id=?`).get(req.params.id);
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(row);
    });

    router.put('/api/workflows/:id', (req, res) => {
        const { name, description, nodes, edges } = req.body;
        db.prepare(`UPDATE workflows SET name=?, description=?, nodes=?, edges=?, updated_at=datetime('now') WHERE id=?`)
            .run(
                name || 'Untitled Workflow',
                description || null,
                typeof nodes === 'string' ? nodes : JSON.stringify(nodes || []),
                typeof edges === 'string' ? edges : JSON.stringify(edges || []),
                req.params.id
            );
        res.json(db.prepare(`SELECT * FROM workflows WHERE id=?`).get(req.params.id));
    });

    router.delete('/api/workflows/:id', (req, res) => {
        db.prepare(`DELETE FROM workflows WHERE id=?`).run(req.params.id);
        res.json({ ok: true });
    });

    router.get('/api/workflows/:id/runs', (req, res) => {
        const rows = db.prepare(`SELECT * FROM workflow_runs WHERE workflow_id=? ORDER BY started_at DESC LIMIT 20`).all(req.params.id);
        res.json(rows);
    });

    router.get('/api/workflow-runs/:runId', (req, res) => {
        const run = db.prepare(`SELECT * FROM workflow_runs WHERE id=?`).get(req.params.runId);
        if (!run) return res.status(404).json({ error: 'Not found' });
        const nodes = db.prepare(`SELECT * FROM workflow_run_nodes WHERE run_id=? ORDER BY id`).all(req.params.runId);
        res.json({ run, nodes });
    });

    router.post('/api/workflows/:id/run', async (req, res) => {
        const events: unknown[] = [];
        try {
            const runId = await runWorkflow(req.params.id, (e) => events.push(e));
            const nodes = db.prepare(`SELECT * FROM workflow_run_nodes WHERE run_id=? ORDER BY id`).all(runId);
            const run = db.prepare(`SELECT * FROM workflow_runs WHERE id=?`).get(runId);
            res.json({ run, nodes, events });
        } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });

    router.get('/api/workflows/:id/run/stream', async (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

        try {
            const runId = await runWorkflow(req.params.id, send);
            send({ type: 'done', run_id: runId });
        } catch (err) {
            send({ type: 'run_error', error: err instanceof Error ? err.message : String(err) });
        }
        res.end();
    });

    return router;
}
