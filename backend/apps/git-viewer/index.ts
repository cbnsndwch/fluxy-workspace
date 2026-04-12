import { execSync } from 'child_process';
import { Router } from 'express';

// ── Git helper ────────────────────────────────────────────────────────────────

function git(workspace: string, args: string): string {
    try {
        return execSync(`git -C "${workspace}" ${args}`, {
            encoding: 'utf8',
            timeout: 10_000,
            maxBuffer: 20 * 1024 * 1024
        }).trim();
    } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        const out = (e.stdout || '').trim();
        if (out) return out;
        throw new Error(e.stderr || e.message || 'git command failed');
    }
}

function gitOr(workspace: string, args: string, fallback = ''): string {
    try {
        return git(workspace, args);
    } catch {
        return fallback;
    }
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseStatus(workspace: string) {
    const raw = gitOr(workspace, 'status --porcelain=v2 --branch');
    const lines = raw.split('\n');

    let branch = 'HEAD';
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;
    const staged: { code: string; path: string; oldPath?: string }[] = [];
    const unstaged: { code: string; path: string }[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
        if (line.startsWith('# branch.head ')) {
            branch = line.slice('# branch.head '.length);
        } else if (line.startsWith('# branch.upstream ')) {
            upstream = line.slice('# branch.upstream '.length);
        } else if (line.startsWith('# branch.ab ')) {
            const m = line.match(/\+(\d+) -(\d+)/);
            if (m) {
                ahead = parseInt(m[1]);
                behind = parseInt(m[2]);
            }
        } else if (line.startsWith('1 ')) {
            const parts = line.split(' ');
            const xy = parts[1];
            const filePath = parts.slice(8).join(' ');
            if (xy[0] !== '.') staged.push({ code: xy[0], path: filePath });
            if (xy[1] !== '.') unstaged.push({ code: xy[1], path: filePath });
        } else if (line.startsWith('2 ')) {
            // Rename / copy
            const parts = line.split(' ');
            const xy = parts[1];
            const rest = parts.slice(9).join(' ');
            const tab = rest.indexOf('\t');
            const newPath = rest.slice(tab + 1);
            const oldPath = rest.slice(0, tab);
            if (xy[0] !== '.')
                staged.push({ code: xy[0], path: newPath, oldPath });
            if (xy[1] !== '.') unstaged.push({ code: xy[1], path: newPath });
        } else if (line.startsWith('? ')) {
            untracked.push(line.slice(2));
        }
    }

    return {
        branch,
        upstream,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
        isClean:
            staged.length === 0 &&
            unstaged.length === 0 &&
            untracked.length === 0
    };
}

const SEP = '\x1f'; // unit separator — won't appear in git output

function parseLog(workspace: string, limit: number, skip: number) {
    const fmt = ['%H', '%h', '%s', '%an', '%ae', '%aI', '%P'].join(SEP);
    const raw = gitOr(
        workspace,
        `log --format="${fmt}%x1e" --max-count=${limit} --skip=${skip}`
    );
    if (!raw) return [];

    return raw
        .split('\x1e')
        .map(s => s.trim())
        .filter(Boolean)
        .map(block => {
            const [
                sha,
                shortSha,
                subject,
                authorName,
                authorEmail,
                date,
                parentsRaw
            ] = block.split(SEP);
            return {
                sha: sha.trim(),
                shortSha: shortSha.trim(),
                subject: subject.trim(),
                authorName: authorName.trim(),
                authorEmail: authorEmail.trim(),
                date: date.trim(),
                parents: parentsRaw?.trim() ? parentsRaw.trim().split(' ') : []
            };
        });
}

function parseBranches(workspace: string) {
    // Use \x1f as separator to avoid conflicts with branch subjects
    const fmt = `%(HEAD)${SEP}%(refname:short)${SEP}%(objectname:short)${SEP}%(subject)${SEP}%(upstream:short)${SEP}%(upstream:track)`;
    const raw = gitOr(workspace, `branch -a --format="${fmt}"`);
    if (!raw) return [];

    return raw
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [head, name, sha, subject, upstreamShort, upstreamTrack] =
                line.split(SEP);
            return {
                name: name.trim(),
                isCurrent: head.trim() === '*',
                isRemote: name.trim().startsWith('remotes/'),
                shortSha: sha.trim(),
                subject: subject.trim(),
                upstream: upstreamShort.trim() || null,
                upstreamTrack: upstreamTrack.trim() || null
            };
        });
}

