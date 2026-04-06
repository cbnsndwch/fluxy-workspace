import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { createHash } from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────────────

type DocMeta = {
    title?: string;
    defaultOpen?: boolean;
    pages?: string[];
};

type DocTreeNode = {
    name: string;
    title?: string;
    defaultOpen?: boolean;
    path: string;
    type: 'file' | 'folder';
    children?: DocTreeNode[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeDocsPath(DOCS_DIR: string, relPath: string): string | null {
    const resolved = path.resolve(DOCS_DIR, relPath);
    if (!resolved.startsWith(DOCS_DIR + path.sep) && resolved !== DOCS_DIR) return null;
    return resolved;
}

/** Read meta.json for a directory. Returns {} if absent or unparseable. */
function readMeta(dir: string): DocMeta {
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) return {};
    try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
        return {};
    }
}

/** Canonical lookup key for a node: filename without extension, or folder name. */
function nodeKey(node: DocTreeNode): string {
    return node.type === 'file' ? node.name.replace(/\.mdx?$/, '') : node.name;
}

/**
 * Apply meta.json `pages` ordering to a flat list of sibling nodes.
 *
 * Supported items:
 *   "name"   → include that specific file/folder by basename (no extension)
 *   "..."    → include all remaining items, alphabetical
 *   "z...a"  → include all remaining items, reverse alphabetical
 *
 * Items not mentioned in `pages` and not covered by a rest operator are omitted.
 */
function applyOrder(nodes: DocTreeNode[], pages: string[]): DocTreeNode[] {
    const nodeMap = new Map<string, DocTreeNode>(nodes.map(n => [nodeKey(n), n]));
    const result: DocTreeNode[] = [];
    const placed = new Set<string>();

    const addNode = (n: DocTreeNode) => {
        result.push(n);
        placed.add(nodeKey(n));
    };

    for (const item of pages) {
        if (item === '...') {
            // Remaining items, alphabetical
            nodes
                .filter(n => !placed.has(nodeKey(n)))
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(addNode);
        } else if (item === 'z...a') {
            // Remaining items, reverse alphabetical
            nodes
                .filter(n => !placed.has(nodeKey(n)))
                .sort((a, b) => b.name.localeCompare(a.name))
                .forEach(addNode);
        } else {
            const node = nodeMap.get(item);
            if (node && !placed.has(item)) addNode(node);
        }
    }

    return result;
}

function buildTree(dir: string, base: string): DocTreeNode[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const meta = readMeta(dir);
    const nodes: DocTreeNode[] = [];

    // Folders first (default alpha), files after — ordering applied later via meta.pages
    const folders = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter(e => e.isFile() && /\.mdx?$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of folders) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        const children = buildTree(path.join(dir, entry.name), rel);
        if (children.length > 0) {
            // Read this subfolder's own meta for title + defaultOpen to attach to the node
            const folderMeta = readMeta(path.join(dir, entry.name));
            nodes.push({
                name: entry.name,
                title: folderMeta.title,
                defaultOpen: folderMeta.defaultOpen,
                path: rel,
                type: 'folder',
                children,
            });
        }
    }

    for (const entry of files) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        nodes.push({ name: entry.name, path: rel, type: 'file' });
    }

    return meta.pages?.length ? applyOrder(nodes, meta.pages) : nodes;
}

// ── Router ─────────────────────────────────────────────────────────────────────

export function createRouter(WORKSPACE: string) {
    const DOCS_DIR = path.join(WORKSPACE, 'docs');
    const router = Router();

    // ── Tree ─────────────────────────────────────────────────────────────────
    router.get('/api/docs/tree', (_req, res) => {
        res.json(buildTree(DOCS_DIR, ''));
    });

    // ── File CRUD ────────────────────────────────────────────────────────────
    router.get('/api/docs/file', (req, res) => {
        const relPath = String(req.query.path || '');
        if (!relPath) return res.status(400).json({ error: 'path required' });
        const abs = safeDocsPath(DOCS_DIR, relPath);
        if (!abs) return res.status(403).json({ error: 'Invalid path' });
        if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });
        const content = fs.readFileSync(abs, 'utf-8');
        const hash = createHash('md5').update(content).digest('hex').slice(0, 8);
        res.json({ path: relPath, content, hash });
    });

    router.put('/api/docs/file', (req, res) => {
        const relPath = String(req.query.path || '');
        if (!relPath) return res.status(400).json({ error: 'path required' });
        const abs = safeDocsPath(DOCS_DIR, relPath);
        if (!abs) return res.status(403).json({ error: 'Invalid path' });
        const { content } = req.body;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content ?? '', 'utf-8');
        res.json({ ok: true });
    });

    router.post('/api/docs/file', (req, res) => {
        const { path: relPath, type } = req.body as { path: string; type: 'file' | 'folder' };
        if (!relPath) return res.status(400).json({ error: 'path required' });
        const abs = safeDocsPath(DOCS_DIR, relPath);
        if (!abs) return res.status(403).json({ error: 'Invalid path' });
        if (fs.existsSync(abs)) return res.status(409).json({ error: 'Already exists' });
        if (type === 'folder') {
            fs.mkdirSync(abs, { recursive: true });
        } else {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, `# ${path.basename(relPath, path.extname(relPath))}\n\n`, 'utf-8');
        }
        res.status(201).json({ ok: true, path: relPath });
    });

    router.delete('/api/docs/file', (req, res) => {
        const relPath = String(req.query.path || '');
        if (!relPath) return res.status(400).json({ error: 'path required' });
        const abs = safeDocsPath(DOCS_DIR, relPath);
        if (!abs) return res.status(403).json({ error: 'Invalid path' });
        if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });
        fs.rmSync(abs, { recursive: true });
        res.json({ ok: true });
    });

    // ── Meta CRUD ─────────────────────────────────────────────────────────────
    // GET /api/docs/meta?folder=release-notes  (omit folder for root)
    router.get('/api/docs/meta', (req, res) => {
        const folder = String(req.query.folder ?? '');
        const abs = folder ? safeDocsPath(DOCS_DIR, folder) : DOCS_DIR;
        if (!abs) return res.status(403).json({ error: 'Invalid path' });
        const metaPath = path.join(abs, 'meta.json');
        if (!fs.existsSync(metaPath)) return res.json({});
        try {
            res.json(JSON.parse(fs.readFileSync(metaPath, 'utf-8')));
        } catch {
            res.json({});
        }
    });

    // PUT /api/docs/meta?folder=release-notes  — body is the full DocMeta object
    router.put('/api/docs/meta', (req, res) => {
        const folder = String(req.query.folder ?? '');
        const abs = folder ? safeDocsPath(DOCS_DIR, folder) : DOCS_DIR;
        if (!abs) return res.status(403).json({ error: 'Invalid path' });
        fs.mkdirSync(abs, { recursive: true });
        fs.writeFileSync(path.join(abs, 'meta.json'), JSON.stringify(req.body, null, 2), 'utf-8');
        res.json({ ok: true });
    });

    return router;
}
