// oxlint-disable no-console
import { Router } from "express";
import type { Database } from "better-sqlite3";
import OpenAI from "openai";

const SEGMENTATION_PROMPT = `You analyze speech transcripts and extract complete, coherent ideas from an accumulating buffer.

Given a text buffer that may contain complete sentences/ideas plus an unfinished fragment:
- Return fully-formed sentences or coherent thoughts as separate items in the "complete" array — keep the original wording exactly
- Return any unfinished or trailing fragment in "remainder"
- If the entire buffer is one complete thought, put it in complete and set remainder to ""
- If the buffer is short or clearly unfinished (no sentence-ending punctuation, trailing "and/then/so/but"), return everything in remainder
- Never rephrase, summarize, or improve the text — exact original words only
- Split on natural sentence boundaries (., ?, !) or at clear thought transitions
Return ONLY valid JSON: { "complete": string[], "remainder": string }`;

const SYSTEM_PROMPT = `You are a Mermaid diagram generator. Convert spoken conversation transcripts about user flows, processes, or journeys into valid Mermaid flowchart syntax compatible with Mermaid v11.

Rules:
- Always start the diagram with exactly: flowchart TD
- The transcript may be incomplete, fragmented, or garbled (speech recognition errors) — infer intent generously
- If a chunk is totally unintelligible, skip it silently
- Use short, descriptive node labels (max 5-6 words each)
- ALWAYS wrap node labels in double quotes to avoid parse errors: NodeID["Label text"]
- Shapes: rectangles NodeID["Label"], rounded NodeID(["Label"]), decisions NodeID{"Label"}, circles NodeID(("Label"))
- Start/end nodes use stadium shape: Start(["Start"]) and End(["End"])
- Node IDs must be short camelCase slugs with no spaces or special characters (e.g. signUp, loginPage, dashboard)
- If a current diagram is provided, extend or refine it — do NOT restart unless new material fundamentally contradicts it
- Keep it under 25 nodes to stay readable
- Use --> for edges. Edge labels must also be quoted: A -->|"label"| B

Return ONLY valid JSON with exactly two keys:
{
  "diagram": "flowchart TD\\n    ...",
  "chunkNodeMap": { "1": ["nodeA", "nodeB"], "2": ["nodeC"] }
}

The chunkNodeMap maps each chunk's sequence number (as a string "1", "2", ...) to an array of node IDs in the diagram that best represent the content of that chunk. Include all chunks, even if a chunk maps to a node shared with another.`;

function buildPrompt(chunks: { text: string }[], currentDiagram?: string, remix = false): string {
  const numbered = chunks.map((c, i) => `[${i + 1}] ${c.text}`).join("\n");

  if (!currentDiagram || remix) {
    return `Transcript chunks:\n${numbered}\n\nGenerate a Mermaid flowchart TD for this user flow.`;
  }

  return `Current diagram:\n${currentDiagram}\n\nNew transcript chunks to incorporate:\n${numbered}\n\nUpdate/extend the diagram and return the complete updated flowchart.`;
}

function sanitize(raw: string): string {
  // Strip markdown code fences the AI sometimes wraps diagrams in
  let s = raw
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  // Ensure it starts with a flowchart directive
  if (!s.startsWith("flowchart") && !s.startsWith("graph")) {
    s = "flowchart TD\n" + s;
  }
  // Normalize CRLF → LF
  s = s.replace(/\r\n/g, "\n");
  return s;
}

