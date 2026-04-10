// oxlint-disable no-console
import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import crypto from "crypto";

/* ─── Catalog ────────────────────────────────────────────────────────────────
   Single source of truth for distributable apps.
   Each entry maps to a real workspace app that can be packaged + sold.
──────────────────────────────────────────────────────────────────────────── */
export interface CatalogApp {
  id: string;
  name: string;
  tagline: string;
  description: string;
  version: string;
  icon: string; // lucide icon name
  color: string; // tailwind classes
  highlight?: string;
  tags: string[];
  minFluxyVersion: string;
}

export const APP_CATALOG: CatalogApp[] = [
  {
    id: "crm",
    name: "CRM",
    tagline: "Contacts, companies & pipeline",
    description:
      "Full contact & company management with a Kanban deals pipeline. Never lose track of a lead.",
    version: "1.0.0",
    icon: "Users",
    color: "bg-blue-500/10 text-blue-500",
    highlight: "Most popular",
    tags: ["crm", "contacts", "sales", "productivity"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "app-ideas",
    name: "App Ideas Canvas",
    tagline: "Visual idea planning",
    description:
      "Infinite React Flow canvas to brainstorm, group and track product ideas from spark to spec.",
    version: "1.0.0",
    icon: "Lightbulb",
    color: "bg-violet-500/10 text-violet-500",
    tags: ["ideas", "planning", "canvas"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "image-studio",
    name: "Image Studio",
    tagline: "AI image generation",
    description:
      "Generate images with DALL-E 3 & Imagen 4. Gallery, history, and prompt library built-in.",
    version: "1.0.0",
    icon: "ImageIcon",
    color: "bg-pink-500/10 text-pink-500",
    highlight: "AI-powered",
    tags: ["ai", "images", "generation", "creativity"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "workflows",
    name: "Workflows",
    tagline: "Visual automation builder",
    description:
      "n8n-style drag-and-drop workflow editor. HTTP requests, code runners, DB queries & cron triggers.",
    version: "1.0.0",
    icon: "Workflow",
    color: "bg-orange-500/10 text-orange-500",
    highlight: "Automate anything",
    tags: ["automation", "workflows", "no-code"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "deep-research",
    name: "Deep Research",
    tagline: "Automated web research",
    description:
      "Set topics and let your Fluxy research them on a schedule. Reports, findings & ongoing tracking.",
    version: "1.0.0",
    icon: "FlaskConical",
    color: "bg-cyan-500/10 text-cyan-500",
    highlight: "AI-powered",
    tags: ["research", "ai", "web", "automation"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "users",
    name: "User Management",
    tagline: "Access control & permissions",
    description:
      "Role-based access with app-level permission gates. Invite teammates and control what they see.",
    version: "1.0.0",
    icon: "ShieldCheck",
    color: "bg-teal-500/10 text-teal-500",
    tags: ["auth", "users", "permissions", "teams"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "db-viewer",
    name: "DB Viewer",
    tagline: "Browse your SQLite database",
    description:
      "Visual table browser, row editor and live SQL query runner against your workspace database.",
    version: "1.0.0",
    icon: "Database",
    color: "bg-emerald-500/10 text-emerald-500",
    tags: ["database", "sql", "developer"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "docs",
    name: "Docs",
    tagline: "Workspace documentation",
    description:
      "Markdown-first docs with a tree-based file structure. Write guides, specs and runbooks.",
    version: "1.0.0",
    icon: "BookOpen",
    color: "bg-sky-500/10 text-sky-500",
    tags: ["docs", "markdown", "knowledge-base"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "issues",
    name: "Workspace Issues",
    tagline: "Issue tracker & workflow editor",
    description:
      "Collect issues, track fixes and visualize your workflow with a built-in node editor.",
    version: "1.0.0",
    icon: "TriangleAlert",
    color: "bg-amber-500/10 text-amber-500",
    tags: ["issues", "tracker", "workflow"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "flow-capture",
    name: "Flow Capture",
    tagline: "Speech-to-diagram in real time",
    description:
      "Speak your user flow and watch AI render it as a live Mermaid diagram. Persistent sessions, voice + text input.",
    version: "1.0.0",
    icon: "GitBranch",
    color: "bg-purple-500/10 text-purple-500",
    highlight: "AI-powered",
    tags: ["ai", "diagrams", "voice", "mermaid"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "icebreaker",
    name: "Icebreaker",
    tagline: "AI conversation starters",
    description:
      "Generate fascinating conversation starters from live tech headlines. Features Steven Mode for maximum chaos.",
    version: "1.0.0",
    icon: "MessageSquarePlus",
    color: "bg-red-500/10 text-red-500",
    highlight: "AI-powered",
    tags: ["ai", "conversation", "social", "fun"],
    minFluxyVersion: "1.0.0",
  },
  {
    id: "analytics",
    name: "Analytics",
    tagline: "Self-hosted event tracking",
    description:
      "Track app usage, visualize events, and understand how your workspace is used — all on your hardware.",
    version: "1.0.0",
    icon: "BarChart2",
    color: "bg-indigo-500/10 text-indigo-500",
    tags: ["analytics", "events", "metrics", "privacy"],
    minFluxyVersion: "1.0.0",
  },
];

/* ─── DB Init ────────────────────────────────────────────────────────────────*/
function initDB(db: Database.Database) {
  db.exec(`
        CREATE TABLE IF NOT EXISTS marketplace_tokens (
            id          TEXT PRIMARY KEY,
            tier        TEXT NOT NULL,
            apps        TEXT NOT NULL,          -- JSON array of app IDs
            price       INTEGER NOT NULL,
            label       TEXT,                   -- optional buyer label/note
            expires_at  TEXT NOT NULL,
            redeemed_at TEXT,
            redeemed_by TEXT,                   -- IP of redeemer
            revoked     INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS marketplace_orders (
            id          TEXT PRIMARY KEY,
            tier        TEXT NOT NULL,
            apps        TEXT NOT NULL,
            price       INTEGER NOT NULL,
            status      TEXT NOT NULL DEFAULT 'active',  -- active | expired | redeemed | revoked
            token_id    TEXT,
            buyer_email TEXT,
            notes       TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (token_id) REFERENCES marketplace_tokens(id)
        );

        CREATE TABLE IF NOT EXISTS marketplace_settings (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS marketplace_error_reports (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id          TEXT NOT NULL,
            workspace_id    TEXT,
            error_message   TEXT NOT NULL,
            error_stack     TEXT,
            context         TEXT,               -- JSON
            url             TEXT,
            user_agent      TEXT,
            reported_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS marketplace_telemetry (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id          TEXT NOT NULL,
            workspace_id    TEXT,
            event_type      TEXT NOT NULL,
            payload         TEXT,               -- JSON
            recorded_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);

  // Ensure workspace_id exists in settings (auto-generated, stable)
  const existing = db
    .prepare("SELECT value FROM marketplace_settings WHERE key = 'workspace_id'")
    .get() as { value: string } | undefined;
  if (!existing) {
    db.prepare("INSERT INTO marketplace_settings (key, value) VALUES ('workspace_id', ?)").run(
      JSON.stringify(crypto.randomUUID().slice(0, 12)),
    );
  }
}

/* ─── Helpers ────────────────────────────────────────────────────────────────*/
function getSetting(db: Database.Database, key: string): unknown {
  const row = db.prepare("SELECT value FROM marketplace_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? JSON.parse(row.value) : undefined;
}

function computeTokenStatus(token: {
  expires_at: string;
  redeemed_at: string | null;
  revoked: number;
}): "active" | "expired" | "redeemed" | "revoked" {
  if (token.revoked) return "revoked";
  if (token.redeemed_at) return "redeemed";
  if (new Date(token.expires_at) < new Date()) return "expired";
  return "active";
}

/* ─── Router ─────────────────────────────────────────────────────────────────*/
export function createRouter(db: Database.Database) {
  initDB(db);
  const router = Router();

  /* ── Catalog ──────────────────────────────────────────────────────────── */
  router.get("/api/marketplace/apps", (_req: Request, res: Response) => {
    res.json(APP_CATALOG);
  });

  /* ── Checkout → generate token ────────────────────────────────────────── */
  router.post("/api/marketplace/checkout", (req: Request, res: Response) => {
    const {
      tier,
      apps,
      price,
      buyerEmail,
      notes,
      expiryHours = 48,
    } = req.body as {
      tier: string;
      apps: string[];
      price: number;
      buyerEmail?: string;
      notes?: string;
      expiryHours?: number;
    };

    if (!tier || !Array.isArray(apps) || apps.length === 0) {
      return res.status(400).json({ error: "tier and apps[] are required" });
    }

    const tokenId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + expiryHours * 3_600_000).toISOString();

    db.prepare(`
            INSERT INTO marketplace_tokens (id, tier, apps, price, label, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(tokenId, tier, JSON.stringify(apps), price ?? 0, buyerEmail ?? null, expiresAt);

    db.prepare(`
            INSERT INTO marketplace_orders (id, tier, apps, price, token_id, buyer_email, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
      orderId,
      tier,
      JSON.stringify(apps),
      price ?? 0,
      tokenId,
      buyerEmail ?? null,
      notes ?? null,
    );

    res.json({ orderId, tokenId, expiresAt, apps });
  });

  /* ── List tokens ─────────────────────────────────────────────────────── */
  router.get("/api/marketplace/tokens", (_req: Request, res: Response) => {
    const tokens = db
      .prepare("SELECT * FROM marketplace_tokens ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    res.json(
      tokens.map((t) => ({
        ...t,
        apps: JSON.parse(t.apps as string),
        status: computeTokenStatus(
          t as { expires_at: string; redeemed_at: string | null; revoked: number },
        ),
      })),
    );
  });

  /* ── Revoke token ────────────────────────────────────────────────────── */
  router.delete("/api/marketplace/tokens/:id", (req: Request, res: Response) => {
    const result = db
      .prepare("UPDATE marketplace_tokens SET revoked = 1 WHERE id = ?")
      .run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Token not found" });
    // Update order status too
    db.prepare("UPDATE marketplace_orders SET status = 'revoked' WHERE token_id = ?").run(
      req.params.id,
    );
    res.json({ ok: true });
  });

  /* ── List orders ─────────────────────────────────────────────────────── */
  router.get("/api/marketplace/orders", (_req: Request, res: Response) => {
    const orders = db
      .prepare("SELECT * FROM marketplace_orders ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    res.json(orders.map((o) => ({ ...o, apps: JSON.parse(o.apps as string) })));
  });

  /* ── Redeem token (buyer's Fluxy calls this) ──────────────────────────── */
  router.post("/api/marketplace/redeem", (req: Request, res: Response) => {
    const { token } = req.body as { token: string };

    if (!token) return res.status(400).json({ error: "token is required" });

    const record = db.prepare("SELECT * FROM marketplace_tokens WHERE id = ?").get(token) as
      | Record<string, unknown>
      | undefined;

    if (!record) return res.status(404).json({ error: "Token not found" });

    const status = computeTokenStatus(
      record as { expires_at: string; redeemed_at: string | null; revoked: number },
    );

    if (status === "expired") return res.status(410).json({ error: "Token has expired" });
    if (status === "revoked") return res.status(410).json({ error: "Token has been revoked" });
    if (status === "redeemed")
      return res.status(409).json({ error: "Token has already been redeemed" });

    // Mark redeemed
    db.prepare(
      "UPDATE marketplace_tokens SET redeemed_at = datetime('now'), redeemed_by = ? WHERE id = ?",
    ).run(req.ip, token);
    db.prepare("UPDATE marketplace_orders SET status = 'redeemed' WHERE token_id = ?").run(token);

    const apps = JSON.parse(record.apps as string) as string[];
    const appDetails = apps.map((id) => APP_CATALOG.find((a) => a.id === id)).filter(Boolean);

    res.json({
      tier: record.tier,
      apps: appDetails,
      installInstructions: apps.map((id) => ({
        appId: id,
        command: `install bundle ${token} app ${id}`,
        downloadHint: `/api/marketplace/bundle/${id}?token=${token}`,
      })),
    });
  });

  /* ── Bundle download stub (buyer fetches this) ───────────────────────── */
  router.get("/api/marketplace/bundle/:appId", (req: Request, res: Response) => {
    const token = req.query.token as string | undefined;
    const appId = req.params.appId as string;

    if (token) {
      const record = db.prepare("SELECT * FROM marketplace_tokens WHERE id = ?").get(token) as
        | Record<string, unknown>
        | undefined;
      if (!record) return res.status(404).json({ error: "Invalid token" });
      const status = computeTokenStatus(
        record as { expires_at: string; redeemed_at: string | null; revoked: number },
      );
      if (status !== "redeemed" && status !== "active") {
        return res.status(410).json({ error: `Token is ${status}` });
      }
      const apps = JSON.parse(record.apps as string) as string[];
      if (!apps.includes(appId)) {
        return res.status(403).json({ error: "App not included in this token" });
      }
    }

    const app = APP_CATALOG.find((a) => a.id === appId);
    if (!app) return res.status(404).json({ error: "App not found in catalog" });

    // TODO: serve actual .fluxy-app bundle file when bundles are packaged
    res.json({
      app,
      manifest: {
        $schema: "https://fluxy.bot/schemas/fluxy-app/v1.json",
        id: app.id,
        name: app.name,
        version: app.version,
        description: app.description,
        minFluxyVersion: app.minFluxyVersion,
        frontendFramework: { required: "react", minVersion: "18.0.0", router: "react-router-v6" },
        tags: app.tags,
      },
      bundleStatus: "pending_packaging",
      message: "App bundles are being prepared. Check back soon.",
    });
  });

  /* ── Settings ─────────────────────────────────────────────────────────── */
  router.get("/api/marketplace/settings", (_req: Request, res: Response) => {
    const rows = db.prepare("SELECT * FROM marketplace_settings").all() as Array<{
      key: string;
      value: string;
    }>;
    const settings = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    res.json({
      error_tracking_enabled: false,
      telemetry_enabled: false,
      api_reporting_enabled: false,
      api_reporting_url: "",
      workspace_id: "unset",
      ...settings,
    });
  });

  router.put("/api/marketplace/settings", (req: Request, res: Response) => {
    const updates = req.body as Record<string, unknown>;
    const stmt = db.prepare(`
            INSERT INTO marketplace_settings (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `);
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, JSON.stringify(value));
    }
    res.json({ ok: true });
  });

  /* ── Error reporting (from buyer's installed apps) ────────────────────── */
  router.post("/api/marketplace/report-error", (req: Request, res: Response) => {
    const enabled = getSetting(db, "error_tracking_enabled");
    if (!enabled) return res.status(403).json({ error: "Error tracking is not enabled" });

    const { appId, workspaceId, errorMessage, errorStack, context } = req.body as Record<
      string,
      unknown
    >;

    if (!appId || !errorMessage) {
      return res.status(400).json({ error: "appId and errorMessage are required" });
    }

    db.prepare(`
            INSERT INTO marketplace_error_reports (app_id, workspace_id, error_message, error_stack, context, url, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
      appId,
      workspaceId ?? null,
      errorMessage,
      errorStack ?? null,
      context ? JSON.stringify(context) : null,
      (req.headers["x-origin-url"] as string) ?? null,
      req.headers["user-agent"] ?? null,
    );

    // Forward to external API if configured
    const apiUrl = getSetting(db, "api_reporting_url") as string | undefined;
    const apiEnabled = getSetting(db, "api_reporting_enabled") as boolean | undefined;
    if (apiEnabled && apiUrl) {
      fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      }).catch((err) => console.error("[marketplace] Error forwarding report:", err));
    }

    res.json({ ok: true });
  });

  /* ── Telemetry (from buyer's installed apps) ──────────────────────────── */
  router.post("/api/marketplace/telemetry", (req: Request, res: Response) => {
    const enabled = getSetting(db, "telemetry_enabled");
    if (!enabled) return res.status(403).json({ error: "Telemetry is not enabled" });

    const { appId, workspaceId, eventType, payload } = req.body as Record<string, unknown>;

    if (!appId || !eventType) {
      return res.status(400).json({ error: "appId and eventType are required" });
    }

    db.prepare(`
            INSERT INTO marketplace_telemetry (app_id, workspace_id, event_type, payload)
            VALUES (?, ?, ?, ?)
        `).run(appId, workspaceId ?? null, eventType, payload ? JSON.stringify(payload) : null);

    res.json({ ok: true });
  });

  /* ── Reports viewer ───────────────────────────────────────────────────── */
  router.get("/api/marketplace/error-reports", (_req: Request, res: Response) => {
    const rows = db
      .prepare("SELECT * FROM marketplace_error_reports ORDER BY reported_at DESC LIMIT 200")
      .all() as Array<Record<string, unknown>>;
    res.json(
      rows.map((r) => ({ ...r, context: r.context ? JSON.parse(r.context as string) : null })),
    );
  });

  router.get("/api/marketplace/telemetry-events", (_req: Request, res: Response) => {
    const rows = db
      .prepare("SELECT * FROM marketplace_telemetry ORDER BY recorded_at DESC LIMIT 500")
      .all() as Array<Record<string, unknown>>;
    res.json(
      rows.map((r) => ({ ...r, payload: r.payload ? JSON.parse(r.payload as string) : null })),
    );
  });

  /* ── Stats ────────────────────────────────────────────────────────────── */
  router.get("/api/marketplace/stats", (_req: Request, res: Response) => {
    const totalTokens = (
      db.prepare("SELECT COUNT(*) as n FROM marketplace_tokens").get() as { n: number }
    ).n;
    const activeTokens = (
      db
        .prepare(
          "SELECT COUNT(*) as n FROM marketplace_tokens WHERE revoked = 0 AND redeemed_at IS NULL AND expires_at > datetime('now')",
        )
        .get() as { n: number }
    ).n;
    const redeemedTokens = (
      db
        .prepare("SELECT COUNT(*) as n FROM marketplace_tokens WHERE redeemed_at IS NOT NULL")
        .get() as { n: number }
    ).n;
    const errorReports = (
      db.prepare("SELECT COUNT(*) as n FROM marketplace_error_reports").get() as { n: number }
    ).n;
    const telemetryEvents = (
      db.prepare("SELECT COUNT(*) as n FROM marketplace_telemetry").get() as { n: number }
    ).n;

    res.json({ totalTokens, activeTokens, redeemedTokens, errorReports, telemetryEvents });
  });

  return router;
}
