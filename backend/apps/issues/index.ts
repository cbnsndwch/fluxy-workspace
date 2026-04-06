import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { randomBytes } from 'crypto';
import type Database from 'better-sqlite3';

// ── App → file path hints (for generated task files) ────────────────────────
const APP_FILE_PATHS: Record<string, string[]> = {
    'app-ideas':     ['client/src/components/AppIdeas/', 'backend/apps/app-ideas/'],
    'issues':        ['client/src/components/WorkspaceIssues/', 'backend/apps/issues/'],
    'image-studio':  ['client/src/components/ImageGen/', 'backend/apps/image-gen/'],
    'marble-studio': ['client/src/components/MarbleStudio/', 'backend/apps/marble-studio/'],
    'research':      ['client/src/components/DeepResearch/', 'backend/apps/research/'],
    'workflow':      ['client/src/components/Workflows/', 'backend/apps/workflows/'],
    'db-viewer':     ['client/src/components/DBViewer/', 'backend/apps/db-viewer/'],
    'analytics':     ['client/src/components/Analytics/', 'backend/apps/analytics/'],
    'flow-capture':  ['client/src/components/FlowCapture/', 'backend/apps/flow-capture/'],
    'docs':          ['client/src/components/Docs/', 'backend/apps/docs/'],
    'all':           ['client/src/', 'backend/'],
};

// ── Issue worker task file generator ────────────────────────────────────────
function buildWorkerTask(issue: Record<string, unknown>, batchId: number | bigint, WORKSPACE: string): string {
    const id = issue.id as number;
    const title = issue.title as string;
    const description = (issue.description as string | null) ?? '(no description)';
    const app = (issue.app as string | null) ?? 'all';
    const priority = issue.priority as string;
    const category = issue.category as string;
    const GIT_ROOT = WORKSPACE;
    const WORKTREE = `${GIT_ROOT}/.claude/worktrees/issue-${id}`;
    const filePaths = (APP_FILE_PATHS[app] ?? APP_FILE_PATHS['all'])
        .map(p => `- \`${WORKTREE}/${p}\``)
        .join('\n');

    return `# Issue Worker: #${id} — ${title}

You are an autonomous agent. Your job is to fix a specific workspace issue in an isolated git worktree, then report back.

**Do not stop until the fix is committed and you have called the report-back endpoint.**

## Issue Details

| Field | Value |
|---|---|
| ID | #${id} |
| Title | ${title} |
| App | ${app} |
| Priority | ${priority} |
| Category | ${category} |
| Batch | ${batchId} |

**Description:**
${description}

## Relevant Files

These directories likely contain the code you need to modify:
${filePaths}

---

## Step 1 — Mark yourself as working

\`\`\`
PATCH /app/api/issues/${id}/agent-update
Body: { "agent_status": "working" }
\`\`\`

Use Bash:
\`\`\`bash
curl -s -X PATCH http://localhost:3000/app/api/issues/${id}/agent-update \\
  -H "Content-Type: application/json" \\
  -d '{"agent_status":"working"}'
\`\`\`

---

## Step 2 — Create a git worktree

The git repo root is at: \`${WORKSPACE}\`
The worktree should go at: \`${WORKSPACE}/.claude/worktrees/issue-${id}\`

\`\`\`bash
GIT_ROOT="${WORKSPACE}"
WORKTREE="$GIT_ROOT/.claude/worktrees/issue-${id}"
mkdir -p "$GIT_ROOT/.claude/worktrees"
git -C "$GIT_ROOT" worktree add "$WORKTREE" -b issue/${id} 2>/dev/null || git -C "$GIT_ROOT" worktree add "$WORKTREE" issue/${id}
\`\`\`

**All file reads and edits must be done from within the worktree, not the main workspace.** The workspace code is at:
- Frontend: \`$WORKTREE/client/src/\`
- Backend: \`$WORKTREE/backend/\`

---

## Step 3 — Understand and fix the issue

1. Read the relevant files from the worktree paths above
2. Understand what the issue is asking for
3. Make the minimal, focused change that fixes it
4. Do NOT add unrelated improvements or refactoring

---

## Step 4 — Commit your changes

\`\`\`bash
GIT_ROOT="${WORKSPACE}"
WORKTREE="$GIT_ROOT/.claude/worktrees/issue-${id}"
git -C "$WORKTREE" add -A
git -C "$WORKTREE" commit -m "fix(#${id}): ${title.replace(/"/g, '\\"')}"
\`\`\`

---

## Step 5 — Report back as done

\`\`\`bash
curl -s -X PATCH http://localhost:3000/app/api/issues/${id}/agent-update \\
  -H "Content-Type: application/json" \\
  -d '{"agent_status":"done","agent_branch":"issue/${id}","agent_log":"<BRIEF SUMMARY OF CHANGES>"}'
\`\`\`

Replace \`<BRIEF SUMMARY OF CHANGES>\` with 1–3 sentences describing what you changed.

---

## On failure

If you cannot fix the issue for any reason, report it:

\`\`\`bash
curl -s -X PATCH http://localhost:3000/app/api/issues/${id}/agent-update \\
  -H "Content-Type: application/json" \\
  -d '{"agent_status":"failed","agent_log":"<REASON>"}'
\`\`\`

Then stop.

---

## After reporting back

Log a brief note in today's daily notes: what you did (or why you failed) for issue #${id}.
`;
}

