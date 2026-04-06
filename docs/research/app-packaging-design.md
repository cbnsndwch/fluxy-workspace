# Fluxy App Packaging & Distribution System — Design Proposal

**Author:** Sebastian (Fluxy AI)
**Date:** 2026-04-06
**Status:** Proposal — not yet implemented

---

## 1. What Is a "Fluxy App"?

A Fluxy app is a self-contained feature module that can be installed into any Fluxy workspace. It consists of:

| Layer | Contents |
|---|---|
| **Backend** | Express router(s), DB migrations (SQLite DDL), business logic |
| **Frontend** | React components, route definitions, sidebar entries, dashboard widgets |
| **Assets** | Icons, images, static files |
| **Config** | Required env vars, default settings |
| **Dependencies** | npm packages (backend + frontend) |
| **Data** | Optional seed data, default records |
| **Metadata** | `fluxy-app.json` manifest describing everything above |

All of these must be expressible in a single distributable artifact.

---

## 2. Recommended Distribution Format: The `.fluxy-app` Bundle

### Decision: Zip Bundle + Manifest

After evaluating four options, the recommended format is a **`.fluxy-app` file** — a ZIP archive with a structured directory layout and a `fluxy-app.json` manifest at its root.

**Why not npm?**
- Requires a build step and npm registry account
- Tight coupling to the host's Node/React version
- Not user-friendly — Diego shouldn't need to know about `package.json` peer deps to install a CRM

**Why not git submodules?**
- Developer-only. Non-technical Fluxy users won't touch it.
- Doesn't support DB migrations or install hooks natively

**Why not a hosted App Store API (only)?**
- Requires Fluxy infrastructure to be running 24/7
- Single point of failure — apps can't be installed offline
- Good as a *layer on top* of bundles, not as a replacement

**Why `.fluxy-app` bundles?**
- Framework-agnostic at the transport layer
- Works offline (download file, install locally)
- Can be hosted anywhere (GitHub releases, S3, CDN)
- The manifest is machine-readable — Sebastian can parse it and do the install autonomously
- Simple to generate: `zip -r my-app.fluxy-app .`
- Easy to inspect and version-control (manifest is a JSON file)

The hosted **Fluxy App Store API** is the delivery layer on top — it hosts bundles and metadata. The install mechanism is always "download bundle → run installer."

---

## 3. Bundle Structure

```
my-app.fluxy-app  (ZIP archive)
├── fluxy-app.json          ← manifest (required)
├── backend/
│   ├── router.ts           ← Express router factory, exports createRouter(db)
│   ├── migrations/
│   │   ├── 001_create_tables.sql
│   │   └── 002_add_index.sql
│   └── types.ts            ← shared TypeScript types (optional)
├── frontend/
│   ├── Page.tsx            ← main page component (default export)
│   ├── Widget.tsx          ← dashboard widget (optional)
│   ├── components/         ← sub-components
│   └── store/              ← Zustand stores, hooks
├── assets/
│   └── icon.svg
├── seed/
│   └── defaults.json       ← optional seed data
└── tasks/
    └── my-cron.md          ← optional CRON task files
```

---

## 4. The `fluxy-app.json` Manifest Schema

