# Terraforming Plan: Fluxy → Our Framework

## 1. Context

The upstream Fluxy project (`fluxy-bot@0.17.2` on npm, author: brunobertapeli) ships full TypeScript sources in its npm package. The author has renamed and made significant changes in a new private repo. We want to take the published TS sources and rebuild the project as our own monorepo, optimized for SMB/enterprise use cases rather than the original consumer focus.

This document captures findings, needs, and constraints from our extensive work with the current codebase to inform the terraforming session.

---

## 2. Current Architecture (fluxy-bot@0.17.2)

### 2.1 Process Model

```
systemd: fluxy-dev
  └─ pnpm dev (concurrently)
      ├─ tsx watch supervisor/index.ts   ← hot-reloading supervisor
      └─ vite                            ← standalone dashboard dev server (port 5173)

Supervisor (supervisor/index.ts) — single HTTP server on :3000
  ├─ Vite Dev Server (embedded, :3002)   ← dashboard UI, HMR piggybacked on supervisor socket
  ├─ Worker (in-process Express)         ← SQLite API, /api/* routes, no separate port
  ├─ Backend (child process, :3004)      ← workspace/backend/index.ts, isolated, auto-restart
  ├─ Scheduler                           ← PULSE (autonomous) + CRON jobs
  ├─ ChannelManager                      ← WhatsApp (Baileys), future: Telegram, Discord
  └─ Tunnel                              ← Cloudflare quick/named, relay heartbeat
```

### 2.2 Request Routing (port 3000)

| Path Pattern | Destination |
|---|---|
| `/fluxy/widget.js` | Static file (supervisor/widget.js) |
| `/fluxy/app-ws.js` | WebSocket proxy script |
| `/sw.js`, `/fluxy/sw.js` | Service worker (hardcoded in supervisor) |
| `/app/api/*` | Proxy → backend :3004 |
| `/api/channels/*` | ChannelManager (in-process) |
| `/api/*` | Worker Express app (in-process) |
| `/fluxy/*` | Pre-built chat UI (dist-fluxy/) |
| `/**` (everything else) | Proxy → Vite dev server :3002 |

### 2.3 Key Modules