// ── Sync task file generator ─────────────────────────────────────────────────
function buildSyncTask(
    batchId: number | bigint,
    issues: Array<Record<string, unknown>>,
    WORKSPACE: string
): string {
    const gitRoot = WORKSPACE;
    const issueList = issues.map(i => `- #${i.id}: ${i.title} → branch \`issue/${i.id}\``).join('\n');
    const branchList = issues.map(i => `issue/${i.id}`).join(' ');
    const worktreeCleanup = issues.map(i =>
        `git -C "${gitRoot}" worktree remove "${gitRoot}/.claude/worktrees/issue-${i.id}" --force 2>/dev/null || true`
    ).join('\n');

    return `# Issue Sync: Batch #${batchId}

All agents in this batch have completed. Your job is to review the branches, check for conflicts, merge what you can, and report back to Diego.

## Batch Details

- **Batch ID**: ${batchId}
- **Git root**: \`${gitRoot}\`

## Issues & Branches

${issueList}

---

## Step 1 — Review each branch

For each branch, see what changed:

\`\`\`bash
${issues.map(i => `git -C "${gitRoot}" log main..issue/${i.id} --oneline`).join('\n')}
\`\`\`

And the full diff:

\`\`\`bash
${issues.map(i => `git -C "${gitRoot}" diff main...issue/${i.id}`).join('\n')}
\`\`\`

---

## Step 2 — Identify file overlaps

Check which files each branch touches:

\`\`\`bash
${issues.map(i => `echo "issue/${i.id}:"; git -C "${gitRoot}" diff --name-only main...issue/${i.id}`).join('\n')}
\`\`\`

If two branches touch the same file, there may be a conflict. Handle carefully.

---

## Step 3 — Merge branches

For each branch that doesn't conflict with anything already merged:

\`\`\`bash
${issues.map(i => `git -C "${gitRoot}" merge issue/${i.id} --no-ff -m "fix(#${i.id}): ${String(i.title).replace(/"/g, '\\"')}" || echo "CONFLICT on issue/${i.id}"`).join('\n')}
\`\`\`

For conflicting branches:
1. Abort the merge: \`git -C "${gitRoot}" merge --abort\`
2. Note the conflict in your report
3. Move on to the next branch

---

## Step 4 — Update issue statuses

For each successfully merged issue, mark it done:

\`\`\`bash
# For each merged issue id:
curl -s -X PATCH http://localhost:3000/app/api/issues/{id} \\
  -H "Content-Type: application/json" \\
  -d '{"status":"done"}'
\`\`\`

---

## Step 5 — Report back to the API

\`\`\`bash
curl -s -X POST http://localhost:3000/app/api/dispatch-batches/${batchId}/sync-complete \\
  -H "Content-Type: application/json" \\
  -d '{"status":"done","sync_report":"<MARKDOWN REPORT>"}'
\`\`\`

The report should include:
- **Merged**: which issues were successfully merged (with brief change summaries)
- **Conflicts**: which issues had conflicts and what they are
- **Action needed**: what Diego needs to review or decide

---

## Step 6 — Clean up worktrees

\`\`\`bash
${worktreeCleanup}
git -C "${gitRoot}" worktree prune
\`\`\`

---

## Step 7 — Send Diego a message

This is importance 9. Send a \`<Message title="Sync Complete — Batch #${batchId}" priority="high">\` with your sync report. Include:
- What was merged automatically
- What needs his attention (conflicts, failed agents)
- Any branch names he may want to inspect

Log a summary in today's daily notes.
`;
}

