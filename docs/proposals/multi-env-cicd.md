# Multi-Environment Support: Dev / Prod with CI/CD & DB Migrations

**Status:** Proposal — Pending Diego's input
**Issue:** #45
**Date:** 2026-04-06
**Author:** Sebastian (Fluxy Agent)

---

## Executive Summary

This document proposes a dev/prod environment split for the Fluxy workspace, including hosting model, environment config, CI/CD pipeline via GitHub Actions, and a lightweight DB migration system. The design is tailored for a **personal workspace** — not a SaaS — so simplicity and low maintenance overhead are the priority.

---

## 1. Hosting Model for Prod

### Evaluated Options

| Option | Pros | Cons | Fit for Diego |
|---|---|---|---|
| **Same machine, different dir/port** | Zero extra cost, no networking, fast deploy | One machine = single point of failure | ✅ Best for personal use |
| **Separate VPS (Hetzner/DO)** | Real isolation, independent failures | ~$5–10/mo, SSH setup, latency | ✅ Good if uptime matters |
| **Fly.io / Railway / Render** | Zero-ops, easy deploy | SQLite incompatible (ephemeral FS), requires PG migration | ❌ Requires DB change |
| **Docker (same machine)** | Clean isolation, reproducible | Extra complexity for personal use | ⚠️ Overkill unless already using Docker |

### Recommendation: Same Machine, Separate Instances

For a personal workspace, the simplest prod setup is a second Fluxy instance on the same machine:

```
/home/serge/workspace-dev/   ← current dev instance (port 3000)
/home/serge/workspace-prod/  ← new prod instance (port 3001 or behind nginx on :443)
```

Each instance has:
- Its own `app.db`
- Its own `.env` (different GitHub OAuth app, different API keys for prod)
- Its own systemd service (`fluxy-dev.service`, `fluxy-prod.service`)

**Alternative**: If Diego has a cheap VPS or a spare machine, prod goes there. The CI/CD workflow below supports both — SSH deploy works for same-machine and remote.

### Reverse Proxy (Optional but Recommended)

Put Caddy or nginx in front to handle HTTPS and route traffic:

```
workspace.diego.dev → prod instance (port 3001)
workspace-dev.diego.dev → dev instance (port 3000)  [optional, private]
```

---

## 2. Environment Config

### Current State
Single `.env` file, manually maintained. Backend reads it with custom dotenv parser in `db.ts`.

### Proposed: Environment-Aware Config

**File structure:**
```
.env                    ← shared defaults (non-secret, safe to commit)
.env.development        ← dev overrides + dev secrets (gitignored)
.env.production         ← prod overrides + prod secrets (gitignored)
.env.example            ← template for both envs (committed)
```

**How the backend discovers its environment:**
```typescript
// db.ts — replace current .env loader
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFiles = [
  `.env.${NODE_ENV}`,   // env-specific first (highest priority)
  '.env',               // shared defaults fallback
];
```

**What differs between envs:**

| Variable | Dev | Prod |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `DB_PATH` | `./app.db` | `/data/workspace/app.db` (or `./app.db`) |
| `GITHUB_CLIENT_ID` | dev OAuth app ID | prod OAuth app ID |
| `GITHUB_CLIENT_SECRET` | dev OAuth secret | prod OAuth secret |
| `SESSION_SECRET` | any string | long random string, rotated |
| `OPENAI_API_KEY` | same or separate | same or separate |
| `BACKEND_PORT` | `3004` | `3005` (or 3004 if isolated) |

**GitHub OAuth note**: GitHub requires separate OAuth apps for dev and prod because callback URLs differ. Register `workspace.diego.dev/auth/github/callback` as the prod app.

### Prod Secrets in CI/CD
Prod secrets are stored as **GitHub Actions repository secrets** and injected into the prod server's `.env.production` during deploy (or managed directly on the server — never committed).

---

## 3. CI/CD Pipeline

### Trigger Strategy

| Branch | Purpose | Pipeline |
|---|---|---|
| Any branch | Dev work | No pipeline (HMR handles it) |
| `main` | Always-deployable | Full deploy to prod on push |

> **Alternative**: Use a `release` branch if Diego wants an extra gate before prod. Push to `release` triggers deploy; `main` stays "last deployed state." Adds friction, good if there's a staging step.

### Draft GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

env:
  NODE_VERSION: '22'
  PNPM_VERSION: '10'