export function createRouter(db: Database) {
  const router = Router();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // ── Tables ────────────────────────────────────────────────────────────────
  db.exec(`
        CREATE TABLE IF NOT EXISTS flow_sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL DEFAULT 'Session',
            created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS flow_chunks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  INTEGER NOT NULL REFERENCES flow_sessions(id) ON DELETE CASCADE,
            text        TEXT    NOT NULL,
            sequence    INTEGER NOT NULL,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS flow_diagrams (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id      INTEGER NOT NULL REFERENCES flow_sessions(id) ON DELETE CASCADE,
            mermaid         TEXT    NOT NULL,
            chunk_node_map  TEXT,
            generated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );
    `);
  // Migrate: add chunk_node_map column if it doesn't exist yet
  try {
    db.exec(`ALTER TABLE flow_diagrams ADD COLUMN chunk_node_map TEXT`);
  } catch {
    /* already exists */
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  router.get("/api/flow-capture/sessions", (_req, res) => {
    const rows = db
      .prepare(`
            SELECT s.id, s.name, s.created_at, s.updated_at,
                   COUNT(c.id) AS chunk_count
            FROM   flow_sessions s
            LEFT   JOIN flow_chunks c ON c.session_id = s.id
            GROUP  BY s.id
            ORDER  BY s.updated_at DESC
        `)
      .all();
    res.json(rows);
  });

  router.post("/api/flow-capture/sessions", (req, res) => {
    const name = (req.body.name as string | undefined) || "Session";
    const result = db.prepare(`INSERT INTO flow_sessions (name) VALUES (?)`).run(name);
    res.json({
      id: result.lastInsertRowid,
      name,
      chunk_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  router.get("/api/flow-capture/sessions/:id", (req, res) => {
    const session = db.prepare(`SELECT * FROM flow_sessions WHERE id = ?`).get(req.params.id);
    if (!session) return res.status(404).json({ error: "Not found" });

    const chunks = db
      .prepare(`SELECT * FROM flow_chunks WHERE session_id = ? ORDER BY sequence ASC`)
      .all(req.params.id);

    const latest = db
      .prepare(
        `SELECT mermaid, chunk_node_map FROM flow_diagrams WHERE session_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(req.params.id) as { mermaid: string; chunk_node_map?: string } | undefined;

    res.json({
      ...(session as object),
      chunks,
      diagram: latest?.mermaid ?? null,
      chunkNodeMap: latest?.chunk_node_map ? JSON.parse(latest.chunk_node_map) : {},
    });
  });

  router.patch("/api/flow-capture/sessions/:id", (req, res) => {
    const { name } = req.body as { name?: string };
    if (name) db.prepare(`UPDATE flow_sessions SET name = ? WHERE id = ?`).run(name, req.params.id);
    res.json({ ok: true });
  });

  router.delete("/api/flow-capture/sessions/:id", (req, res) => {
    db.prepare(`DELETE FROM flow_sessions WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  // ── Chunks ────────────────────────────────────────────────────────────────

  router.post("/api/flow-capture/sessions/:id/chunks", (req, res) => {
    const text = (req.body.text as string | undefined)?.trim();
    if (!text) return res.status(400).json({ error: "text required" });

    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM flow_chunks WHERE session_id = ?`)
      .get(req.params.id) as { n: number };

    const result = db
      .prepare(`INSERT INTO flow_chunks (session_id, text, sequence) VALUES (?, ?, ?)`)
      .run(req.params.id, text, n + 1);

    db.prepare(`UPDATE flow_sessions SET updated_at = datetime('now') WHERE id = ?`).run(
      req.params.id,
    );

    res.json({
      id: result.lastInsertRowid,
      session_id: Number(req.params.id),
      text,
      sequence: n + 1,
      created_at: new Date().toISOString(),
    });
  });

  router.patch("/api/flow-capture/sessions/:id/chunks/:chunkId", (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: "text required" });
    db.prepare(`UPDATE flow_chunks SET text = ? WHERE id = ? AND session_id = ?`).run(
      text.trim(),
      req.params.chunkId,
      req.params.id,
    );
    res.json({ ok: true });
  });

  router.delete("/api/flow-capture/sessions/:id/chunks/:chunkId", (req, res) => {
    db.prepare(`DELETE FROM flow_chunks WHERE id = ? AND session_id = ?`).run(
      req.params.chunkId,
      req.params.id,
    );
    res.json({ ok: true });
  });

  // ── Speech buffer segmentation ───────────────────────────────────────────

  router.post("/api/flow-capture/sessions/:id/analyze", async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.json({ complete: [], remainder: "" });

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SEGMENTATION_PROMPT },
          { role: "user", content: text.trim() },
        ],
        max_tokens: 600,
        temperature: 0.1,
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
      const parsed = JSON.parse(raw);
      res.json({
        complete: Array.isArray(parsed.complete) ? parsed.complete.filter(Boolean) : [],
        remainder: typeof parsed.remainder === "string" ? parsed.remainder : "",
      });
    } catch (err) {
      console.error("[flow-capture] analyze error:", err);
      // On failure, return entire buffer as remainder — no data loss
      res.json({ complete: [], remainder: text.trim() });
    }
  });

  // ── Diagram — manual save (source editor) ─────────────────────────────────

  router.put("/api/flow-capture/sessions/:id/diagram", (req, res) => {
    const { mermaid: code } = req.body as { mermaid?: string };
    if (!code?.trim()) return res.status(400).json({ error: "mermaid required" });
    db.prepare(`INSERT INTO flow_diagrams (session_id, mermaid) VALUES (?, ?)`).run(
      req.params.id,
      code.trim(),
    );
    db.prepare(`UPDATE flow_sessions SET updated_at = datetime('now') WHERE id = ?`).run(
      req.params.id,
    );
    res.json({ ok: true });
  });

  // ── Diagram generation ────────────────────────────────────────────────────

  router.post("/api/flow-capture/sessions/:id/diagram", async (req, res) => {
    const chunks = db
      .prepare(`SELECT text FROM flow_chunks WHERE session_id = ? ORDER BY sequence ASC`)
      .all(req.params.id) as { text: string }[];

    if (!chunks.length) return res.status(400).json({ error: "No chunks in session" });

    const { currentDiagram, remix = false } = req.body as {
      currentDiagram?: string;
      remix?: boolean;
    };

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(chunks, currentDiagram, remix) },
        ],
        max_tokens: 1500,
        temperature: 0.2,
        response_format: { type: "json_object" },
      });

      const raw = JSON.parse(completion.choices[0]?.message?.content?.trim() ?? "{}");
      const mermaid = sanitize(typeof raw.diagram === "string" ? raw.diagram : "");
      const chunkNodeMap: Record<string, string[]> =
        raw.chunkNodeMap && typeof raw.chunkNodeMap === "object" ? raw.chunkNodeMap : {};

      db.prepare(
        `INSERT INTO flow_diagrams (session_id, mermaid, chunk_node_map) VALUES (?, ?, ?)`,
      ).run(req.params.id, mermaid, JSON.stringify(chunkNodeMap));
      db.prepare(`UPDATE flow_sessions SET updated_at = datetime('now') WHERE id = ?`).run(
        req.params.id,
      );

      res.json({ diagram: mermaid, chunkNodeMap });
    } catch (err) {
      console.error("[flow-capture] AI error:", err);
      res.status(500).json({ error: "Diagram generation failed" });
    }
  });

  // ── AI title generation ───────────────────────────────────────────────────

  router.post("/api/flow-capture/sessions/:id/title", async (req, res) => {
    const chunks = db
      .prepare(`SELECT text FROM flow_chunks WHERE session_id = ? ORDER BY sequence ASC LIMIT 10`)
      .all(req.params.id) as { text: string }[];

    if (!chunks.length) return res.status(400).json({ error: "No chunks to summarize" });

    const combined = chunks.map((c, i) => `[${i + 1}] ${c.text}`).join("\n");

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You generate short, descriptive session titles. Return ONLY the title — 3 to 5 words, no punctuation, no quotes, no explanation. Capture the core topic or flow being described.",
          },
          {
            role: "user",
            content: `Transcript segments:\n${combined}\n\nGenerate a concise title:`,
          },
        ],
        max_tokens: 20,
        temperature: 0.3,
      });

      const name = (completion.choices[0]?.message?.content?.trim() ?? "Untitled Session")
        .replace(/^["']|["']$/g, "")
        .trim();

      db.prepare(
        `UPDATE flow_sessions SET name = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(name, req.params.id);
      res.json({ name });
    } catch (err) {
      console.error("[flow-capture] title gen error:", err);
      res.status(500).json({ error: "Title generation failed" });
    }
  });

  // ── Legacy single-shot endpoint (kept for compatibility) ──────────────────

  router.post("/api/flow-capture/diagram", async (req, res) => {
    const { transcript, currentDiagram } = req.body as {
      transcript?: string;
      currentDiagram?: string;
    };
    if (!transcript?.trim()) return res.status(400).json({ error: "transcript required" });

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt([{ text: transcript }], currentDiagram) },
        ],
        max_tokens: 1200,
        temperature: 0.2,
      });

      const diagram = sanitize(completion.choices[0]?.message?.content?.trim() ?? "");
      res.json({ diagram });
    } catch (err) {
      console.error("[flow-capture] legacy AI error:", err);
      res.status(500).json({ error: "Diagram generation failed" });
    }
  });

  return router;
}