// ── CRONS.json helpers ───────────────────────────────────────────────────────
function readCrons(WORKSPACE: string): unknown[] {
    const cronsPath = path.join(WORKSPACE, 'CRONS.json');
    try { return JSON.parse(fs.readFileSync(cronsPath, 'utf-8')); } catch { return []; }
}

function writeCrons(WORKSPACE: string, crons: unknown[]): void {
    const cronsPath = path.join(WORKSPACE, 'CRONS.json');
    fs.writeFileSync(cronsPath, JSON.stringify(crons, null, 2) + '\n');
}

function addIssueCron(WORKSPACE: string, issueId: number): void {
    const crons = readCrons(WORKSPACE);
    const id = `issue-worker-${issueId}`;
    // Remove any existing entry for this issue (re-dispatch)
    const filtered = (crons as Array<Record<string, unknown>>).filter(c => c.id !== id);
    filtered.push({
        id,
        schedule: '* * * * *',
        task: `Fix workspace issue #${issueId}. See tasks/${id}.md for full instructions.`,
        enabled: true,
        oneShot: true,
    });
    writeCrons(WORKSPACE, filtered);
}

function addSyncCron(WORKSPACE: string, batchId: number | bigint): void {
    const crons = readCrons(WORKSPACE);
    const id = `issue-sync-${batchId}`;
    const filtered = (crons as Array<Record<string, unknown>>).filter(c => c.id !== id);
    filtered.push({
        id,
        schedule: '* * * * *',
        task: `Sync and merge completed issue branches for batch #${batchId}. See tasks/${id}.md for full instructions.`,
        enabled: true,
        oneShot: true,
    });
    writeCrons(WORKSPACE, filtered);
}

// ── Router ───────────────────────────────────────────────────────────────────