jobs:
  deploy:
    name: Build & Deploy
    runs-on: ubuntu-latest

    steps:
      # ── Checkout ──────────────────────────────────────────────────────────
      - name: Checkout
        uses: actions/checkout@v4

      # ── Setup ─────────────────────────────────────────────────────────────
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      # ── Install & Build ────────────────────────────────────────────────────
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build frontend
        run: pnpm run build
        env:
          NODE_ENV: production
          # Inject any VITE_* vars needed at build time
          VITE_APP_ENV: production

      # ── Deploy via SSH ─────────────────────────────────────────────────────
      - name: Deploy to prod server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.PROD_HOST }}
          username: ${{ secrets.PROD_USER }}
          key: ${{ secrets.PROD_SSH_KEY }}
          script: |
            set -e
            cd /home/serge/workspace-prod

            # Pull latest code
            git fetch origin main
            git reset --hard origin/main

            # Install backend deps (no build step needed for tsx)
            pnpm install --frozen-lockfile --prod

            # Copy the built frontend from CI artifact
            # (See note below about build artifact transfer)

            # Run DB migrations
            node --import tsx/esm scripts/migrate.ts

            # Restart prod Fluxy instance
            systemctl restart fluxy-prod

      # ── Verify ────────────────────────────────────────────────────────────
      - name: Health check
        run: |
          sleep 5
          curl -f https://workspace.diego.dev/app/api/health || exit 1
```

### Transferring the Frontend Build

The build output (`dist/`) is never committed to git. Two options for getting it to prod:

**Option A — Build on the prod server (simpler, heavier server)**
Remove the local build step; add `pnpm run build` to the SSH deploy script after `git reset`. Requires the full Node.js toolchain on the prod server.

**Option B — Build in CI, upload artifact (recommended)**
Add a step to upload `dist/` as a GitHub Actions artifact, then download it on the prod server via the SSH step. Keeps prod server lean.

```yaml
      # After "Build frontend" step:
      - name: Upload dist artifact
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
          retention-days: 7

      # In SSH script, before migration:
      # (use scp or gh CLI to download and unpack the artifact)
```

> **For same-machine deploy**: If dev and prod are on the same machine, simplest is to build in the prod workspace dir directly — no artifact transfer needed.

### Serving the Built Frontend

In prod (`NODE_ENV=production`), the Express backend should serve the Vite output:

```typescript
// backend/index.ts — add to prod startup
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(WORKSPACE, 'dist')));
  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(WORKSPACE, 'dist', 'index.html'));
  });
}
```

The supervisor's static serving logic may already handle this — worth checking before adding it.

---

## 4. DB Migration Strategy

### Current State
Schema is managed via `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN` wrapped in try/catch blocks directly in `db.ts`. This works for additive changes but doesn't handle:
- Column renames
- Table restructuring
- Data backfills
- Ordering and reproducibility across fresh installs

### Proposed: Lightweight Custom Migration Runner

No new dependencies. A migration runner that:
1. Reads numbered `.sql` files from a `migrations/` directory
2. Tracks applied migrations in a `_migrations` table in SQLite
3. Runs only new (unapplied) migrations in order
4. Is idempotent — safe to run on every deploy

**File structure:**
```
migrations/
  001_initial_schema.sql       ← export of current schema (all CREATE TABLE IF NOT EXISTS)
  002_add_analytics_events.sql
  003_add_agent_columns.sql
  ...
  NNN_description.sql
```

**Migration runner script (`scripts/migrate.ts`):**
```typescript
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const WORKSPACE = path.resolve(import.meta.dirname, '..');
const db = Database(path.join(WORKSPACE, 'app.db'));
const MIGRATIONS_DIR = path.join(WORKSPACE, 'migrations');

// Create tracking table
db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const applied = new Set(
  (db.prepare('SELECT filename FROM _migrations').all() as { filename: string }[])
    .map(r => r.filename)
);

const files = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

const runMigrations = db.transaction(() => {
  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`[migrate] Applying ${file}...`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
    console.log(`[migrate] ✓ ${file}`);
  }
});