```json
{
  "$schema": "https://fluxy.bot/schemas/fluxy-app/v1.json",

  "id": "crm",
  "name": "CRM",
  "version": "1.2.0",
  "description": "Contact & company management with a Kanban deals pipeline.",
  "author": {
    "name": "Diego",
    "url": "https://fluxy.bot/@diego"
  },
  "license": "MIT",

  "minFluxyVersion": "1.0.0",
  "frontendFramework": {
    "required": "react",
    "minVersion": "18.0.0",
    "router": "react-router-v6"
  },

  "backend": {
    "entrypoint": "backend/router.ts",
    "apiPrefix": "/api/crm",
    "migrations": [
      "backend/migrations/001_create_contacts.sql",
      "backend/migrations/002_create_companies.sql",
      "backend/migrations/003_add_deals.sql"
    ]
  },

  "frontend": {
    "page": {
      "component": "frontend/Page.tsx",
      "path": "/crm",
      "navLabel": "CRM",
      "section": "main",
      "icon": "Users",
      "color": "bg-blue-500/10 text-blue-500"
    },
    "widget": {
      "component": "frontend/Widget.tsx"
    }
  },

  "assets": [
    "assets/icon.svg"
  ],

  "npmDependencies": {
    "backend": {
      "fuse.js": "^7.0.0"
    },
    "frontend": {
      "@dnd-kit/core": "^6.1.0",
      "@dnd-kit/sortable": "^8.0.0"
    }
  },

  "requiredEnvVars": [
    {
      "key": "OPENAI_API_KEY",
      "description": "OpenAI API key — used for contact enrichment",
      "required": false
    }
  ],

  "crons": [
    {
      "id": "crm-sync",
      "schedule": "0 9 * * *",
      "task": "Daily CRM data sync. See tasks/crm-sync.md.",
      "taskFile": "tasks/crm-sync.md"
    }
  ],

  "seed": {
    "file": "seed/defaults.json",
    "runOnInstall": false,
    "idempotencyKey": "crm-seed-v1"
  },

  "tags": ["crm", "contacts", "sales", "productivity"],
  "screenshots": [],
  "homepage": "https://fluxy.bot/apps/crm"
}
```

### Schema Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✅ | Unique slug. Must be URL-safe, lowercase. |
| `name` | string | ✅ | Human-readable display name |
| `version` | string | ✅ | SemVer — `MAJOR.MINOR.PATCH` |
| `description` | string | ✅ | 1–2 sentence description |
| `author` | object | ✅ | `name` + optional `url` |
| `license` | string | — | SPDX identifier |
| `minFluxyVersion` | string | ✅ | Minimum Fluxy version required |
| `frontendFramework` | object | ✅ | See §6 on compatibility |
| `backend.entrypoint` | string | — | Path to router factory. Omit for backend-less apps. |
| `backend.apiPrefix` | string | — | Route namespace (e.g. `/api/crm`) |
| `backend.migrations` | string[] | — | SQL files in order. Each is idempotent (CREATE TABLE IF NOT EXISTS). |
| `frontend.page` | object | — | Route + sidebar config |
| `frontend.widget` | object | — | Optional dashboard widget |
| `npmDependencies` | object | — | `{backend: {}, frontend: {}}` — package → version spec |
| `requiredEnvVars` | array | — | List of env vars with descriptions and `required` flag |
| `crons` | array | — | CRON tasks to register on install |
| `seed` | object | — | Optional seed data config |
| `tags` | string[] | — | Discovery tags |

---

## 5. DB Migration Safety

**Core principle: every migration must be idempotent.**

All DDL in migration files must use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (SQLite 3.37+).

**Conflict detection:** Before running any migration, the installer scans existing table names against the app's migration files. If a table name collision is found that isn't from the same app (tracked via an `installed_apps` registry table), the install is aborted with a clear error.

**Migration tracking table** (created once by the installer on first use):

```sql
CREATE TABLE IF NOT EXISTS _fluxy_migrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id      TEXT NOT NULL,
  filename    TEXT NOT NULL,
  checksum    TEXT NOT NULL,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(app_id, filename)
);
```

**Install flow for migrations:**
1. Compute SHA-256 of each migration file
2. Skip files where `(app_id, filename, checksum)` already exists in `_fluxy_migrations`
3. Run remaining files in filename order (alphabetical = version order)
4. Record each successful migration in `_fluxy_migrations`

**Re-runs are safe** — already-applied migrations are no-ops by checksum match. If a file changes after install (tampered or corrupted), the installer warns and refuses to re-run it.

**Installed apps registry:**

