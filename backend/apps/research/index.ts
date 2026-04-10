import { Router } from "express";
import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Write a oneShot CRON entry so the research worker fires within ~30–60 seconds
function triggerImmediateResearch() {
  try {
    const cronsPath = path.join(process.cwd(), "CRONS.json");
    let crons: any[] = [];
    if (fs.existsSync(cronsPath)) {
      crons = JSON.parse(fs.readFileSync(cronsPath, "utf8"));
    }
    // Remove any existing research-now entry to avoid stacking up duplicates
    crons = crons.filter((c: any) => c.id !== "research-now");
    crons.push({
      id: "research-now",
      schedule: "* * * * *",
      task: "Process pending research topics immediately. See tasks/research-worker.md for full instructions.",
      enabled: true,
      oneShot: true,
    });
    fs.writeFileSync(cronsPath, JSON.stringify(crons, null, 2));
  } catch (e) {
    console.error("[research] Failed to schedule immediate trigger:", e);
  }
}

const REVISIT_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  twice_monthly: 14,
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function createRouter(db: InstanceType<typeof Database>) {
  const router = Router();

  // ── Topics ──────────────────────────────────────────────────────────────────

  router.get("/api/research/topics", (_req, res) => {
    const topics = db
      .prepare(`
            SELECT t.*,
                   (SELECT COUNT(*) FROM research_sessions s WHERE s.topic_id = t.id) AS session_count,
                   (SELECT s.id FROM research_sessions s WHERE s.topic_id = t.id ORDER BY s.created_at DESC LIMIT 1) AS latest_session_id,
                   (SELECT s.status FROM research_sessions s WHERE s.topic_id = t.id ORDER BY s.created_at DESC LIMIT 1) AS latest_session_status,
                   (SELECT s.completed_at FROM research_sessions s WHERE s.topic_id = t.id ORDER BY s.created_at DESC LIMIT 1) AS latest_session_completed_at,
                   (SELECT r.id FROM research_reports r JOIN research_sessions s ON r.session_id = s.id WHERE s.id = t.master_report_session_id) AS master_report_id
            FROM research_topics t
            ORDER BY t.created_at DESC
        `)
      .all();
    res.json(topics);
  });

  router.post("/api/research/topics", (req, res) => {
    const {
      title,
      description,
      detail_level = "standard",
      ongoing = 0,
      revisit_interval,
    } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });

    const r = db
      .prepare(`
            INSERT INTO research_topics (title, description, detail_level, ongoing, revisit_interval, status)
            VALUES (?, ?, ?, ?, ?, 'queued')
        `)
      .run(title, description || null, detail_level, ongoing ? 1 : 0, revisit_interval || null);

    // Auto-create first session
    db.prepare(`
            INSERT INTO research_sessions (topic_id, status)
            VALUES (?, 'queued')
        `).run(r.lastInsertRowid);

    triggerImmediateResearch();

    const topic = db.prepare(`SELECT * FROM research_topics WHERE id = ?`).get(r.lastInsertRowid);
    res.status(201).json(topic);
  });

  router.get("/api/research/topics/:id", (req, res) => {
    const topic = db.prepare(`SELECT * FROM research_topics WHERE id = ?`).get(req.params.id);
    if (!topic) return res.status(404).json({ error: "Not found" });
    res.json(topic);
  });

  router.put("/api/research/topics/:id", (req, res) => {
    const {
      title,
      description,
      detail_level,
      ongoing,
      revisit_interval,
      status,
      last_researched_at,
      next_revisit_at,
    } = req.body;
    const existing = db
      .prepare(`SELECT * FROM research_topics WHERE id = ?`)
      .get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: "Not found" });

    db.prepare(`
            UPDATE research_topics SET
                title = ?, description = ?, detail_level = ?, ongoing = ?, revisit_interval = ?,
                status = ?, last_researched_at = ?, next_revisit_at = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `).run(
      title ?? existing.title,
      description !== undefined ? description : existing.description,
      detail_level ?? existing.detail_level,
      ongoing !== undefined ? (ongoing ? 1 : 0) : existing.ongoing,
      revisit_interval !== undefined ? revisit_interval : existing.revisit_interval,
      status ?? existing.status,
      last_researched_at !== undefined ? last_researched_at : existing.last_researched_at,
      next_revisit_at !== undefined ? next_revisit_at : existing.next_revisit_at,
      req.params.id,
    );
    res.json(db.prepare(`SELECT * FROM research_topics WHERE id = ?`).get(req.params.id));
  });

  router.delete("/api/research/topics/:id", (req, res) => {
    db.prepare(`DELETE FROM research_topics WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  // Queue a new research run for an existing topic
  router.post("/api/research/topics/:id/queue", (req, res) => {
    const topic = db
      .prepare(`SELECT * FROM research_topics WHERE id = ?`)
      .get(req.params.id) as any;
    if (!topic) return res.status(404).json({ error: "Not found" });

    const session = db
      .prepare(`
            INSERT INTO research_sessions (topic_id, status)
            VALUES (?, 'queued')
        `)
      .run(req.params.id);

    db.prepare(
      `UPDATE research_topics SET status = 'queued', updated_at = datetime('now') WHERE id = ?`,
    ).run(req.params.id);

    triggerImmediateResearch();

    res
      .status(201)
      .json(
        db.prepare(`SELECT * FROM research_sessions WHERE id = ?`).get(session.lastInsertRowid),
      );
  });

  // ── Sessions ─────────────────────────────────────────────────────────────────

  router.get("/api/research/topics/:id/sessions", (req, res) => {
    const sessions = db
      .prepare(`
            SELECT s.*,
                   (SELECT COUNT(*) FROM research_findings f WHERE f.session_id = s.id) AS findings_count,
                   (SELECT r.id FROM research_reports r WHERE r.session_id = s.id) AS report_id
            FROM research_sessions s
            WHERE s.topic_id = ?
            ORDER BY s.created_at DESC
        `)
      .all(req.params.id);
    res.json(sessions);
  });

  router.get("/api/research/sessions/:id", (req, res) => {
    const session = db.prepare(`SELECT * FROM research_sessions WHERE id = ?`).get(req.params.id);
    if (!session) return res.status(404).json({ error: "Not found" });
    const findings = db
      .prepare(`SELECT * FROM research_findings WHERE session_id = ? ORDER BY created_at ASC`)
      .all(req.params.id);
    const report = db
      .prepare(`SELECT * FROM research_reports WHERE session_id = ?`)
      .get(req.params.id);
    res.json({ ...(session as object), findings, report });
  });

  router.put("/api/research/sessions/:id", (req, res) => {
    const { status, current_step, error, started_at, completed_at, session_type } = req.body;
    const existing = db
      .prepare(`SELECT * FROM research_sessions WHERE id = ?`)
      .get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: "Not found" });

    db.prepare(`
            UPDATE research_sessions SET
                status = ?, current_step = ?, error = ?, started_at = ?, completed_at = ?, session_type = ?
            WHERE id = ?
        `).run(
      status ?? existing.status,
      current_step !== undefined ? current_step : existing.current_step,
      error !== undefined ? error : existing.error,
      started_at !== undefined ? started_at : existing.started_at,
      completed_at !== undefined ? completed_at : existing.completed_at,
      session_type ?? existing.session_type,
      req.params.id,
    );
    res.json(db.prepare(`SELECT * FROM research_sessions WHERE id = ?`).get(req.params.id));
  });

  // ── Findings ─────────────────────────────────────────────────────────────────

  router.post("/api/research/sessions/:id/findings", (req, res) => {
    const { type = "fact", content, source_url, source_title } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });

    const r = db
      .prepare(`
            INSERT INTO research_findings (session_id, type, content, source_url, source_title)
            VALUES (?, ?, ?, ?, ?)
        `)
      .run(req.params.id, type, content, source_url || null, source_title || null);

    res
      .status(201)
      .json(db.prepare(`SELECT * FROM research_findings WHERE id = ?`).get(r.lastInsertRowid));
  });

  // ── Reports ──────────────────────────────────────────────────────────────────

  router.post("/api/research/sessions/:id/report", (req, res) => {
    const { content, report_type = "full" } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });

    // Upsert report
    db.prepare(`
            INSERT INTO research_reports (session_id, content, report_type)
            VALUES (?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET content = excluded.content, report_type = excluded.report_type
        `).run(req.params.id, content, report_type);

    res.json(db.prepare(`SELECT * FROM research_reports WHERE session_id = ?`).get(req.params.id));
  });

  // ── Research Queue (for the research worker) ──────────────────────────────────

  router.get("/api/research/queue", (_req, res) => {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    // Queued sessions (includes master_synthesis sessions)
    const queued = db
      .prepare(`
            SELECT s.*, t.title, t.description, t.detail_level, t.ongoing, t.revisit_interval,
                   t.last_researched_at AS topic_last_researched_at, t.delta_count, t.master_report_session_id
            FROM research_sessions s
            JOIN research_topics t ON s.topic_id = t.id
            WHERE s.status = 'queued'
            ORDER BY s.created_at ASC
        `)
      .all();

    // Ongoing topics due for revisit (no queued/in_progress session already)
    const dueForRevisit = db
      .prepare(`
            SELECT t.*
            FROM research_topics t
            WHERE t.ongoing = 1
              AND t.next_revisit_at IS NOT NULL
              AND t.next_revisit_at <= ?
              AND t.status NOT IN ('queued', 'in_progress')
              AND NOT EXISTS (
                  SELECT 1 FROM research_sessions s
                  WHERE s.topic_id = t.id AND s.status IN ('queued', 'in_progress')
              )
            ORDER BY t.next_revisit_at ASC
        `)
      .all(now);

    res.json({ queued, due_for_revisit: dueForRevisit });
  });

  // Complete a session — updates topic status + next_revisit_at for ongoing
  router.post("/api/research/sessions/:id/complete", (req, res) => {
    const { error } = req.body;
    const session = db
      .prepare(`SELECT * FROM research_sessions WHERE id = ?`)
      .get(req.params.id) as any;
    if (!session) return res.status(404).json({ error: "Not found" });

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const status = error ? "failed" : "completed";

    db.prepare(`
            UPDATE research_sessions SET status = ?, error = ?, completed_at = ? WHERE id = ?
        `).run(status, error || null, now, req.params.id);

    const topic = db
      .prepare(`SELECT * FROM research_topics WHERE id = ?`)
      .get(session.topic_id) as any;

    let nextRevisit: string | null = null;
    if (!error && topic.ongoing && topic.revisit_interval && REVISIT_DAYS[topic.revisit_interval]) {
      nextRevisit = addDays(REVISIT_DAYS[topic.revisit_interval]);
    }

    // Delta / master-synthesis logic
    let newDeltaCount = topic.delta_count ?? 0;
    let newMasterSessionId = topic.master_report_session_id ?? null;

    if (!error) {
      const sessionType = session.session_type ?? "full";
      if (sessionType === "delta") {
        // Increment delta count
        newDeltaCount = newDeltaCount + 1;
      } else if (sessionType === "master_synthesis") {
        // This session IS the new master — point to it, reset delta count
        newMasterSessionId = session.id;
        newDeltaCount = 0;
      } else if (sessionType === "full") {
        // A full (first-time) report also serves as the initial master
        newMasterSessionId = session.id;
        newDeltaCount = 0;
      }
      // 'no_update' sessions don't change delta count or master
    }

    db.prepare(`
            UPDATE research_topics SET
                status = ?,
                last_researched_at = ?,
                next_revisit_at = ?,
                delta_count = ?,
                master_report_session_id = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `).run(
      status,
      error ? topic.last_researched_at : now,
      nextRevisit,
      newDeltaCount,
      newMasterSessionId,
      session.topic_id,
    );

    res.json({ ok: true, next_revisit_at: nextRevisit, delta_count: newDeltaCount });
  });

  // Trigger master report synthesis for a topic
  // Creates a 'master_synthesis' queued session and schedules the research worker
  router.post("/api/research/topics/:id/synthesize", (req, res) => {
    const topic = db
      .prepare(`SELECT * FROM research_topics WHERE id = ?`)
      .get(req.params.id) as any;
    if (!topic) return res.status(404).json({ error: "Not found" });

    // Don't queue if one is already in-flight
    const existing = db
      .prepare(`
            SELECT id FROM research_sessions
            WHERE topic_id = ? AND session_type = 'master_synthesis' AND status IN ('queued', 'in_progress')
        `)
      .get(req.params.id);
    if (existing) return res.status(409).json({ error: "Master synthesis already in progress" });

    const session = db
      .prepare(`
            INSERT INTO research_sessions (topic_id, status, session_type)
            VALUES (?, 'queued', 'master_synthesis')
        `)
      .run(req.params.id);

    db.prepare(
      `UPDATE research_topics SET status = 'queued', updated_at = datetime('now') WHERE id = ?`,
    ).run(req.params.id);

    triggerImmediateResearch();

    res
      .status(201)
      .json(
        db.prepare(`SELECT * FROM research_sessions WHERE id = ?`).get(session.lastInsertRowid),
      );
  });

  // Get topic's existing source URLs (used by research worker for novelty detection)
  router.get("/api/research/topics/:id/known-urls", (req, res) => {
    const rows = db
      .prepare(`
            SELECT DISTINCT f.source_url
            FROM research_findings f
            JOIN research_sessions s ON f.session_id = s.id
            WHERE s.topic_id = ? AND f.source_url IS NOT NULL
        `)
      .all(req.params.id) as { source_url: string }[];
    res.json(rows.map((r) => r.source_url));
  });

  // ── Report sharing ────────────────────────────────────────────────────────────

  // Generate a share token for a report
  router.post("/api/research/reports/:reportId/share", (req, res) => {
    const report = db
      .prepare(`SELECT * FROM research_reports WHERE id = ?`)
      .get(req.params.reportId) as any;
    if (!report) return res.status(404).json({ error: "Not found" });

    const token = report.share_token ?? crypto.randomUUID();
    db.prepare(`UPDATE research_reports SET share_token = ? WHERE id = ?`).run(
      token,
      req.params.reportId,
    );
    res.json({ token, url: `/share/${token}` });
  });

  // Revoke share token
  router.delete("/api/research/reports/:reportId/share", (req, res) => {
    db.prepare(`UPDATE research_reports SET share_token = NULL WHERE id = ?`).run(
      req.params.reportId,
    );
    res.json({ ok: true });
  });

  // Public: get report by share token (no auth required)
  router.get("/api/research/public/:token", (req, res) => {
    const report = db
      .prepare(`SELECT * FROM research_reports WHERE share_token = ?`)
      .get(req.params.token) as any;
    if (!report) return res.status(404).json({ error: "Not found" });

    const session = db
      .prepare(`SELECT * FROM research_sessions WHERE id = ?`)
      .get(report.session_id) as any;
    const topic = db.prepare(`SELECT * FROM research_topics WHERE id = ?`).get(session.topic_id);
    const findings = db
      .prepare(`SELECT * FROM research_findings WHERE session_id = ? ORDER BY created_at ASC`)
      .all(report.session_id);

    res.json({ report, session, topic, findings });
  });

  return router;
}
