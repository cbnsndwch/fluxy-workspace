# Multi-Environment Support (dev/prod) — Architecture Proposal

> Status: **Draft** · Issue: #45 · Author: Sebastian (Fluxy) · Date: 2026-04-06

---

## TL;DR

Adopt a two-branch Git workflow (`main` = prod-ready, `dev` = work-in-progress). CI/CD via GitHub Actions: push to `main` → build frontend → SSH into prod server → pull, build, migrate, restart. Prod runs on the same machine (different port) or a cheap VPS, managed by a second `fluxy` process with its own `.env` file and SQLite DB. Migrations use a lightweight custom script layered on top of the existing `CREATE TABLE IF NOT EXISTS` pattern.

---

## 1. Environment Model

### Option Comparison

| Option | Pros | Cons | Fit for Diego |
|---|---|---|---|
| **Same machine, different port** | Zero infra cost, fast deploys, shared hardware | No hardware isolation, prod affected by dev crashes | ✅ Best for solo use |
| **Separate VPS (Hetzner/DO)** | True isolation, prod unaffected by dev work | ~$5/mo, extra SSH key mgmt | ✅ Good if prod needs to be always-on |
| **Fly.io / Railway / Render** | Managed infra, easy deploys | Persistent SQLite volumes are awkward, vendor lock-in | ⚠️ Extra complexity for personal workspace |
| **Docker (same or diff machine)** | Clean isolation per env | Adds Docker dependency to an already lean stack | ⚠️ Overkill unless already using Docker |

**Recommendation:** Start with **same machine, different port**. The workspace is a personal tool, not SaaS — hardware isolation isn't the priority. If Diego wants prod to be independent of local dev activity, a $5/mo Hetzner VPS is the natural upgrade path and the GitHub Actions workflow is identical either way.

### Same-Machine Layout

```
Local machine
├── /home/serge/projects/FLUXY/workspace/       ← dev instance (current)
│   ├── .env                                    ← dev secrets
│   ├── app.db                                  ← dev database
│   └── supervisor running on port 3000
│
└── /home/serge/projects/FLUXY/workspace-prod/  ← prod instance
    ├── .env.production                         ← prod secrets (never committed)
    ├── app.db                                  ← prod database (never committed)
    └── fluxy supervisor running on port 4000
```

Each instance is a full `fluxy` process reading its own workspace directory. They don't share a database or process — complete isolation at the application level.

---

## 2. Environment Configuration

### Current State

`backend/db.ts` manually parses `.env` from the workspace root:

```typescript
const envPath = path.join(WORKSPACE, '.env');
```

This works fine. In prod, the same code reads a `.env` file sitting next to `app.db` in the prod workspace directory. No code changes needed.

### File Strategy

```
workspace/
├── .env                    ← dev secrets (already gitignored)
├── .env.example            ← template with all required keys, no values
```

```
workspace-prod/
├── .env                    ← prod secrets (never committed; provisioned manually or via CI secrets)
```

**`.env.example`** (to be created and committed):

```dotenv
# GitHub OAuth
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=https://your-prod-domain/app/api/auth/github/callback

# OpenAI / Anthropic
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# Fluxy
BACKEND_PORT=3004
FLUXY_WEB_PWD=

# Environment
NODE_ENV=production
```

### Environment Discovery

Add `NODE_ENV` to `.env` in each environment (`development` / `production`). The backend can then gate dev-only features:

```typescript
const isProd = process.env.NODE_ENV === 'production';
```

---

## 3. Git Branching Strategy

```
main    ─── stable, always deployable ──────────────────────►
              ↑
dev     ─── active development ─── PR/merge to main ────────►
              ↑
feature/xxx ─── short-lived feature branches ──────────────►
```

- `dev` is the default working branch
- PRs from `feature/*` → `dev` for review/testing
- When `dev` is stable, merge to `main` → triggers CI/CD deploy to prod
- **Never push directly to `main`** — force-protect it in GitHub repo settings

### Tagging Releases

```bash
git tag v0.17.0 -m "Release 0.17.0"
git push origin v0.17.0
```

Tags give a clean rollback target and are surfaced in the Docs app release notes.

---

## 4. CI/CD Pipeline — GitHub Actions

### Trigger Strategy

| Trigger | Action |
|---|---|
| Push to `main` | Deploy to prod |
| Push to `dev` | Run build check (no deploy) |
| PR to `main` | Run build check + optional staging deploy |

### Full Deploy Workflow

**`.github/workflows/deploy-prod.yml`:**

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

env:
  NODE_VERSION: '22'

