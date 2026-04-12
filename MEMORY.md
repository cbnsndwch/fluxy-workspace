# Long-Term Memory

## Workspace Architecture
- Multi-app workspace: App Ideas Canvas, Workspace Issues tracker (+ more to come)
- Diego's vision: build a GHL-like product space incrementally — additive, never destructive
- Full GHL feature analysis in `memory/ghl-feature-analysis.md`

## Apps Built
- **App Ideas Canvas** — React Flow infinite canvas, idea nodes, connections, stages, groups. Tables: `app_ideas`, `app_idea_connections`
- **Workspace Issues** — issue tracker with workflow node editor (@xyflow/react)
- **GitHub OAuth auth** — users + sessions tables, httpOnly cookie sessions, GitHub OAuth flow
- **Workflow Engine** — n8n-style visual workflow builder. Node types: http_request, code, log, transform, cron_trigger, db_query. Sandboxed JS (worker thread + vm). Variable interpolation (`{{key}}`). Cron scheduler auto-starts on backend boot.
- **Deep Research** — topic-based web research. I (Sebastian) do the research via `research-worker` CRON (every 30min). Detail levels: brief/standard/deep. Ongoing topics with revisit intervals (daily→yearly). Sessions archived on revisit, reports stay self-contained. Tables: `research_topics`, `research_sessions`, `research_findings`, `research_reports`. Task file: `tasks/research-worker.md`.
- **Analytics** — self-hosted event tracking. `analytics_events` table. Backend routes: POST /analytics/events, GET /analytics/overview, GET /analytics/apps/:appId, GET /analytics/feed. Frontend: `AnalyticsProvider` wraps app in main.tsx (@cbnsndwch/react-tracking, 800ms batched dispatch). `useAppTracking(appId)` hook used in all major apps. Dashboard at `/analytics` with Overview (charts), Per App, and Live Feed tabs. Indigo color theme.
- **Flow Capture** — speech-to-diagram app. Persistent sessions + chunks system. Each speech fragment saved independently; diagram reconstructed/remixed from all chunks. Backend: `flow_sessions`, `flow_chunks`, `flow_diagrams` tables. Uses OpenAI gpt-4o-mini for diagram generation. Remix mode regenerates fresh without using prior diagram as base. SVG healing keeps last valid diagram on mermaid parse failure. Segment selection: click card → highlights corresponding diagram nodes (violet glow + `chunkNodeMap` in `flow_diagrams`). Freshly-added segments get a violet ring. Edit (pencil) and select (card body click) are separate actions.
- **Docs App** — has a full release notes section (`docs/release-notes/`). 11 dated files covering full git history from 2026-02-21 to 2026-04-05 (97 commits, authors: Bruno Bertapeli, cbnsndwch/Diego/Serge). Includes index.md with overview table. Deep linking fixed 2026-04-06 (URL slug routing: `docs/*` route, `pathToSlug`/`findBySlug` helpers, `useParams`-driven selection). Frontmatter support added 2026-04-06 (issue #47): zero-dep YAML FM parser/serializer in backend, `PATCH /api/docs/file` endpoint, `FrontmatterDialog` (Settings2 icon), description meta bar, tag chips, FM-aware sidebar titles, FM-stripped rendered view.
- **Marble Studio** — 3D world viewer app. WorldLabs integration. Gallery-first UX (2026-04-06 redesign): full-width grid (no sidebar), `aspect-video` cards, `+New World` dashed card, `← Gallery` overlay button on viewer canvas. Sync + Settings + New World in header actions. API key required (amber dot on settings icon if missing). API key encrypted with AES-256-GCM in DB (issue #36). Progressive SPZ loading: 100k → auto-upgrade to 500k → full_res on demand; particle sphere animation during load; quality badge overlay.
- **Workspace Extensions** — global header injection system (2026-04-06). `WorkspaceExtensionsProvider` in `App.tsx` → `AppLayout` consumes via context. Currently: `ReportIssueAction` (amber TriangleAlert) injected into all app headers except Issues. `IssueModal` extracted to `client/src/components/WorkspaceIssues/IssueModal.tsx`. Adding new global actions: implement in `ReportIssueAction.tsx` or create new action component + register in `workspaceExtensions.tsx`.
- **Git Viewer** — read-only workspace git viewer (2026-04-07). Backend: `backend/apps/git-viewer/index.ts`, 6 routes via `child_process.execSync` + git CLI (status, log, branches, worktrees, commit detail+diff, uncommitted diff). Frontend: `client/src/components/GitViewer/GitViewerPage.tsx`, split-panel — tabbed left (Log/Branches/Worktrees) + diff viewer right. `History` icon, `lime` color, workspace section, path `/git-viewer`. Shows uncommitted changes row at top of log when working tree is dirty.
- **Uploads (ImageViewer)** — file browser for chat-uploaded images and documents (2026-04-07). Backend: `backend/apps/image-gen/index.ts` extended with `GET /api/uploads` (list files) + `GET /api/uploads/doc/:filename` (serve docs). Frontend: `client/src/components/ImageViewer/ImageViewerPage.tsx` — gallery grid with lightbox + filmstrip navigation for images, PDF preview for docs. `Paperclip` icon, `blue` color, workspace section, path `/uploads`.

## Agent Dispatch System (2026-04-05)
- Workspace Issues now supports dispatching selected issues to parallel Sebastian agents via CRON worktrees
- DB additions to `workspace_issues`: `agent_status`, `agent_log`, `agent_branch`, `batch_id`; new `dispatch_batches` table
- Backend (`backend/apps/issues/index.ts`): POST /api/issues/dispatch, PATCH /api/issues/:id/agent-update, GET /api/dispatch-batches, GET /api/dispatch-batches/:id, POST /api/dispatch-batches/:id/sync-complete
- Flow: Dispatch → N oneShot CRONs (1-min delay) → each agent creates git worktree at `.claude/worktrees/issue-{id}/` → fixes → commits → calls agent-update → last done triggers sync CRON → sync agent reviews/merges → reports to Diego (importance 9)
- Frontend: select mode with checkboxes, "Dispatch N to Sebastian" violet button, agent status badges (Queued/Working/Done/Failed), auto-poll every 5s, DispatchBatchesPanel with live per-issue status + sync report

## Workflow Engine Details
- Sandbox: worker thread + vm.runInNewContext. Pure JS builtins only. 5s outer / 4s inner timeout.
- `transform` node: single JS expression (no `return`), runs in sandbox
- `cron_trigger` node: schedule + initial_data. Scheduler polls every 30s, deduplicates by minute key
- `db_query` node: SQL against workspace SQLite. SELECT → row array; INSERT/UPDATE/DELETE → {changes, lastInsertRowid}. Supports `?` params and interpolation.
- Copy/paste (Ctrl+C/V), select-all (Ctrl+A), delete, import/export JSON, duplicate — all implemented
- cron-parser v5: use `CronExpressionParser.parse()` — no `parseExpression` named export

## Auth System
- GitHub OAuth implemented and credentials are in .env (as of 2026-03-23 pulse fix)
- Routes: `GET /auth/github`, `GET /auth/github/callback`, `GET /auth/me`, `POST /auth/logout`
- Frontend: auth store (Zustand), LoginPage, App.tsx route guard, sidebar user avatar
- .env had duplicate empty GitHub var entries — fixed during 2026-03-23 pulse (dotenv uses first occurrence)

## Issues
- 52 workspace issues processed through the agent dispatch system (batches #4–#8 all done)
- Issue tracker is clean — all issues in terminal `done` state (note: terminal status is `done`, not `closed`)
- Dispatch batch #4: 7 bugs fixed (#26, #29, #30, #31, #32, #33, #40)
- Dispatch batch #5: 4 strategic research/design proposals — all docs-only, **awaiting Diego's review and decisions before implementation begins**:
  - **#43** — SQLite → PostgreSQL migration (`docs/db-migration-recommendation.md`). Rec: Postgres + Drizzle ORM. ~15-20h effort.
  - **#44** — React Router v7 framework mode (`docs/research/rr7-framework-mode-evaluation.md`). Rec: stay on data mode.
  - **#45** — Multi-env CI/CD design (`docs/architecture/multi-environment-cicd.md`). 7 open questions for Diego.
  - **#46** — App packaging & distribution (`docs/thoughts/app-packaging-design.md`). `.fluxy-app` ZIP bundle format, 17-step install flow.
- Dispatch batch #6: issue #47 (Docs frontmatter support) — merged to main
- Dispatch batch #7 (2026-04-07): 2 bugs fixed, both merged to main
  - **#49** — Uploads lightbox 404: added `/api/uploads/image/:filename` route, fixed listing URLs
  - **#50** — Marble Studio WithTracking crash: simplified `AnalyticsProvider` to plain fragment, removed `track()` HOC wrapper from `@cbnsndwch/react-tracking` (was vestigial — `useTracking()` never used, all tracking via `dispatch()` directly)
- Dispatch batch #8 (2026-04-07): 2 bugs fixed, both merged to main
  - **#51** — Uploads lightbox bad href: switched URL from `/app/api/uploads/image/` to `/api/files/images/` (worker's authoritative static path)
  - **#52** — Router error from Uploads `IssueCreatedToast`: moved `useNavigate()` out of toast (outside Router context via Sonner) up to `ReportIssueAction`, passed as prop
- Dispatch batches #9–#15 (2026-04-08): Musicologia 7-phase build via automated dispatch. All 59 issues now in `done` state.
- **Icebreaker** — AI-generated conversation starters from live tech headlines (2026-04-07). Backend: `backend/icebreaker.ts` — fetches HN/TechCrunch/TheVerge/Ars headlines, clusters by topic, generates icebreaker questions via OpenAI. Frontend: `client/src/components/Icebreaker/IcebreakerPage.tsx` — AppLayout, history panel, Steven Mode (animated fire overlay + personality shift). `MessageSquarePlus` icon, red color, main section, path `/icebreaker`.
- **Ontologica** — ontology extraction & knowledge graph builder. 8-stage LLM pipeline: CHUNK → TERMS → CLASSIFY → BASE_RESOLVE → TAXONOMY → RELATIONS → VALIDATE → MERGE. Projects with document upload, base vocabulary layers, force-directed graph viz (react-force-graph-2d), tree view, review tab (grid cards, filters, bulk approve), OWL export. 7+ onto_* tables. `Music` icon, purple, main section, `/ontologica`. Batch #22-23 landed base layer features (2026-04-11).
  - **LLM Migration (2026-04-12)**: Switched from OpenAI to Claude (Anthropic SDK). Shared `backend/apps/ontologica/llm.ts` — `jsonCompletion()`, `textCompletion()`, `isAvailable()`. Default model: claude-sonnet-4-20250514. ANTHROPIC_API_KEY needed in .env.
  - **cProcess Base Layer (2026-04-12)**: `cp:` prefix, `https://ontology.cprocess.dev/`. 38 classes + 23 properties for business process modeling. Grounded in PROV-O + P-Plan. Category: domain (opt-in). Diego explicitly: NOT Fluxy-branded — "cProcess" is its own thing.
  - **Dedup Tool (2026-04-12)**: Local embeddings via @huggingface/transformers (Xenova/all-MiniLM-L6-v2). N-way split groups (drag & drop between color-coded groups). Dismissal persistence (`onto_dedup_dismissals` table). Execute & Continue mode with auto-threshold stepping. Available thresholds computed in single pass.
  - **Review Share Story Mode (2026-04-12)**: AI-powered category grouping (5-8 business-meaningful groups), welcome screen, slideshow UX, bulk approve per category, tinder drill-down, reject-requires-reason, drag-and-drop reclassification between sections.
  - **ReviewTab Upgrades (2026-04-12)**: Per-card quick actions on hover, inline editing (name + description), base layer suggestion panel (hybrid: embeddings + Claude LLM evaluation).
  - **Hybrid Base Layer Matching**: Two-phase — embeddings at 35% threshold for candidates, then Claude evaluates semantically (same/is_a/related/no_match). Expanded Schema.org seed (+43 classes). `expandSchemaOrg()` runs on boot (INSERT OR IGNORE).
- **App Marketplace** — Full seller-side marketplace with token-based install distribution. Tables: marketplace_tokens, marketplace_orders, marketplace_settings, marketplace_error_reports, marketplace_telemetry. Tabs: Store (tier+checkout+token), Tokens (manage/revoke), Reports (errors+telemetry), Settings (opt-in toggles). Token system: UUID tokens with configurable expiry, redeem endpoint for buyers. Opt-in features: error tracking, usage telemetry, external API forwarding. `appTelemetry.ts` SDK for apps to report errors/events back — silent no-ops when not opted in.
- **Schedules App** (2026-04-08) — workspace scheduler dashboard at `/schedules`. 4 tabs: Crons (CRUD on CRONS.json with CronFormDialog + human-readable preview), Run History (all cron runs, expandable stdout/stderr), Processes (ps aux filtered for claude/fluxy + active worktrees listing), Backend Log (auto-refresh). New `cron_runs` DB table. Backend: `backend/apps/schedules/index.ts`. `Clock` icon, violet color, workspace section.
- **Musicologia** (2026-04-08, 7 phases) — full music library + social app. Diego's personal music platform with Spotify integration, lore generation, immersive player, community, admin, and scrobbling.
  - **Phase 1 (Foundation)** — 13-table SQLite schema: tracks, track_dna, track_sections, track_lyrics, track_lore, playlists, playlist_tracks, music_interactions, music_suggestions, music_images, music_follows, music_comments, music_activity_feed. CRUD backend + gallery grid + track detail page. `Music` icon, purple, main section, `/musicologia`.
  - **Phase 2 (Spotify Import)** — Spotify OAuth (Diego-only), track import from saved/playlists, DNA extraction from audio features.
  - **Phase 3 (Lore Generation)** — AI-generated narrative lore per track using OpenAI. Admin batch lore gen with SSE streaming.
  - **Phase 4 (Immersive Player)** — 885-line GSAP + Three.js immersive player at `/musicologia/tracks/:artist/:track`. Full LRC lyric sync, particle effects, visual themes. GSAP + Three.js added to deps.
  - **Phase 5 (Community)** — Follow graph, activity feed, reactions (6 emoji types), nested comments. Tables: follows, activity_feed, reactions, comments. Feed page at `/musicologia/feed`.
  - **Phase 6 (Admin + Migration)** — MongoDB → SQLite migration script (`backend/apps/musicologia/migrate.ts`). Full tabbed admin: stats, batch lore gen SSE, playlist import, sync audio features, LRC lyrics editor, audit log. `musicologia_audit` table.
  - **Phase 7 (Scrobbler + Staging Area)** — `musicologia_plays` + `musicologia_staging` tables. `POST /api/musicologia/scrobble/tick` polls Spotify currently-playing, scrobbles at 50%/4min threshold. Staging CRUD (import/dismiss/restore). `spotify-scrobbler` CRON (every minute). `ListeningTab.tsx` with Queue + History sub-tabs. Library/Listening tab switcher in main page.
  - **Known issue**: Admin routes need auth gating; OPENAI_API_KEY must be in .env for lore gen.

## Agent Dispatch — Known Limitations
- Git worktrees inside `.claude/worktrees/` are gitignored — `git add` from within them fails (commits must come from outside or use `--work-tree` flags)
- oneShot CRONs can fire multiple times if the scheduler re-evaluates before the entry is removed — agents should detect prior completion and no-op

## SFBG Project (2026-04-11)
- South Florida Business Group — tax prep & accounting firm serving small businesses/solopreneurs
- Owner: Mayelin Alberto. Diego (Sergio) building automation suite for her
- Pain points: email overload, manual data entry (Xero + TaxAct), no centralized task tracking, subscription billing
- Ontologica extraction done (project #3): initially 39 nodes, 46 edges — tax workflow, CRM, services, documents
- Pipeline job #14 enriched project #3 with Deep Research market report: now 59 nodes + 49 edges (agentic AI agents, OBBBA tax deductions, software platforms, Hispanic-owned business market, subscription billing models)
- Pipeline job #17 enriched with 3 more docs (meeting summary, Spanish call transcript, market report): +31 nodes, +31 edges — full tax prep workflow from intake to e-sign delivery
- Deep research topic #5 created: "Small Business Tax & Accounting Automation" (weekly revisit)
- Goal: anticipate SFBG needs and build apps to streamline their operations

## Deep Research — Commercial Potential (2026-04-11)
- Diego is actively using Deep Research for his consulting engagements and sees it as a high-value shippable product
- Clients are interested — there are legs under this. Will likely want to package it as a standalone workload customers can run themselves
- Key differentiators: inline citations with superscript source links, company branding on all exports (PDF/MD/Web Share), ongoing research with delta+master synthesis
- When the time comes, this is a strong candidate for the app marketplace / `.fluxy-app` packaging system

## Diego's Preferences
- Polished, consistent UI — catches cursor-pointer misses, animation glitches, sloppy patterns
- Prefers shadcn/ui components over custom markup
- Additive philosophy: new features never break existing ones
- Security-conscious (GitHub OAuth was an explicit priority)
- Prefers Claude over OpenAI — has MAX subscription, Sonnet/Opus 4.6 are better at reasoning. No extra cost.
- Non-technical user UX: "individual" → "example", "class" → "category" in all user-facing labels. Raw ontology jargon = eyes glaze over.
- Story-first review UX for business owners — "641 Extracted Items with badges like 'class' and '90% confidence' = eyes glaze over in 3 seconds"