export function createRouter(db: InstanceType<typeof Database>, WORKSPACE: string) {
    const router = Router();
    const ATTACHMENTS_DIR = path.join(WORKSPACE, 'files', 'issue-attachments');
    const TASKS_DIR = path.join(WORKSPACE, 'tasks');
    fs.mkdirSync(TASKS_DIR, { recursive: true });

    // ── List ────────────────────────────────────────────────────────────────
    router.get('/api/issues', (req, res) => {
        const { status, priority, category, q } = req.query as Record<string, string>;
        let sql = 'SELECT * FROM workspace_issues WHERE 1=1';
        const params: unknown[] = [];
        if (status) { sql += ' AND status=?'; params.push(status); }
        if (priority) { sql += ' AND priority=?'; params.push(priority); }
        if (category) { sql += ' AND category=?'; params.push(category); }
        if (q) { sql += ' AND title LIKE ?'; params.push(`%${q}%`); }
        sql += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC";
        res.json(db.prepare(sql).all(...params));
    });

    // ── Create ──────────────────────────────────────────────────────────────
    router.post('/api/issues', (req, res) => {
        const { title, description, status, priority, category, app: issueApp, attachments } = req.body;
        if (!title) return res.status(400).json({ error: 'title required' });
        const r = db.prepare(`INSERT INTO workspace_issues (title,description,status,priority,category,app,attachments) VALUES (?,?,?,?,?,?,?)`)
            .run(title, description || null, status || 'open', priority || 'medium', category || 'improvement', issueApp || 'all', JSON.stringify(attachments || []));
        res.status(201).json(db.prepare(`SELECT * FROM workspace_issues WHERE id=?`).get(r.lastInsertRowid));
    });

    // ── Dispatch (must be before /:id routes) ────────────────────────────────
    router.post('/api/issues/dispatch', (req, res) => {
        const { issueIds } = req.body as { issueIds: number[] };
        if (!issueIds?.length) return res.status(400).json({ error: 'issueIds required' });

        // Create batch record
        const batchResult = db.prepare(
            `INSERT INTO dispatch_batches (issue_ids, status) VALUES (?, 'working')`
        ).run(JSON.stringify(issueIds));
        const batchId = batchResult.lastInsertRowid;

        // Ensure worktrees dir exists in workspace repo
        fs.mkdirSync(path.join(WORKSPACE, '.claude', 'worktrees'), { recursive: true });

        // Process each issue
        for (const id of issueIds) {
            const branchName = `issue/${id}`;
            db.prepare(`UPDATE workspace_issues SET status='in-progress', agent_status='queued', agent_branch=?, batch_id=?, dispatched_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
                .run(branchName, batchId, id);

            const issue = db.prepare(`SELECT * FROM workspace_issues WHERE id=?`).get(id) as Record<string, unknown>;
            if (!issue) continue;

            // Write task file
            const taskContent = buildWorkerTask(issue, batchId, WORKSPACE);
            fs.writeFileSync(path.join(TASKS_DIR, `issue-worker-${id}.md`), taskContent);

            // Add CRON entry
            addIssueCron(WORKSPACE, id);
        }

        const batch = db.prepare(`SELECT * FROM dispatch_batches WHERE id=?`).get(batchId);
        res.json({ batch });
    });

    // ── Upload (must be before /:id routes) ─────────────────────────────────
    router.post('/api/issues/upload', (req, res) => {
        const { data, name } = req.body as { data: string; name: string };
        if (!data) return res.status(400).json({ error: 'data required' });
        const ext = path.extname(name || '') || '.png';
        const filename = `${Date.now()}_${randomBytes(3).toString('hex')}${ext}`;
        const filepath = path.join(ATTACHMENTS_DIR, filename);
        fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
        res.json({ url: `/app/api/issue-files/${filename}` });
    });

    // ── Update (user) ────────────────────────────────────────────────────────
    router.patch('/api/issues/:id', (req, res) => {
        const allowed = ['title', 'description', 'status', 'priority', 'category', 'app', 'attachments'];
        const fields = Object.keys(req.body).filter(k => allowed.includes(k));
        if (!fields.length) return res.status(400).json({ error: 'No valid fields' });
        const sets = fields.map(f => `${f}=?`).join(', ');
        const vals = fields.map(f => f === 'attachments' ? JSON.stringify(req.body[f]) : req.body[f]);
        db.prepare(`UPDATE workspace_issues SET ${sets}, updated_at=datetime('now') WHERE id=?`).run(...vals, req.params.id);
        res.json(db.prepare(`SELECT * FROM workspace_issues WHERE id=?`).get(req.params.id));
    });

    // ── Agent update ─────────────────────────────────────────────────────────
    router.patch('/api/issues/:id/agent-update', (req, res) => {
        const { agent_status, agent_log, agent_branch } = req.body as {
            agent_status?: string;
            agent_log?: string;
            agent_branch?: string;
        };

        const sets: string[] = ['updated_at=datetime(\'now\')'];
        const vals: unknown[] = [];
        if (agent_status !== undefined) { sets.push('agent_status=?'); vals.push(agent_status); }
        if (agent_log !== undefined)    { sets.push('agent_log=?');    vals.push(agent_log); }
        if (agent_branch !== undefined) { sets.push('agent_branch=?'); vals.push(agent_branch); }

        db.prepare(`UPDATE workspace_issues SET ${sets.join(', ')} WHERE id=?`).run(...vals, req.params.id);
        const issue = db.prepare(`SELECT * FROM workspace_issues WHERE id=?`).get(req.params.id) as Record<string, unknown> | undefined;

        // Check if this was the last pending agent in the batch
        if (issue?.batch_id && (agent_status === 'done' || agent_status === 'failed')) {
            const batchId = issue.batch_id as number;
            const batchIssues = db.prepare(
                `SELECT * FROM workspace_issues WHERE batch_id=?`
            ).all(batchId) as Array<Record<string, unknown>>;

            const allDone = batchIssues.every(i => i.agent_status === 'done' || i.agent_status === 'failed');

            if (allDone) {
                // Create sync task and CRON
                const syncContent = buildSyncTask(batchId, batchIssues, WORKSPACE);
                fs.writeFileSync(path.join(TASKS_DIR, `issue-sync-${batchId}.md`), syncContent);
                addSyncCron(WORKSPACE, batchId);

                db.prepare(`UPDATE dispatch_batches SET status='syncing', updated_at=datetime('now') WHERE id=?`).run(batchId);
            }
        }

        res.json(issue ?? { ok: true });
    });

    // ── Replace (user) ───────────────────────────────────────────────────────
    router.put('/api/issues/:id', (req, res) => {
        const { title, description, status, priority, category, app: issueApp, attachments } = req.body;
        db.prepare(`UPDATE workspace_issues SET title=?,description=?,status=?,priority=?,category=?,app=?,attachments=?,updated_at=datetime('now') WHERE id=?`)
            .run(title, description || null, status || 'open', priority || 'medium', category || 'improvement', issueApp || 'all', JSON.stringify(attachments || []), req.params.id);
        res.json(db.prepare(`SELECT * FROM workspace_issues WHERE id=?`).get(req.params.id));
    });

    // ── Delete ───────────────────────────────────────────────────────────────
    router.delete('/api/issues/:id', (req, res) => {
        const issue = db.prepare(`SELECT attachments FROM workspace_issues WHERE id=?`).get(req.params.id) as { attachments: string } | undefined;
        if (issue) {
            try {
                const files: string[] = JSON.parse(issue.attachments || '[]');
                for (const url of files) {
                    const fp = path.join(ATTACHMENTS_DIR, path.basename(url));
                    if (fs.existsSync(fp)) fs.unlinkSync(fp);
                }
            } catch {}
        }
        db.prepare(`DELETE FROM workspace_issues WHERE id=?`).run(req.params.id);
        res.json({ ok: true });
    });

    // ── Attachment file ──────────────────────────────────────────────────────
    router.get('/api/issue-files/:filename', (req, res) => {
        const filepath = path.join(ATTACHMENTS_DIR, path.basename(req.params.filename));
        if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'not found' });
        fs.createReadStream(filepath).pipe(res);
    });

    // ── Dispatch batches ─────────────────────────────────────────────────────
    router.get('/api/dispatch-batches', (_req, res) => {
        const batches = db.prepare(
            `SELECT * FROM dispatch_batches ORDER BY created_at DESC LIMIT 20`
        ).all() as Array<Record<string, unknown>>;

        const enriched = batches.map(batch => {
            const issueIds: number[] = JSON.parse(batch.issue_ids as string);
            const issues = issueIds.length
                ? db.prepare(`SELECT id, title, agent_status, agent_log, agent_branch FROM workspace_issues WHERE id IN (${issueIds.map(() => '?').join(',')})`)
                    .all(...issueIds)
                : [];
            return { ...batch, issues };
        });

        res.json(enriched);
    });

    router.get('/api/dispatch-batches/:id', (req, res) => {
        const batch = db.prepare(`SELECT * FROM dispatch_batches WHERE id=?`).get(req.params.id) as Record<string, unknown> | undefined;
        if (!batch) return res.status(404).json({ error: 'not found' });
        const issueIds: number[] = JSON.parse(batch.issue_ids as string);
        const issues = issueIds.length
            ? db.prepare(`SELECT id, title, status, agent_status, agent_log, agent_branch FROM workspace_issues WHERE id IN (${issueIds.map(() => '?').join(',')})`)
                .all(...issueIds)
            : [];
        res.json({ ...batch, issues });
    });

    router.post('/api/dispatch-batches/:id/sync-complete', (req, res) => {
        const { status, sync_report } = req.body as { status: string; sync_report: string };
        db.prepare(`UPDATE dispatch_batches SET status=?, sync_report=?, updated_at=datetime('now') WHERE id=?`)
            .run(status || 'done', sync_report || '', req.params.id);
        res.json(db.prepare(`SELECT * FROM dispatch_batches WHERE id=?`).get(req.params.id));
    });

    return router;
}
