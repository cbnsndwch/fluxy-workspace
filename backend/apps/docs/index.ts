import fs from "fs";
import path from "path";
import { Router } from "express";
import { createHash } from "crypto";

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
  type: "file" | "folder";
  children?: DocTreeNode[];
};

export type DocFrontmatter = {
  title?: string;
  description?: string;
  tags?: string[];
  icon?: string;
  full?: boolean;
  [key: string]: unknown;
};

// ── Minimal YAML frontmatter parser/serializer ─────────────────────────────────

/**
 * Minimal YAML-like parser that handles the subset needed for doc frontmatter:
 * strings (quoted or unquoted), booleans, numbers, and flat arrays of strings.
 */
function parseMinimalYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!keyMatch) {
      i++;
      continue;
    }
    const key = keyMatch[1];
    const rest = keyMatch[2].trim();
    if (rest === "") {
      // Possibly an array block — collect `- item` lines
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        const item = lines[i]
          .replace(/^\s+-\s+/, "")
          .trim()
          .replace(/^["']|["']$/g, "");
        items.push(item);
        i++;
      }
      if (items.length > 0) result[key] = items;
      // If no items, skip (empty value)
    } else {
      // Scalar
      if (rest === "true") result[key] = true;
      else if (rest === "false") result[key] = false;
      else if (/^-?\d+(\.\d+)?$/.test(rest)) result[key] = Number(rest);
      else result[key] = rest.replace(/^["']|["']$/g, "");
      i++;
    }
  }
  return result;
}

/** Serialize a plain object to minimal YAML (no nesting support beyond string arrays). */
function serializeMinimalYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${String(item)}`);
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "number") {
      lines.push(`${key}: ${value}`);
    } else {
      const str = String(value);
      // Quote strings that contain special YAML characters or leading/trailing whitespace
      const needsQuotes = /[:#[\]{}&*!|>'"%@`,]/.test(str) || str.trim() !== str || str === "";
      lines.push(
        `${key}: ${needsQuotes ? `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : str}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Parse YAML frontmatter (--- delimited block) from markdown content.
 * Lenient: on any parse error or missing block returns empty FM and full content as body.
 */
function parseFrontmatter(content: string): { frontmatter: DocFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  try {
    const frontmatter = parseMinimalYaml(match[1]) as DocFrontmatter;
    return { frontmatter, body: match[2] };
  } catch {
    // Malformed FM — recover the markdown body by stripping the block
    return { frontmatter: {}, body: match[2] ?? content };
  }
}

/**
 * Reconstruct full file content from a frontmatter object + body.
 * If frontmatter has no meaningful keys, returns body unchanged (no empty --- blocks).
 */