| File | Size | Purpose |
|---|---|---|
| `supervisor/index.ts` | 63KB | Heart of Fluxy — process orchestrator, HTTP mux, WebSocket routing |
| `supervisor/vite-dev.ts` | ~2KB | Spawns embedded Vite via `createViteServer()` |
| `supervisor/backend.ts` | ~5KB | Child process manager with crash recovery (3x restart) |
| `supervisor/scheduler.ts` | ~3KB | PULSE + CRON runner |
| `supervisor/fluxy-agent.ts` | ~4KB | Claude Agent SDK wrapper for chat |
| `supervisor/channels/manager.ts` | 22KB | Multi-channel message routing, debouncing |
| `supervisor/channels/whatsapp.ts` | 15KB | Baileys integration |
| `worker/index.ts` | 30KB | Express API — all /api/* routes |
| `worker/db.ts` | 9KB | better-sqlite3 wrapper |
| `shared/paths.ts` | ~1KB | PKG_DIR, WORKSPACE_DIR, DATA_DIR resolution |
| `shared/config.ts` | ~2KB | ~/.fluxy/config.json schema |
| `shared/ai.ts` | ~5KB | Provider-agnostic AI client (OpenAI, Anthropic, Ollama) |
| `shared/relay.ts` | ~5KB | fluxy.bot relay API client |

### 2.4 Vite Configuration (Two Configs)

**vite.config.ts** — Dashboard app
- Root: `FLUXY_WORKSPACE/client` or `workspace/client`
- Build → `../../dist` (relative to root)
- Plugins: `react()`, `tailwindcss()`
- Proxies `/app/api` → :3004, `/api` → :3000

**vite.fluxy.config.ts** — Chat UI (separate app)
- Root: `supervisor/chat`
- Base: `/fluxy/`
- Build → `../../dist-fluxy`
- Multi-entry: `fluxy.html` + `onboard.html`

### 2.5 Workspace Template

The npm package ships a minimal workspace template that gets copied on `fluxy init`:
- `workspace/client/` — barebones React app (App.tsx, DashboardPage, Layout, a few UI components)
- `workspace/backend/index.ts` — simple Express stub
- `workspace/package.json` — minimal deps (express, better-sqlite3)
- `workspace/skills/` — sample WhatsApp skills

### 2.6 Published Package

- Ships **raw TypeScript** (not compiled JS) for supervisor/, worker/, shared/, cli/
- Uses `tsx` at runtime (`node --import tsx/esm`)
- 1,128 files, 42.5 MB unpacked (includes workspace/node_modules and video assets)
- Bin: `fluxy` → `bin/cli.js`

---

## 3. Our Workspace: Scale & Divergence

We have massively outgrown the upstream template:

| Metric | Upstream Template | Our Workspace |
|---|---|---|
| Client .tsx/.ts files | ~28 | **126** |
| Client LOC | ~2,000 | **45,957** |
| Backend .ts files | 1 | **38** |
| Backend LOC | ~50 | **27,732** |
| Apps | 1 (Dashboard) | **20** (Analytics, DBViewer, DeepResearch, Docs, FlowCapture, GitViewer, ImageGen, MarbleStudio, Marketplace, Musicologia, Ontologica, Schedules, UserManagement, Workflows, WorkspaceIssues, AppIdeas, Chat, Icebreaker, ImageViewer, Dashboard) |
| Routes | ~3 | **40+** |
| Bundle size (unoptimized) | ~200KB | **3,005 KB** (single chunk) |

---

## 4. Findings from RR7 Framework Mode Migration

### 4.1 What We Did

Migrated from React Router 7 Data Mode (createBrowserRouter) to Framework Mode (SPA output) for automatic route-based code splitting.

**Changes made (32 files, ~3,300 lines):**
- Created `react-router.config.ts` — `{ ssr: false, appDirectory: 'client/src', buildDirectory: 'dist' }`
- Created `client/src/root.tsx` — HTML shell, providers (QueryClient, Analytics, Toaster)
- Created `client/src/entry.client.tsx` — auth interceptor, SW registration, HydratedRouter hydration
- Created `client/src/routes.ts` — 40+ routes using `@react-router/dev/routes` helpers
- Replaced `react()` vite plugin with `reactRouter()` from `@react-router/dev/vite`
- Converted 8 `loader` exports → `clientLoader` (Framework convention for SPA mode)
- Added `export default` to 12 components (Framework requires default export for route modules)
- Created redirect route modules for renamed routes (image-studio → ImageGen, etc.)
- Updated `package.json` scripts: `vite` → `react-router dev`, `vite build` → `react-router build`

### 4.2 Results

**Build succeeded with massive improvement:**
- Before: 1 chunk at 3,005 KB
- After: ~200 KB critical path + lazy-loaded route chunks

**Standalone dev works perfectly** (`react-router dev` at :5177 serves HTML and routes).

### 4.3 What Broke

**The supervisor is fundamentally incompatible with RR7 Framework Mode:**

1. **Two vite.config.ts problem** — Supervisor creates Vite via:
   ```typescript
   createViteServer({ configFile: path.join(PKG_DIR, 'vite.config.ts') })
   ```
   This uses PKG_DIR's config (still old `react()` plugin), not our workspace config (new `reactRouter()` plugin).

2. **`tsx watch` restart loop** — When we pointed supervisor at workspace's vite.config.ts, Vite creates and deletes temp files in `workspace/node_modules/.vite-temp/`, which `tsx watch` detects as a change and restarts the supervisor endlessly.

3. **Root directory mismatch** — Old config has `root: FLUXY_WORKSPACE/client`, Framework Mode needs `root: FLUXY_WORKSPACE` (one level up, since `appDirectory: 'client/src'` is relative to root).

4. **Warmup path broken** — Old config warms `./src/main.tsx` which no longer exists (replaced by `entry.client.tsx` auto-generated by RR7).

5. **`@` alias CWD-sensitivity** — `path.resolve('./client/src')` resolves relative to CWD, not Vite root. When supervisor runs from PKG_DIR, the alias points to wrong location.

### 4.4 Root Cause Analysis

The upstream architecture **cannot cleanly support a Vite plugin that takes over the dev server** (like reactRouter()). The reasons are structural:

- **Supervisor embeds Vite programmatically** via `createViteServer()` with hardcoded `configFile` pointing to PKG_DIR
- **Two separate builds** (dashboard + chat UI) managed by two separate Vite configs
- **The `concurrently "tsx watch" "vite"` dev script** creates a double-dev-server situation (standalone Vite on :5173 AND embedded Vite on :3002)
- **HMR is piggybacked** on the supervisor's HTTP server, not Vite's own — RR7 Framework Mode expects to control the Vite server lifecycle

---

## 5. Architectural Pain Points & Constraints

### 5.1 Things That Don't Work for Us

| Issue | Impact | Root Cause |
|---|---|---|
| **Monolithic supervisor (63KB file)** | Hard to maintain, hard to extend | All routing, proxying, WebSocket handling in one file |
| **Two Vite configs** | Config drift, framework plugin incompatibility | Dashboard and chat UI built separately |
| **PKG_DIR vs WORKSPACE_DIR split** | Path resolution bugs, alias issues, config duplication | Designed for npm package distribution, not monorepo dev |
| **In-process worker** | Can't restart API without restarting everything | Express app shares supervisor process |
| **`tsx watch` + Vite temp files** | Infinite restart loops | File watcher not properly configured to ignore Vite artifacts |
| **No code splitting** | 3MB initial bundle | Data Mode createBrowserRouter has no route-level splitting |
| **Hardcoded service worker** | Can't customize | SW source embedded as string constant in supervisor/index.ts |
| **Consumer-oriented defaults** | WhatsApp/chat focus, not dashboards | Our 20 apps need enterprise-grade routing, auth, code splitting |

### 5.2 Things That Work Well & Should Be Preserved

| Feature | Why It's Good |
|---|---|
| **Single-port architecture** | Simple deployment, works through tunnels |
| **Child process backend** | Crash isolation, auto-restart, clean separation |
| **Cloudflare tunnel integration** | Zero-config remote access |
| **Channel abstraction** | Pluggable messaging (WhatsApp, etc.) |
| **PULSE/CRON scheduler** | Autonomous task execution |
| **Claude Agent SDK integration** | Powerful AI agent capabilities |
| **SQLite + better-sqlite3** | Simple, fast, no external DB needed |
| **Config-driven setup** | `~/.fluxy/config.json` for all settings |

---

## 6. Requirements for New Architecture

### 6.1 Must Have

1. **RR7 Framework Mode with SPA output** — route-based code splitting is non-negotiable at 20+ apps
2. **Single Vite config** — one `vite.config.ts` with `reactRouter()` plugin, no duality
3. **Proper monorepo structure** — pnpm workspaces, shared packages, clear boundaries
4. **Supervisor → Vite integration that works with Framework Mode** — either proxy to standalone `react-router dev` process, or properly configure embedded Vite with the plugin
5. **Hot reload that doesn't loop** — proper file watching ignore patterns

### 6.2 Should Have

6. **Decomposed supervisor** — break the 63KB monolith into focused modules
7. **Worker as separate process** — like backend, for independent restarts
8. **Build pipeline** — `react-router build` for client, separate build for supervisor/worker
9. **Type-safe API layer** — shared types between backend and client
10. **Proper auth middleware** — our workspace already has auth; it needs first-class support

### 6.3 Nice to Have

11. **Turbo/nx for monorepo orchestration** — task caching, incremental builds
12. **Server-rendered critical path** — optional SSR for initial load performance
13. **E2E testing harness** — Playwright or similar for integration tests

---

## 7. Proposed Monorepo Structure

```
fluxy/
├── packages/
│   ├── supervisor/        ← process orchestrator (decomposed from 63KB monolith)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── vite-dev.ts
│   │   │   ├── backend-runner.ts
│   │   │   ├── scheduler.ts
│   │   │   ├── tunnel.ts
│   │   │   └── channels/
│   │   └── package.json
│   ├── worker/            ← API server (Express + SQLite)
│   │   ├── src/
│   │   └── package.json
│   ├── shared/            ← types, config, paths, logger
│   │   ├── src/
│   │   └── package.json
│   └── cli/               ← fluxy init/start/daemon/tunnel/update
│       ├── src/
│       └── package.json
├── apps/
│   └── dashboard/         ← React Router 7 Framework Mode (our 20+ apps)
│       ├── client/src/    ← appDirectory
│       ├── react-router.config.ts
│       ├── vite.config.ts ← single config, reactRouter() plugin
│       └── package.json
├── workspace/             ← runtime workspace data (not in packages/)
│   ├── backend/
│   ├── files/
│   ├── memory/
│   ├── skills/
│   ├── MYSELF.md
│   └── ...
├── pnpm-workspace.yaml
├── package.json
└── turbo.json             (optional)
```

### 7.1 Key Architecture Decision: Vite Integration

**Recommended: Proxy approach (not embedded)**

Instead of `createViteServer()` inside supervisor, the supervisor should proxy to a standalone `react-router dev` process. This:
- Lets RR7 fully control its Vite lifecycle
- Eliminates the HMR-on-supervisor-socket complexity
- Avoids the tsx-watch restart loop
- Makes production simpler (just serve `dist/client/` static files)

```
Supervisor :3000
  ├─ /api/*          → Worker (in-process or separate)
  ├─ /app/api/*      → Backend child process :3004
  ├─ /fluxy/*        → Chat UI (pre-built static)
  └─ /**             → Proxy to react-router dev :5173 (dev) or serve dist/ (prod)
```

### 7.2 Key Architecture Decision: Worker Isolation

**Recommended: Keep in-process for now, extract later**

The in-process worker is simpler for dev and has lower latency. Later, if we need independent restarts, we can extract it to a separate process.

---

## 8. Migration Strategy

### Phase 1: Scaffold Monorepo
- Create pnpm workspace structure
- Extract supervisor, worker, shared, cli into packages/
- Move dashboard app into apps/dashboard/
- Set up shared tsconfig, eslint configs

### Phase 2: Dashboard → RR7 Framework Mode
- Apply our existing migration work (entry.client.tsx, root.tsx, routes.ts, clientLoaders)
- Single vite.config.ts with reactRouter() plugin
- Verify standalone `react-router dev` works

### Phase 3: Supervisor Integration
- Implement proxy-to-Vite approach (not embedded)
- Supervisor spawns `react-router dev` as child process in dev mode
- Supervisor serves `dist/client/` static files in production
- Keep HMR WebSocket forwarding through supervisor for tunnel compatibility

### Phase 4: Polish
- Fix all path aliases and module resolution
- Proper ignore patterns for file watchers
- systemd unit updates
- Build pipeline (dev, build, start scripts)

---

## 9. Files to Preserve from Current Migration

These files from our RR7 migration attempt are valid and should be carried forward:

| File | Status | Notes |
|---|---|---|
| `client/src/root.tsx` | **New, keep** | HTML shell, providers, HydrateFallback |
| `client/src/entry.client.tsx` | **New, keep** | Auth interceptor, SW reg, HydratedRouter |
| `client/src/routes.ts` | **New, keep** | 40+ routes, explicit IDs for shared files |
| `client/src/routes/*.tsx` | **New, keep** | Redirect route modules |
| `react-router.config.ts` | **New, keep** | `{ ssr: false, appDirectory, buildDirectory }` |
| 8 route modules | **Modified, keep** | `loader` → `clientLoader` conversions |
| 12 components | **Modified, keep** | Added `export default` |
| `RootLayout.tsx` | **Modified, keep** | `rootLoader` → `clientLoader`, ErrorBoundary re-export |
| `AnalyticsProvider.tsx` | **Modified, keep** | SSR safety guard |
| `vite.config.ts` | **Modified, keep** | `reactRouter()` plugin, but needs alias fix |
| `client/index.html` | **Deleted, correct** | RR7 Framework generates its own |
| `client/src/main.tsx` | **Deleted, correct** | Replaced by entry.client.tsx |
| `client/src/router.tsx` | **Deleted, correct** | Replaced by routes.ts |

---

## 10. Open Questions

1. **What's the new project name?** — Upstream renamed; what should we call ours?
2. **Keep chat UI?** — Do we need supervisor/chat/ (the Fluxy conversational UI), or is it fully replaced by our dashboard?
3. **WhatsApp channels** — Do we need the Baileys WhatsApp integration for our SMB/enterprise focus?
4. **Relay service** — Do we need the fluxy.bot relay, or will we use our own tunnel/domain setup?
5. **Claude Agent SDK** — Keep the autonomous agent integration, or replace with our own LLM orchestration?
6. **npm distribution** — Will our version be published as an npm package, or deployed differently?
