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
- **Docs App** — has a full release notes section (`docs/release-notes/`). 11 dated files covering full git history from 2026-02-21 to 2026-04-05 (97 commits, authors: Bruno Bertapeli, cbnsndwch/Diego/Serge). Includes index.md with overview table.

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
- All 19 workspace issues marked done as of 2026-03-23
- Issue tracker is clean — no open items

## Diego's Preferences
- Polished, consistent UI — catches cursor-pointer misses, animation glitches, sloppy patterns
- Prefers shadcn/ui components over custom markup
- Additive philosophy: new features never break existing ones
- Security-conscious (GitHub OAuth was an explicit priority)
