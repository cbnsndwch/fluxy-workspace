import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export const WORKSPACE = path.resolve(import.meta.dirname, '..');

// Load workspace/.env
const envPath = path.join(WORKSPACE, '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
    }
}

export const db = Database(path.join(WORKSPACE, 'app.db'));
db.pragma('journal_mode = WAL');

// Ensure directories exist
fs.mkdirSync(path.join(WORKSPACE, 'docs'), { recursive: true });
fs.mkdirSync(path.join(WORKSPACE, 'files', 'images'), { recursive: true });
fs.mkdirSync(path.join(WORKSPACE, 'files', 'issue-attachments'), { recursive: true });

// ── Schemas ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    github_id  INTEGER UNIQUE NOT NULL,
    login      TEXT NOT NULL,
    name       TEXT,
    avatar_url TEXT,
    email      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_ideas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    stage       TEXT NOT NULL DEFAULT 'idea',
    tags        TEXT NOT NULL DEFAULT '[]',
    group_name  TEXT,
    color       TEXT,
    pos_x       REAL NOT NULL DEFAULT 0,
    pos_y       REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_idea_connections (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES app_ideas(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES app_ideas(id) ON DELETE CASCADE,
    label     TEXT,
    strength  INTEGER NOT NULL DEFAULT 1
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workspace_issues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'open',
    priority    TEXT NOT NULL DEFAULT 'medium',
    category    TEXT NOT NULL DEFAULT 'improvement',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
try { db.exec(`ALTER TABLE workspace_issues ADD COLUMN app TEXT NOT NULL DEFAULT 'all'`); } catch {}
try { db.exec(`ALTER TABLE workspace_issues ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'`); } catch {}
try { db.exec(`ALTER TABLE workspace_issues ADD COLUMN dispatched_at TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE workspace_issues ADD COLUMN agent_status TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE workspace_issues ADD COLUMN agent_log TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE workspace_issues ADD COLUMN agent_branch TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE workspace_issues ADD COLUMN batch_id INTEGER DEFAULT NULL`); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS dispatch_batches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_ids   TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'working',
    sync_report TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS image_generations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt     TEXT NOT NULL,
    model      TEXT NOT NULL,
    size       TEXT NOT NULL DEFAULT '1024x1024',
    quality    TEXT,
    style      TEXT,
    filename   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workflows (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT 'Untitled Workflow',
    description TEXT,
    nodes       TEXT NOT NULL DEFAULT '[]',
    edges       TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'running',
    started_at   TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at  TEXT,
    trigger_data TEXT,
    error        TEXT
  );

  CREATE TABLE IF NOT EXISTS workflow_run_nodes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      INTEGER NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    node_id     TEXT NOT NULL,
    node_type   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    input       TEXT,
    output      TEXT,
    error       TEXT,
    duration_ms INTEGER,
    executed_at TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    is_system   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    app     TEXT NOT NULL,
    action  TEXT NOT NULL,
    UNIQUE(role_id, app, action)
  );

  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS research_topics (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    title             TEXT NOT NULL,
    description       TEXT,
    detail_level      TEXT NOT NULL DEFAULT 'standard',
    status            TEXT NOT NULL DEFAULT 'idle',
    ongoing           INTEGER NOT NULL DEFAULT 0,
    revisit_interval  TEXT,
    last_researched_at TEXT,
    next_revisit_at   TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS research_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id     INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'queued',
    current_step TEXT,
    error        TEXT,
    started_at   TEXT,
    completed_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS research_findings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
    type         TEXT NOT NULL DEFAULT 'fact',
    content      TEXT NOT NULL,
    source_url   TEXT,
    source_title TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS research_reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL UNIQUE REFERENCES research_sessions(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add share_token column to research_reports if it doesn't exist
// NOTE: SQLite cannot ADD COLUMN with UNIQUE on a non-empty table,
// so we add the column plain and enforce uniqueness via a partial index.
try {
    db.exec(`ALTER TABLE research_reports ADD COLUMN share_token TEXT`);
} catch (_) { /* column already exists */ }
try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_research_reports_share_token
             ON research_reports(share_token) WHERE share_token IS NOT NULL`);
} catch (_) { /* index already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS marble_worlds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    prompt       TEXT NOT NULL,
    prompt_type  TEXT NOT NULL DEFAULT 'text',
    model        TEXT NOT NULL DEFAULT 'Marble 0.1-mini',
    world_id     TEXT,
    operation_id TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    error_msg    TEXT,
    assets_json  TEXT,
    thumbnail_url TEXT,
    caption      TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed system roles (idempotent)
const adminRole = db.prepare(`INSERT OR IGNORE INTO roles (name, description, is_system) VALUES ('admin', 'Full access to everything', 1)`).run();
const operatorRole = db.prepare(`INSERT OR IGNORE INTO roles (name, description, is_system) VALUES ('operator', 'Access to Fluxy chat and basic workspace features', 1)`).run();

// Give operator role chat access
const opRow = db.prepare(`SELECT id FROM roles WHERE name = 'operator'`).get() as { id: number } | undefined;
if (opRow) {
    db.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, app, action) VALUES (?, 'chat', 'access')`).run(opRow.id);
}