```sql
CREATE TABLE IF NOT EXISTS _fluxy_installed_apps (
  app_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  version     TEXT NOT NULL,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  manifest    TEXT NOT NULL  -- full JSON for rollback reference
);
```

---

## 6. Frontend Framework Compatibility Strategy

### The Reality

Most Fluxy workspaces are built with the same React + Vite + React Router v6 stack that Diego's workspace uses. This is the only currently-supported target.

### Compatibility Tiers

| Tier | Framework | Support Level |
|---|---|---|
| **Tier 1** | React 18+ + React Router v6 | Full support. All apps work. |
| **Tier 2** | React 18+ + React Router v7 (framework mode) | Supported with file drop. Router adapts. |
| **Tier 3** | React 18+ + no router (or custom) | Supported if the host provides a route mechanism. App ships component only. |
| **Tier 4** | Vue / Svelte / vanilla | Not supported. App Store shows compatibility warning. Install blocked. |

### The `frontendFramework` Manifest Field

```json
"frontendFramework": {
  "required": "react",
  "minVersion": "18.0.0",
  "router": "react-router-v6"
}
```

`router` can be: `"react-router-v6"`, `"react-router-v7"`, `"none"` (component only), or omitted (any).

The installer reads the host's `package.json` to detect the actual framework. If it doesn't match `frontendFramework.required`, the install is blocked with a clear message.

### For Non-React Workspaces

If a future Fluxy workspace runs on a different stack, two options exist:

**Option A — Web Components wrapper (preferred long-term):**
The app ships a `web-component/` directory with a compiled custom element wrapping the React component. This is framework-agnostic and plugs into any HTML-based host. Build step required at bundle time (esbuild + React DOM).

**Option B — Declare incompatibility:**
The `frontendFramework.required` field explicitly blocks install on non-React hosts. Clean and honest. The App Store shows a "React required" badge.

**Recommendation for now:** Tier 1 only. Ship `frontendFramework.required: "react"`. Revisit Web Components when there's an actual non-React user.

---

## 7. Install Flow

### 7a. Via Sebastian (Chat)

This is the primary UX. Diego types: `"install the CRM app"`.

Sebastian's install procedure:

1. **Resolve the app** — search the App Store API for `id: "crm"` or fetch a URL/path
2. **Download bundle** — `curl https://apps.fluxy.bot/crm-1.2.0.fluxy-app -o /tmp/crm.fluxy-app`
3. **Parse manifest** — read `fluxy-app.json`
4. **Compatibility check** — compare `frontendFramework` against host's `package.json`
5. **Env var check** — list all `requiredEnvVars` where `required: true` and confirm they exist in `.env`
6. **Conflict check** — scan `_fluxy_migrations` and `_fluxy_installed_apps` for conflicts
7. **Install npm deps** — `npm install fuse.js@^7.0.0` (backend) and frontend deps
8. **Copy backend files** — extract `backend/` into `backend/apps/{id}/`
9. **Register backend router** — add `import` + `app.use(...)` to `backend/index.ts`
10. **Run migrations** — execute SQL files via `db.exec()` in order
11. **Copy frontend files** — extract `frontend/` into `client/src/components/{PascalCaseId}/`
12. **Update app registry** — add entry to `client/src/lib/appRegistry.ts`
13. **Add route** — insert `<Route>` into `client/src/App.tsx`
14. **Copy assets** — extract `assets/` into `client/public/apps/{id}/`
15. **Register CRONs** — append entries to `CRONS.json` and create task files
16. **Record install** — write to `_fluxy_installed_apps`
17. **Touch `.restart`** — force backend restart
18. **Report** — "CRM is installed! Head to /crm or click it in the sidebar."

If any step fails, Sebastian reverses the completed steps (file deletes, migration rollback if possible) and reports what went wrong.

### 7b. Via Dashboard UI (App Marketplace page)