jobs:
  deploy:
    name: Build & Deploy
    runs-on: ubuntu-latest
    steps:
      # ── Checkout ─────────────────────────────────────────────────────────────
      - name: Checkout
        uses: actions/checkout@v4

      # ── Setup ────────────────────────────────────────────────────────────────
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # ── Build frontend ───────────────────────────────────────────────────────
      - name: Build frontend
        run: pnpm run build
        env:
          NODE_ENV: production

      # ── Upload build artifact ────────────────────────────────────────────────
      # The compiled frontend is uploaded so the prod server can pull it
      # without needing Node/pnpm on the prod machine for the frontend build.
      - name: Upload dist artifact
        uses: actions/upload-artifact@v4
        with:
          name: frontend-dist
          path: dist/
          retention-days: 7

      # ── Deploy to prod via SSH ────────────────────────────────────────────────
      - name: Deploy to prod server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.PROD_HOST }}
          username: ${{ secrets.PROD_USER }}
          key: ${{ secrets.PROD_SSH_KEY }}
          script: |
            set -e
            cd /home/serge/projects/FLUXY/workspace-prod

            # Pull latest main
            git fetch origin main
            git reset --hard origin/main

            # Install/update dependencies
            pnpm install --frozen-lockfile --prod

            # Download pre-built frontend from artifact
            # (Alternative: build on server if resources allow)
            # pnpm run build

            # Run DB migrations
            node --import tsx/esm backend/migrate.ts

            # Restart the prod fluxy supervisor
            # The supervisor reads FLUXY_WORKSPACE env var to find the workspace
            touch .restart

      - name: Notify on failure
        if: failure()
        run: echo "Deploy failed — check GitHub Actions logs"
        # TODO: integrate with WhatsApp notification via Fluxy webhook
```

### Build-Check Workflow (CI without Deploy)

**`.github/workflows/ci.yml`:**

```yaml
name: CI

on:
  push:
    branches: [dev]
  pull_request:
    branches: [main, dev]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
        env:
          NODE_ENV: production
      - run: pnpm exec tsc --noEmit
```

### Required GitHub Secrets

| Secret | Value |
|---|---|
| `PROD_HOST` | IP or hostname of prod server |
| `PROD_USER` | SSH user (e.g. `serge`) |
| `PROD_SSH_KEY` | Private key for prod SSH access |

---

## 5. Frontend Build in Prod

Vite HMR is dev-only. In prod, Express serves the built static files.

### Build Output

`pnpm run build` emits to `dist/` (configured in `vite.config.ts`):
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js
│   └── index-[hash].css
```

### Express Static Serving

Add to `backend/index.ts` (prod-only):

```typescript
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '..', 'dist');

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath));
  // SPA fallback — all non-API routes return index.html
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
```

The Fluxy supervisor sits in front on port 3000 and proxies `/app/api/*` to Express and serves the frontend via the same port — no Nginx/Caddy needed for basic setup.

---

## 6. DB Migration Strategy

### Current Pattern (Works Fine, Doesn't Scale)

The codebase uses ad-hoc `CREATE TABLE IF NOT EXISTS` + `try { ALTER TABLE } catch {}` in `backend/db.ts`. This is pragmatic but makes it impossible to know "what version is the schema at?"

### Proposed: Lightweight Migration Runner

Create `backend/migrate.ts` — a standalone script, also called at server boot:

```typescript
// backend/migrate.ts
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const WORKSPACE = path.resolve(import.meta.dirname, '..');
const db = Database(path.join(WORKSPACE, 'app.db'));
db.pragma('journal_mode = WAL');

// Ensure migrations table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const applied = new Set(
  (db.prepare('SELECT name FROM _migrations').all() as { name: string }[])
    .map(r => r.name)
);

const migrationsDir = path.join(WORKSPACE, 'backend', 'migrations');
const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  if (applied.has(file)) continue;
  console.log(`[migrate] Applying ${file}`);
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
  db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
  })();
}

console.log('[migrate] All migrations applied.');
db.close();
```

**Migration files** live in `backend/migrations/`:
```
backend/migrations/
├── 0001_initial_schema.sql       ← current schema (extracted from db.ts)
├── 0002_dispatch_batches.sql
├── 0003_research_tables.sql
└── ...
```

Each migration is an append-only SQL file. Sequential numeric prefix guarantees order.

**How this replaces the current ad-hoc approach:**
1. Move all `CREATE TABLE IF NOT EXISTS` statements from `db.ts` into `0001_initial_schema.sql`
2. Each new schema change gets its own migration file
3. `db.ts` at boot calls `runMigrations()` before any app code runs
4. CI pipeline also runs `node --import tsx/esm backend/migrate.ts` as a standalone step

### Running Migrations as Part of Deploy

```bash
# In the SSH deploy step:
node --import tsx/esm backend/migrate.ts
touch .restart   # triggers supervisor to restart backend
```

The migration script is idempotent — safe to run on every deploy.

---

## 7. Rollback Story

### Code Rollback

```bash
# On prod server, revert to previous tag
git checkout v0.16.1
node --import tsx/esm backend/migrate.ts  # migrations are forward-only, this is a no-op
touch .restart
```

