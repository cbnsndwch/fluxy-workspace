// oxlint-disable no-console
import { Router } from "express";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";
import { WORKSPACE } from "../../db.js";

interface CronEntry {
  id: string;
  schedule: string;
  task: string;
  enabled: boolean;
  oneShot?: boolean;
}

function getNextRun(schedule: string): string | null {
  try {
    const interval = CronExpressionParser.parse(schedule);
    return interval.next().toISOString();
  } catch {
    return null;
  }
}

function readCrons(): CronEntry[] {
  const p = path.join(WORKSPACE, "CRONS.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function writeCrons(crons: CronEntry[]): void {
  const p = path.join(WORKSPACE, "CRONS.json");
  fs.writeFileSync(p, JSON.stringify(crons, null, 2));
}

export function createRouter(db: Database.Database) {
  const router = Router();

  // Create cron_runs table if it doesn't exist
  db.exec(`
        CREATE TABLE IF NOT EXISTS cron_runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            cron_id     TEXT NOT NULL,
            started_at  TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at TEXT,
            status      TEXT NOT NULL DEFAULT 'running',
            stdout      TEXT NOT NULL DEFAULT '',
            stderr      TEXT NOT NULL DEFAULT '',
            exit_code   INTEGER,
            trigger     TEXT NOT NULL DEFAULT 'scheduled'
        )
    `);

  // ── Cron CRUD ──────────────────────────────────────────────────────────────

  router.get("/api/schedules/crons", (_req, res) => {
    const crons = readCrons();
    res.json(crons.map((c) => ({ ...c, nextRun: c.enabled ? getNextRun(c.schedule) : null })));
  });

  router.post("/api/schedules/crons", (req, res) => {
    const { id, schedule, task, enabled = true, oneShot = false } = req.body;
    if (!id || !schedule || !task) {
      return res.status(400).json({ error: "id, schedule, and task are required" });
    }
    const crons = readCrons();
    if (crons.find((c) => c.id === id)) {
      return res.status(409).json({ error: `A cron with id '${id}' already exists` });
    }
    const entry: CronEntry = { id, schedule, task, enabled: Boolean(enabled) };
    if (oneShot) entry.oneShot = true;
    crons.push(entry);
    writeCrons(crons);
    res.json(entry);
  });

  router.put("/api/schedules/crons/:id", (req, res) => {
    const crons = readCrons();
    const idx = crons.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    const { schedule, task, enabled, oneShot } = req.body;
    if (schedule !== undefined) crons[idx].schedule = schedule;
    if (task !== undefined) crons[idx].task = task;
    if (enabled !== undefined) crons[idx].enabled = Boolean(enabled);
    if (oneShot !== undefined) {
      if (oneShot) crons[idx].oneShot = true;
      else delete crons[idx].oneShot;
    }
    writeCrons(crons);
    res.json(crons[idx]);
  });

  router.delete("/api/schedules/crons/:id", (req, res) => {
    const crons = readCrons();
    const idx = crons.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    crons.splice(idx, 1);
    writeCrons(crons);
    res.json({ ok: true });
  });

  router.patch("/api/schedules/crons/:id/toggle", (req, res) => {
    const crons = readCrons();
    const idx = crons.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    crons[idx].enabled = !crons[idx].enabled;
    writeCrons(crons);
    res.json(crons[idx]);
  });

  // ── Task Files ─────────────────────────────────────────────────────────────

  router.get("/api/schedules/taskfile/:cronId", (req, res) => {
    const filePath = path.join(WORKSPACE, "tasks", `${req.params.cronId}.md`);
    if (!fs.existsSync(filePath)) {
      return res.json({ exists: false, content: "" });
    }
    res.json({ exists: true, content: fs.readFileSync(filePath, "utf-8") });
  });

  router.put("/api/schedules/taskfile/:cronId", (req, res) => {
    const { content } = req.body;
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content is required" });
    }
    const dir = path.join(WORKSPACE, "tasks");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${req.params.cronId}.md`);
    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ ok: true });
  });

  // ── Processes ──────────────────────────────────────────────────────────────

  router.get("/api/schedules/processes", (_req, res) => {
    const processes: {
      pid: string;
      user: string;
      cpu: string;
      mem: string;
      vsz: string;
      rss: string;
      stat: string;
      started: string;
      time: string;
      command: string;
    }[] = [];

    try {
      const output = execSync("ps aux", { timeout: 5000, encoding: "utf-8" });
      const lines = output.split("\n").slice(1);
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(/\s+/);
        const command = parts.slice(10).join(" ");
        // Keep claude processes, node/workspace processes, and bun/tsx processes with relevant paths
        const isRelevant =
          /\bclaude\b/i.test(command) ||
          (command.includes("fluxy") && !/ps aux/.test(command)) ||
          command.includes("/workspace/") ||
          command.includes(".claude/");
        if (!isRelevant) continue;
        // Skip the ps aux call itself
        if (command.includes("ps aux")) continue;
        processes.push({
          pid: parts[1],
          user: parts[0],
          cpu: parts[2],
          mem: parts[3],
          vsz: parts[4],
          rss: parts[5],
          stat: parts[7],
          started: parts[8] ?? "",
          time: parts[9] ?? "",
          command: command.length > 300 ? command.slice(0, 300) + "…" : command,
        });
      }
    } catch (e) {
      console.error("[schedules] ps aux failed:", e);
    }

    // Worktrees
    const worktrees: { name: string; fullPath: string; mtime: string; size: number }[] = [];
    const worktreeBase = path.join(WORKSPACE, ".claude", "worktrees");
    try {
      if (fs.existsSync(worktreeBase)) {
        for (const entry of fs.readdirSync(worktreeBase, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const fullPath = path.join(worktreeBase, entry.name);
          const stats = fs.statSync(fullPath);
          worktrees.push({
            name: entry.name,
            fullPath,
            mtime: stats.mtime.toISOString(),
            size: stats.size,
          });
        }
      }
    } catch {}

    res.json({ processes, worktrees });
  });

  // ── Backend Log ────────────────────────────────────────────────────────────

  router.get("/api/schedules/logs/backend", (req, res) => {
    const logPath = path.join(WORKSPACE, ".backend.log");
    const tail = req.query.tail ? Number(req.query.tail) : 0;
    try {
      if (!fs.existsSync(logPath)) return res.json({ content: "", lines: 0 });
      const content = fs.readFileSync(logPath, "utf-8");
      if (tail > 0) {
        const allLines = content.split("\n");
        const slice = allLines.slice(-tail).join("\n");
        return res.json({ content: slice, lines: allLines.length });
      }
      res.json({ content, lines: content.split("\n").length });
    } catch {
      res.json({ content: "", lines: 0 });
    }
  });

  // ── Cron Run History ───────────────────────────────────────────────────────

  router.get("/api/schedules/runs", (req, res) => {
    const { cronId, limit = "100" } = req.query as Record<string, string>;
    if (cronId) {
      res.json(
        db
          .prepare("SELECT * FROM cron_runs WHERE cron_id = ? ORDER BY started_at DESC LIMIT ?")
          .all(cronId, Number(limit)),
      );
    } else {
      res.json(
        db.prepare("SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT ?").all(Number(limit)),
      );
    }
  });

  router.get("/api/schedules/runs/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM cron_runs WHERE id = ?").get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  router.post("/api/schedules/runs", (req, res) => {
    const { cron_id, trigger = "scheduled", stdout = "", stderr = "" } = req.body;
    if (!cron_id) return res.status(400).json({ error: "cron_id is required" });
    const result = db
      .prepare("INSERT INTO cron_runs (cron_id, trigger, stdout, stderr) VALUES (?, ?, ?, ?)")
      .run(cron_id, trigger, stdout, stderr);
    res.json({ id: result.lastInsertRowid });
  });

  router.patch("/api/schedules/runs/:id", (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM cron_runs WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Not found" });

    const { status, finished_at, stdout, stderr, exit_code } = req.body;
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (status !== undefined) {
      sets.push("status = ?");
      vals.push(status);
    }
    if (finished_at !== undefined) {
      sets.push("finished_at = ?");
      vals.push(finished_at);
    }
    // Append mode for stdout/stderr — useful for streaming output
    if (stdout !== undefined) {
      sets.push("stdout = stdout || ?");
      vals.push(stdout);
    }
    if (stderr !== undefined) {
      sets.push("stderr = stderr || ?");
      vals.push(stderr);
    }
    if (exit_code !== undefined) {
      sets.push("exit_code = ?");
      vals.push(exit_code);
    }

    if (sets.length > 0) {
      vals.push(id);
      db.prepare(`UPDATE cron_runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    }
    res.json(db.prepare("SELECT * FROM cron_runs WHERE id = ?").get(id));
  });

  return router;
}
