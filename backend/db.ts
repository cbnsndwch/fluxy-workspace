import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export const WORKSPACE = path.resolve(import.meta.dirname, "..");

// Load workspace/.env
const envPath = path.join(WORKSPACE, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

export const db = Database(path.join(WORKSPACE, "app.db"));
db.pragma("journal_mode = WAL");

// Ensure directories exist
fs.mkdirSync(path.join(WORKSPACE, "docs"), { recursive: true });
fs.mkdirSync(path.join(WORKSPACE, "files", "images"), { recursive: true });
fs.mkdirSync(path.join(WORKSPACE, "files", "issue-attachments"), { recursive: true });

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
try {
  db.exec(`ALTER TABLE workspace_issues ADD COLUMN app TEXT NOT NULL DEFAULT 'all'`);
} catch {}
try {
  db.exec(`ALTER TABLE workspace_issues ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'`);
} catch {}
try {
  db.exec(`ALTER TABLE workspace_issues ADD COLUMN dispatched_at TEXT DEFAULT NULL`);
} catch {}
try {
  db.exec(`ALTER TABLE workspace_issues ADD COLUMN agent_status TEXT DEFAULT NULL`);
} catch {}
try {
  db.exec(`ALTER TABLE workspace_issues ADD COLUMN agent_log TEXT DEFAULT NULL`);
} catch {}
try {
  db.exec(`ALTER TABLE workspace_issues ADD COLUMN agent_branch TEXT DEFAULT NULL`);
} catch {}
try {
  db.exec(`ALTER TABLE workspace_issues ADD COLUMN batch_id INTEGER DEFAULT NULL`);
} catch {}

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
} catch {
  /* column already exists */
}
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_research_reports_share_token
             ON research_reports(share_token) WHERE share_token IS NOT NULL`);
} catch {
  /* index already exists */
}

// Delta / master-synthesis report system (added 2026-04-07)
// session_type: 'full' | 'delta' | 'no_update' | 'master_synthesis'
try {
  db.exec(`ALTER TABLE research_sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'full'`);
} catch {}
// report_type: 'full' | 'delta' | 'master'
try {
  db.exec(`ALTER TABLE research_reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'full'`);
} catch {}
// delta_count: how many delta sessions have been completed since the last master synthesis
try {
  db.exec(`ALTER TABLE research_topics ADD COLUMN delta_count INTEGER NOT NULL DEFAULT 0`);
} catch {}
// master_report_session_id: the session whose report is the current synthesized master
try {
  db.exec(
    `ALTER TABLE research_topics ADD COLUMN master_report_session_id INTEGER REFERENCES research_sessions(id)`,
  );
} catch {}
// prepared_for: client/recipient name for report attribution
try {
  db.exec(`ALTER TABLE research_topics ADD COLUMN prepared_for TEXT`);
} catch {}

// ── Report Settings (global company branding for exports) ────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS report_settings (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    company_name TEXT NOT NULL DEFAULT '',
    tagline      TEXT NOT NULL DEFAULT '',
    copyright_holder TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    website      TEXT NOT NULL DEFAULT '',
    logo_url     TEXT NOT NULL DEFAULT '',
    confidentiality_notice TEXT NOT NULL DEFAULT 'This document is proprietary and confidential. Unauthorized distribution is prohibited.',
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
// Ensure the singleton row exists
db.prepare(`INSERT OR IGNORE INTO report_settings (id) VALUES (1)`).run();

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

// ── Musicologia ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    artist       TEXT NOT NULL,
    artist_slug  TEXT,
    track_slug   TEXT,
    cover_url    TEXT,
    duration_ms  INTEGER,
    source_ids   TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS track_dna (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id          INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    tempo             REAL,
    key               INTEGER,
    mode              INTEGER,
    energy            REAL,
    valence           REAL,
    danceability      REAL,
    loudness          REAL,
    acousticness      REAL,
    instrumentalness  REAL,
    liveness          REAL,
    speechiness       REAL,
    time_signature    INTEGER,
    palette           TEXT,
    motion_profile    TEXT,
    lyric_settings    TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS track_sections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id   INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
    sections   TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS track_lyrics (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    start_ms   INTEGER NOT NULL,
    end_ms     INTEGER NOT NULL,
    text       TEXT NOT NULL,
    emphasis   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS track_lore (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id   INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
    tagline    TEXT,
    story      TEXT,
    trivia     TEXT NOT NULL DEFAULT '[]',
    themes     TEXT NOT NULL DEFAULT '[]',
    credits    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS music_interactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    cover_url   TEXT,
    owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    added_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(playlist_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS music_suggestions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    track_id    INTEGER REFERENCES tracks(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS music_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_key    TEXT NOT NULL UNIQUE,
    variants   TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS music_follows (
    follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id)
  );

  CREATE TABLE IF NOT EXISTS music_comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name   TEXT,
    user_avatar TEXT,
    target_type TEXT NOT NULL,
    target_id   INTEGER NOT NULL,
    body        TEXT NOT NULL,
    parent_id   INTEGER REFERENCES music_comments(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS music_activity_feed (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name   TEXT,
    actor_avatar TEXT,
    verb         TEXT NOT NULL,
    object_type  TEXT NOT NULL,
    object_id    INTEGER NOT NULL,
    object_title TEXT,
    meta         TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS music_reactions (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS musicologia_spotify_tokens (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    INTEGER NOT NULL,
    scope         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Ontologica ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS onto_projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    domain_hint TEXT,
    base_uri    TEXT NOT NULL DEFAULT 'http://ontologica.local/',
    status      TEXT NOT NULL DEFAULT 'active',
    node_count  INTEGER NOT NULL DEFAULT 0,
    edge_count  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onto_documents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    content_text TEXT,
    mime_type    TEXT NOT NULL DEFAULT 'text/plain',
    status       TEXT NOT NULL DEFAULT 'uploaded',
    chunk_count  INTEGER NOT NULL DEFAULT 0,
    word_count   INTEGER NOT NULL DEFAULT 0,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onto_nodes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id          INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
    node_type           TEXT NOT NULL DEFAULT 'class',
    name                TEXT NOT NULL,
    description         TEXT,
    uri                 TEXT,
    parent_id           INTEGER REFERENCES onto_nodes(id) ON DELETE SET NULL,
    confidence          REAL NOT NULL DEFAULT 0.0,
    status              TEXT NOT NULL DEFAULT 'suggested',
    source_document_id  INTEGER REFERENCES onto_documents(id) ON DELETE SET NULL,
    extraction_job_id   INTEGER,
    pos_x               REAL NOT NULL DEFAULT 0,
    pos_y               REAL NOT NULL DEFAULT 0,
    metadata            TEXT NOT NULL DEFAULT '{}',
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onto_edges (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id          INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
    edge_type           TEXT NOT NULL DEFAULT 'is_a',
    name                TEXT,
    source_node_id      INTEGER NOT NULL REFERENCES onto_nodes(id) ON DELETE CASCADE,
    target_node_id      INTEGER REFERENCES onto_nodes(id) ON DELETE SET NULL,
    target_value        TEXT,
    description         TEXT,
    confidence          REAL NOT NULL DEFAULT 0.0,
    status              TEXT NOT NULL DEFAULT 'suggested',
    source_document_id  INTEGER REFERENCES onto_documents(id) ON DELETE SET NULL,
    extraction_job_id   INTEGER,
    metadata            TEXT NOT NULL DEFAULT '{}',
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onto_extraction_jobs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id       INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
    document_id      INTEGER REFERENCES onto_documents(id) ON DELETE SET NULL,
    status           TEXT NOT NULL DEFAULT 'queued',
    pipeline_stage   TEXT NOT NULL DEFAULT 'pending',
    progress_pct     INTEGER NOT NULL DEFAULT 0,
    current_step     TEXT,
    stages_complete  TEXT NOT NULL DEFAULT '[]',
    nodes_created    INTEGER NOT NULL DEFAULT 0,
    edges_created    INTEGER NOT NULL DEFAULT 0,
    config           TEXT NOT NULL DEFAULT '{}',
    error            TEXT,
    started_at       TEXT,
    completed_at     TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onto_conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'user',
    content    TEXT NOT NULL,
    actions    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onto_pipeline_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES onto_extraction_jobs(id) ON DELETE CASCADE,
    stage      TEXT NOT NULL,
    level      TEXT NOT NULL DEFAULT 'info',
    title      TEXT NOT NULL,
    detail     TEXT,
    meta       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onto_base_layers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    description  TEXT,
    namespace    TEXT,
    version      TEXT,
    category     TEXT NOT NULL DEFAULT 'community' CHECK(category IN ('w3c','community','domain','commons')),
    is_always_on INTEGER NOT NULL DEFAULT 0,
    item_count   INTEGER NOT NULL DEFAULT 0,
    metadata     TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onto_base_layer_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    layer_id    INTEGER NOT NULL REFERENCES onto_base_layers(id) ON DELETE CASCADE,
    item_type   TEXT NOT NULL DEFAULT 'class' CHECK(item_type IN ('class','property','datatype','individual')),
    uri         TEXT NOT NULL,
    local_name  TEXT,
    label       TEXT,
    description TEXT,
    parent_uri  TEXT,
    domain_uri  TEXT,
    range_uri   TEXT,
    metadata    TEXT NOT NULL DEFAULT '{}',
    UNIQUE(layer_id, uri)
  );

  CREATE TABLE IF NOT EXISTS onto_project_layers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
    layer_id       INTEGER NOT NULL REFERENCES onto_base_layers(id) ON DELETE CASCADE,
    activated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    auto_activated INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id, layer_id)
  );

  CREATE TABLE IF NOT EXISTS onto_dedup_dismissals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
    node_a_id  INTEGER NOT NULL,
    node_b_id  INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, node_a_id, node_b_id)
  );

  CREATE TABLE IF NOT EXISTS onto_commons_candidates (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type         TEXT NOT NULL CHECK(pattern_type IN ('class','property','relationship')),
    name                 TEXT NOT NULL,
    description          TEXT,
    uri_suggestion       TEXT,
    source_projects      TEXT NOT NULL DEFAULT '[]',
    occurrence_count     INTEGER NOT NULL DEFAULT 1,
    first_seen           TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen            TEXT NOT NULL DEFAULT (datetime('now')),
    status               TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','promoted','rejected')),
    promoted_to_layer_id INTEGER REFERENCES onto_base_layers(id),
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Migrations (idempotent ALTER TABLE) ────────────────────────────────────────
const tryExec = (sql: string) => {
  try {
    db.exec(sql);
  } catch {
    /* column already exists */
  }
};
tryExec(`ALTER TABLE music_comments ADD COLUMN user_name TEXT`);
tryExec(`ALTER TABLE music_comments ADD COLUMN user_avatar TEXT`);
// music_activity_feed extra columns — tables created before this migration had fewer columns
tryExec(`ALTER TABLE music_activity_feed ADD COLUMN object_title TEXT`);
tryExec(`ALTER TABLE music_activity_feed ADD COLUMN meta TEXT`);
// Ontologica: provenance columns for base layer tracking
tryExec(`ALTER TABLE onto_nodes ADD COLUMN layer_id INTEGER REFERENCES onto_base_layers(id) ON DELETE SET NULL`);
tryExec(`ALTER TABLE onto_nodes ADD COLUMN base_item_uri TEXT`);
tryExec(`ALTER TABLE onto_edges ADD COLUMN layer_id INTEGER REFERENCES onto_base_layers(id) ON DELETE SET NULL`);
tryExec(`ALTER TABLE onto_edges ADD COLUMN base_item_uri TEXT`);

// Seed system roles (idempotent)
/* const adminRole = */ db.prepare(
  `INSERT OR IGNORE INTO roles (name, description, is_system) VALUES ('admin', 'Full access to everything', 1)`,
).run();
/* const operatorRole = */ db.prepare(
  `INSERT OR IGNORE INTO roles (name, description, is_system) VALUES ('operator', 'Access to Fluxy chat and basic workspace features', 1)`,
).run();

// Give operator role chat access
const opRow = db.prepare(`SELECT id FROM roles WHERE name = 'operator'`).get() as
  | { id: number }
  | undefined;
if (opRow) {
  db.prepare(
    `INSERT OR IGNORE INTO role_permissions (role_id, app, action) VALUES (?, 'chat', 'access')`,
  ).run(opRow.id);
}