Since migrations only ADD things (columns, tables), code rollback doesn't break the schema — old code runs fine against a newer schema that just has extra columns it ignores.

### Database Rollback

SQLite makes this easy — it's a single file:

```bash
# Before deploying, CI step snapshots the DB:
cp app.db app.db.bak-$(date +%Y%m%d%H%M%S)

# To restore:
cp app.db.bak-20260406120000 app.db
touch .restart
```

Keep last 5 snapshots, auto-rotate older ones.

### Rollback GitHub Action Step

Add a snapshot step before migration in the deploy workflow:

```yaml
- name: Snapshot database
  run: |
    cd /home/serge/projects/FLUXY/workspace-prod
    cp app.db app.db.bak-$(date +%Y%m%d%H%M%S)
    # Keep only last 5 backups
    ls -t app.db.bak-* | tail -n +6 | xargs rm -f 2>/dev/null || true
```

---

## 8. Workspace-Specific Constraints

### Two Fluxy Instances on Same Machine

**Yes, this is fully realistic.** The Fluxy supervisor is port-based. Running a prod instance is as simple as:

```bash
# Start prod instance on port 4000
FLUXY_WORKSPACE=/home/serge/projects/FLUXY/workspace-prod \
FLUXY_PORT=4000 \
fluxy start
```

Both instances:
- Have their own SQLite `app.db`
- Have their own `.env`
- Have their own `memory/`, `MEMORY.md`, `MYHUMAN.md` (prod Sebastian stays in sync with dev Sebastian conceptually)
- Listen on different ports

If Diego wants prod exposed publicly: put a reverse proxy (Caddy/Nginx) in front. The dev instance stays on localhost only.

### Prod Sebastian

The prod Fluxy agent will have an empty memory. This is intentional — prod Sebastian isn't the dev workspace's personal assistant, it's the *deployed product*. It can be a read-only viewer, a demo environment, or a second fully active agent with different skills loaded.

### `.restart` Trigger

The supervisor watches for `.restart` file creation to restart the backend. CI can use this:

```bash
touch /home/serge/projects/FLUXY/workspace-prod/.restart
```

This is already the supported restart mechanism — no need to kill processes.

---

## 9. Implementation Checklist

These steps turn this proposal into reality (ordered by dependency):

1. **[ ] Create `.env.example`** — commit it, so new env setup is documented
2. **[ ] Extract migrations** — move all `CREATE TABLE IF NOT EXISTS` out of `db.ts` into `backend/migrations/0001_initial_schema.sql`
3. **[ ] Write `backend/migrate.ts`** — the migration runner
4. **[ ] Wire migration runner into server boot** — call it before any routes register
5. **[ ] Add static file serving** in `backend/index.ts` for `NODE_ENV=production`
6. **[ ] Create `.github/workflows/ci.yml`** — build check on `dev` push and PRs
7. **[ ] Create `.github/workflows/deploy-prod.yml`** — full deploy on `main` push
8. **[ ] Protect `main` branch** in GitHub repo settings (require PR, no direct push)
9. **[ ] Provision prod workspace directory** on target machine
10. **[ ] Add GitHub Secrets** (`PROD_HOST`, `PROD_USER`, `PROD_SSH_KEY`)

---

## 10. Open Questions for Diego

These require decisions before implementation:

| # | Question | Options |
|---|---|---|
| 1 | **Where does prod live?** | Same machine (port 4000), separate VPS, or Fly.io? |
| 2 | **Public-facing prod?** | Is prod accessed from the internet, or localhost only? (affects reverse proxy setup) |
| 3 | **Custom domain for prod?** | e.g. `workspace.diego.dev` — needs DNS + TLS setup |
| 4 | **How to provision prod `.env`?** | Manual SSH copy on first setup, or GitHub Secrets injected into the file by CI? |
| 5 | **Branch naming** | `main`/`dev` or `main`/`develop` or `production`/`main`? |
| 6 | **Migrate immediately?** | Should we refactor the existing schema to migrations now (#43 overlap), or defer until after a real DB move? |
| 7 | **Prod Sebastian** | Should the prod agent have its own memory/identity, or start fresh on each deploy? |
| 8 | **Notification on deploy** | Alert via WhatsApp/chat when a prod deploy completes or fails? |

---

## Summary

The architecture is deliberately simple:
- **Two Git branches** (`dev`/`main`) with a protected `main`
- **GitHub Actions** for CI (build check) and CD (SSH deploy)
- **Same machine, second port** for prod (zero infra cost)
- **Flat SQL migration files** with a simple runner (no ORM required)
- **Express serves static `dist/`** in prod (no separate web server)
- **SQLite file snapshot** before each migration (rollback in 10 seconds)

This matches how traditional web development works, adapted to the constraint that the Fluxy supervisor manages the process lifecycle instead of systemd or Docker.