The existing `/marketplace` page evolves from a "pricing showcase" to an actual install UI:

1. Browse app catalog (fetched from App Store API or local bundle directory)
2. Click "Install" on any app
3. Dashboard calls `POST /api/marketplace/install` with `{ appId: "crm" }`
4. Backend runs the install procedure (same steps as above, server-side)
5. Server-sent events stream install progress to the UI
6. On completion: sidebar refreshes, success toast, link to the new app

### 7c. Manual Install (Power Users)

1. Download `.fluxy-app` file
2. Drop it into `~/.fluxy/apps/pending/` or `workspace/apps/pending/`
3. Ask Sebastian: "install from the pending bundle" — or trigger `POST /api/marketplace/install-local`

---

## 8. Versioning and Updates

### How Updates Work

Apps declare their version in the manifest (`version: "1.2.0"`). The `_fluxy_installed_apps` table records the installed version.

**Update check** (run by Sebastian on PULSE or explicitly):
```
GET https://apps.fluxy.bot/api/apps/{id}/latest
→ { "version": "1.3.0", "changelog": "...", "downloadUrl": "..." }
```

If `latest.version > installed.version`, Sebastian notifies Diego.

**Update procedure:** Same as install, but:
- Migrations run only for new files (checksum-based skip)
- Existing backend/frontend files are overwritten (old files backed up to `.fluxy/backups/{id}/`)
- `_fluxy_installed_apps.version` is updated
- If the update fails, the backup is restored

### Semantic Versioning Rules for App Authors

| Change | Version bump |
|---|---|
| New feature, backwards compatible | MINOR |
| Bug fix only | PATCH |
| Breaking DB migration (drops/renames columns) | MAJOR |
| Removes or renames a route | MAJOR |

Breaking changes require explicit user consent before install.

---

## 9. App Authoring (Packaging an Existing App)

To package an existing workspace app for distribution, Sebastian can:

1. Read `backend/apps/{id}/` and `client/src/components/{Id}/`
2. Read the app's registry entry from `appRegistry.ts`
3. Extract its routes from `App.tsx`
4. Generate a `fluxy-app.json` manifest from the above
5. Zip everything into `{id}-{version}.fluxy-app`
6. Optionally publish to the App Store API

This is the "export" counterpart to the "import" install flow.

---

## 10. Open Questions (Not Blocking)

1. **App Store infrastructure**: Who runs `apps.fluxy.bot`? Is it part of the Fluxy SaaS? Self-hosted? For now, apps can be shared as files (GitHub releases, direct links).

2. **Code signing**: Should bundles be signed to prevent tampering? Consider SHA-256 checksums of the bundle itself, published alongside. Not cryptographic signing yet.

3. **Sandboxing**: Installed apps run in the same process as the host. A malicious app could do anything the backend can do. For now, trust model is "you install what you choose to install." Future: consider Docker-based app sandboxing.

4. **Hot-reload on install**: Currently, install requires a backend restart and page reload. Future: dynamic route registration without restart.

5. **Uninstall**: Not covered here. Needs a separate design — migration rollback is especially tricky if data already exists.

---

## 11. Summary

| Decision | Choice |
|---|---|
| Distribution format | `.fluxy-app` ZIP bundle + `fluxy-app.json` manifest |
| Primary install UX | Sebastian via chat |
| Secondary install UX | Dashboard Marketplace page → `POST /api/marketplace/install` |
| DB migrations | Idempotent SQL files, checksum-tracked in `_fluxy_migrations` |
| Frontend compatibility | React 18+ / React Router v6 (Tier 1 only for now) |
| Non-React workspaces | Blocked at install with clear message |
| Updates | Opt-in, Sebastian-initiated, semantic versioning |
| App Store | Hosted bundle registry at `apps.fluxy.bot` (future) |

The `.fluxy-app` format is simple enough to create by hand, structured enough for automation, and open enough to evolve toward a full App Store without a rewrite.