function buildFileContent(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = serializeMinimalYaml(frontmatter);
  if (!yaml.trim()) return body;
  return `---\n${yaml}\n---\n${body}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeDocsPath(DOCS_DIR: string, relPath: string): string | null {
  const resolved = path.resolve(DOCS_DIR, relPath);
  if (!resolved.startsWith(DOCS_DIR + path.sep) && resolved !== DOCS_DIR) return null;
  return resolved;
}

/** Read meta.json for a directory. Returns {} if absent or unparseable. */
function readMeta(dir: string): DocMeta {
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {
    return {};
  }
}

/** Canonical lookup key for a node: filename without extension, or folder name. */
function nodeKey(node: DocTreeNode): string {
  return node.type === "file" ? node.name.replace(/\.mdx?$/, "") : node.name;
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
  const nodeMap = new Map<string, DocTreeNode>(nodes.map((n) => [nodeKey(n), n]));
  const result: DocTreeNode[] = [];
  const placed = new Set<string>();

  const addNode = (n: DocTreeNode) => {
    result.push(n);
    placed.add(nodeKey(n));
  };

  for (const item of pages) {
    if (item === "...") {
      // Remaining items, alphabetical
      nodes
        .filter((n) => !placed.has(nodeKey(n)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(addNode);
    } else if (item === "z...a") {
      // Remaining items, reverse alphabetical
      nodes
        .filter((n) => !placed.has(nodeKey(n)))
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
  const folders = entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((e) => e.isFile() && /\.mdx?$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));

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
        type: "folder",
        children,
      });
    }
  }

  for (const entry of files) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    // Read frontmatter to get the page title for the sidebar
    let title: string | undefined;
    try {
      const raw = fs.readFileSync(path.join(dir, entry.name), "utf-8");
      const { frontmatter } = parseFrontmatter(raw);
      if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
        title = frontmatter.title.trim();
      }
    } catch {
      /* ignore read errors */
    }
    nodes.push({ name: entry.name, title, path: rel, type: "file" });
  }

  return meta.pages?.length ? applyOrder(nodes, meta.pages) : nodes;
}

// ── Router ─────────────────────────────────────────────────────────────────────

export function createRouter(WORKSPACE: string) {
  const DOCS_DIR = path.join(WORKSPACE, "docs");
  const router = Router();

  // ── Tree ─────────────────────────────────────────────────────────────────
  router.get("/api/docs/tree", (_req, res) => {
    res.json(buildTree(DOCS_DIR, ""));
  });

  // ── File CRUD ────────────────────────────────────────────────────────────
  router.get("/api/docs/file", (req, res) => {
    const relPath = String(req.query.path || "");
    if (!relPath) return res.status(400).json({ error: "path required" });
    const abs = safeDocsPath(DOCS_DIR, relPath);
    if (!abs) return res.status(403).json({ error: "Invalid path" });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found" });
    const content = fs.readFileSync(abs, "utf-8");
    const hash = createHash("md5").update(content).digest("hex").slice(0, 8);
    const { frontmatter, body } = parseFrontmatter(content);
    res.json({ path: relPath, content, frontmatter, body, hash });
  });

  router.put("/api/docs/file", (req, res) => {
    const relPath = String(req.query.path || "");
    if (!relPath) return res.status(400).json({ error: "path required" });
    const abs = safeDocsPath(DOCS_DIR, relPath);
    if (!abs) return res.status(403).json({ error: "Invalid path" });
    const { content } = req.body;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content ?? "", "utf-8");
    res.json({ ok: true });
  });

  // PATCH: update only the frontmatter of an existing file, preserving the markdown body
  router.patch("/api/docs/file", (req, res) => {
    const relPath = String(req.query.path || "");
    if (!relPath) return res.status(400).json({ error: "path required" });
    const abs = safeDocsPath(DOCS_DIR, relPath);
    if (!abs) return res.status(403).json({ error: "Invalid path" });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found" });
    const currentContent = fs.readFileSync(abs, "utf-8");
    const { body } = parseFrontmatter(currentContent);
    const newFrontmatter = req.body as DocFrontmatter;
    const newContent = buildFileContent(newFrontmatter, body);
    fs.writeFileSync(abs, newContent, "utf-8");
    const hash = createHash("md5").update(newContent).digest("hex").slice(0, 8);
    res.json({ ok: true, hash });
  });

  router.post("/api/docs/file", (req, res) => {
    const { path: relPath, type } = req.body as { path: string; type: "file" | "folder" };
    if (!relPath) return res.status(400).json({ error: "path required" });
    const abs = safeDocsPath(DOCS_DIR, relPath);
    if (!abs) return res.status(403).json({ error: "Invalid path" });
    if (fs.existsSync(abs)) return res.status(409).json({ error: "Already exists" });
    if (type === "folder") {
      fs.mkdirSync(abs, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `# ${path.basename(relPath, path.extname(relPath))}\n\n`, "utf-8");
    }
    res.status(201).json({ ok: true, path: relPath });
  });

  router.delete("/api/docs/file", (req, res) => {
    const relPath = String(req.query.path || "");
    if (!relPath) return res.status(400).json({ error: "path required" });
    const abs = safeDocsPath(DOCS_DIR, relPath);
    if (!abs) return res.status(403).json({ error: "Invalid path" });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found" });
    fs.rmSync(abs, { recursive: true });
    res.json({ ok: true });
  });

  // ── Move / Rename ─────────────────────────────────────────────────────────
  router.post("/api/docs/move", (req, res) => {
    const { from: relFrom, to: relTo } = req.body as { from: string; to: string };
    if (!relFrom || !relTo) return res.status(400).json({ error: "from and to required" });
    if (relFrom === relTo)
      return res.status(400).json({ error: "Source and destination are the same" });
    const absFrom = safeDocsPath(DOCS_DIR, relFrom);
    const absTo = safeDocsPath(DOCS_DIR, relTo);
    if (!absFrom || !absTo) return res.status(403).json({ error: "Invalid path" });
    if (!fs.existsSync(absFrom)) return res.status(404).json({ error: "Source not found" });
    if (fs.existsSync(absTo))
      return res.status(409).json({ error: "A file or folder already exists at that path" });
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    fs.renameSync(absFrom, absTo);
    res.json({ ok: true, from: relFrom, to: relTo });
  });

  // ── Meta CRUD ─────────────────────────────────────────────────────────────
  // GET /api/docs/meta?folder=release-notes  (omit folder for root)
  router.get("/api/docs/meta", (req, res) => {
    const folder = String(req.query.folder ?? "");
    const abs = folder ? safeDocsPath(DOCS_DIR, folder) : DOCS_DIR;
    if (!abs) return res.status(403).json({ error: "Invalid path" });
    const metaPath = path.join(abs, "meta.json");
    if (!fs.existsSync(metaPath)) return res.json({});
    try {
      res.json(JSON.parse(fs.readFileSync(metaPath, "utf-8")));
    } catch {
      res.json({});
    }
  });

  // PUT /api/docs/meta?folder=release-notes  — body is the full DocMeta object
  router.put("/api/docs/meta", (req, res) => {
    const folder = String(req.query.folder ?? "");
    const abs = folder ? safeDocsPath(DOCS_DIR, folder) : DOCS_DIR;
    if (!abs) return res.status(403).json({ error: "Invalid path" });
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, "meta.json"), JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ ok: true });
  });

  return router;
}