function parseWorktrees(workspace: string) {
    const raw = gitOr(workspace, 'worktree list --porcelain');
    if (!raw) return [];

    const result: {
        path: string;
        sha: string;
        branch: string | null;
        isMain: boolean;
        isBare: boolean;
        isLocked: boolean;
    }[] = [];

    let cur: Partial<(typeof result)[0]> = {};
    let first = true;

    for (const line of raw.split('\n')) {
        if (line.startsWith('worktree ')) {
            if (cur.path !== undefined) result.push(cur as (typeof result)[0]);
            cur = {
                path: line.slice(9),
                sha: '',
                branch: null,
                isMain: first,
                isBare: false,
                isLocked: false
            };
            first = false;
        } else if (line.startsWith('HEAD ')) {
            cur.sha = line.slice(5, 12); // 7-char short sha
        } else if (line.startsWith('branch ')) {
            cur.branch = line.slice(7).replace('refs/heads/', '');
        } else if (line === 'bare') {
            cur.isBare = true;
        } else if (line.startsWith('locked')) {
            cur.isLocked = true;
        }
    }
    if (cur.path !== undefined) result.push(cur as (typeof result)[0]);

    return result;
}

function getCommitDetail(workspace: string, sha: string) {
    const fmt = ['%H', '%h', '%s', '%b', '%an', '%ae', '%aI', '%P'].join(SEP);
    const meta =
        gitOr(workspace, `show --no-patch --format="${fmt}%x1e" ${sha}`)
            .split('\x1e')[0]
            ?.trim() ?? '';

    const [
        fullSha,
        shortSha,
        subject,
        body,
        authorName,
        authorEmail,
        date,
        parentsRaw
    ] = meta.split(SEP);

    // File stats
    const stats = gitOr(workspace, `show --stat --no-patch ${sha}`);

    // Unified diff — cap at 300 KB
    let diff = gitOr(
        workspace,
        `show --unified=3 --no-color --format="" ${sha}`
    );
    const MAX = 300_000;
    const truncated = diff.length > MAX;
    if (truncated)
        diff =
            diff.slice(0, MAX) +
            '\n\n[... diff truncated — file too large ...]';

    return {
        sha: fullSha?.trim() ?? sha,
        shortSha: shortSha?.trim() ?? sha.slice(0, 7),
        subject: subject?.trim() ?? '',
        body: body?.trim() ?? '',
        authorName: authorName?.trim() ?? '',
        authorEmail: authorEmail?.trim() ?? '',
        date: date?.trim() ?? '',
        parents: parentsRaw?.trim() ? parentsRaw.trim().split(' ') : [],
        stats,
        diff,
        truncated
    };
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createRouter(workspace: string) {
    const router = Router();

    // Working tree status + branch info
    router.get('/api/git/status', (_req, res) => {
        try {
            res.json(parseStatus(workspace));
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // Paginated commit log
    router.get('/api/git/log', (req, res) => {
        const skip = Math.max(0, parseInt(String(req.query.skip ?? '0'), 10));
        const limit = Math.min(
            100,
            Math.max(1, parseInt(String(req.query.limit ?? '40'), 10))
        );
        try {
            const commits = parseLog(workspace, limit + 1, skip); // fetch one extra to detect hasMore
            const hasMore = commits.length > limit;
            res.json({
                commits: commits.slice(0, limit),
                skip,
                limit,
                hasMore
            });
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // Branch list
    router.get('/api/git/branches', (_req, res) => {
        try {
            res.json(parseBranches(workspace));
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // Worktree list
    router.get('/api/git/worktrees', (_req, res) => {
        try {
            res.json(parseWorktrees(workspace));
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    // Commit detail + diff
    router.get('/api/git/commit/:sha', (req, res) => {
        const { sha } = req.params;
        if (!/^[0-9a-f]{7,64}$/i.test(sha)) {
            return res.status(400).json({ error: 'Invalid SHA' });
        }
        try {
            res.json(getCommitDetail(workspace, sha));
        } catch (err) {
            res.status(404).json({ error: String(err) });
        }
    });

    // Diff of uncommitted changes (staged + unstaged)
    router.get('/api/git/uncommitted', (_req, res) => {
        try {
            const staged = gitOr(
                workspace,
                'diff --cached --unified=3 --no-color'
            );
            const unstaged = gitOr(workspace, 'diff --unified=3 --no-color');
            const combined = [staged, unstaged].filter(Boolean).join('\n');
            res.json({ diff: combined || '(no uncommitted changes)' });
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    return router;
}