runMigrations();
console.log('[migrate] Done.');
db.close();
```

**Running migrations:**
- **Dev**: `node --import tsx/esm scripts/migrate.ts` (manual, or on backend boot)
- **Prod CI/CD**: Run as part of deploy script, after `git pull`, before restart
- **Fresh install**: Run on first boot — creates all tables from `001_initial_schema.sql`

### Migration Authoring Rules
1. Files are named `NNN_description.sql` — number prefix controls order
2. All SQL must be **idempotent**: use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
3. Column adds: `ALTER TABLE t ADD COLUMN col TYPE` (SQLite is permissive here)
4. Breaking changes (renames, drops): require a data migration step in the SQL or a paired TypeScript migration
5. **Never edit an applied migration** — add a new one instead

### Transition Plan (Existing Schema → Migrations)
1. Export the current schema (sans data) as `001_initial_schema.sql`
2. Remove all `CREATE TABLE` / `ALTER TABLE` try/catch blocks from `db.ts`
3. Replace with a single call to `runMigrations()` on backend startup
4. Any future schema change → new numbered `.sql` file

---

## 5. Rollback Story

### Code Rollback
```bash
# On prod server: revert to previous commit
git log --oneline -10             # find the last-known-good commit
git reset --hard <commit-sha>
pnpm install --frozen-lockfile
pnpm run build                    # or copy previous artifact
systemctl restart fluxy-prod
```

Git tags make this easier — tag each release:
```bash
# In CI after successful deploy:
git tag -a v$(date +%Y%m%d-%H%M) -m "Deploy $(date)"
git push origin --tags
```

### DB Rollback
SQLite doesn't support transactional DDL rollback. The recovery path:
1. **Before every migration run**, the deploy script backs up the DB:
   ```bash
   cp app.db app.db.backup.$(date +%Y%m%d-%H%M%S)
   ```
2. Keep the last 3 backups (older ones auto-deleted):
   ```bash
   ls -t app.db.backup.* | tail -n +4 | xargs rm -f
   ```
3. If a migration breaks prod: `cp app.db.backup.<timestamp> app.db && systemctl restart fluxy-prod`

> **Practical note**: For a personal workspace with low write volume, SQLite backup/restore is instantaneous. The risk of a failed migration is low but the recovery is fast.

---

## 6. Two Fluxy Instances on the Same Machine

This is realistic and Diego can do it. The key isolation points:

| What | Dev Instance | Prod Instance |
|---|---|---|
| **Workspace dir** | `~/workspace/` | `~/workspace-prod/` |
| **Fluxy port** | 3000 | 3001 |
| **Backend port** | 3004 | 3005 |
| **Database** | `~/workspace/app.db` | `~/workspace-prod/app.db` |
| **Env file** | `.env.development` | `.env.production` |
| **Systemd service** | `fluxy-dev.service` | `fluxy-prod.service` |
| **Supervisor restart** | `systemctl restart fluxy-dev` | `systemctl restart fluxy-prod` |

The prod instance's workspace directory is a git clone of the same repo. CI/CD pulls to it and restarts its supervisor. The dev instance is never touched by CI/CD.

---

## 7. Open Questions for Diego

These require input before implementation:

1. **Where does prod live?** Same machine as dev (simplest) or separate VPS/server?

2. **Branch strategy**: Deploy on push to `main` (current default branch), or create a dedicated `release` branch?

3. **Frontend build location**: Build in CI and transfer artifact (leaner prod server) or build directly on prod server (simpler CI, heavier server)?

4. **Secrets management**: Are prod API keys (OpenAI, GitHub OAuth) the same as dev, or will there be separate accounts/apps for prod?

5. **DB migration timing**: Run migrations on every prod deploy (automatic), or require manual approval before applying? For a personal workspace, automatic is fine.

6. **Rollback granularity**: Is "git reset + restore DB backup" sufficient, or is a more formal blue/green deploy worth the complexity?

7. **Related issue #43**: This proposal assumes a migration system is being built (possibly tracked in #43). Should the migration runner be implemented as part of this work or as a follow-up?

---

## Implementation Sequence

Once Diego answers the open questions, the recommended implementation order:

1. **Migration system** (issue #43 or new issue) — must come first
   - Create `migrations/001_initial_schema.sql` from current `db.ts` schema
   - Write `scripts/migrate.ts` runner
   - Replace try/catch ALTER TABLEs in `db.ts` with migration runner call

2. **Environment config** — low-risk, can start now
   - Create `.env.example`
   - Update `db.ts` env loader to support `.env.development` / `.env.production`
   - Register two GitHub OAuth apps (dev + prod)

3. **Prod instance setup** — requires Diego's infrastructure decision
   - Create prod workspace dir, clone repo
   - Configure prod `.env.production` with prod secrets
   - Set up systemd service for prod Fluxy

4. **CI/CD pipeline** — once prod instance is running
   - Add `.github/workflows/deploy.yml`
   - Add GitHub Actions secrets (`PROD_HOST`, `PROD_USER`, `PROD_SSH_KEY`)
   - Test a deploy end-to-end

5. **Frontend static serving** — quick backend change
   - Add `express.static` for prod builds to `backend/index.ts`

---

*This is a design proposal. No code changes have been made — awaiting Diego's decisions on the open questions above.*
