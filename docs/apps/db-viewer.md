# DB Viewer

A Drizzle Studio-inspired interface for browsing and managing the workspace SQLite database.

## What you can do

- **Browse tables** — see all tables, their columns, and row counts
- **View data** — paginated grid with column types shown in headers
- **Add rows** — fill in a form with all columns
- **Edit rows** — click any row to open the edit modal
- **Delete rows** — with confirmation prompt

## Tables in app.db

| Table | Purpose |
|---|---|
| `app_ideas` | App Ideas canvas cards |
| `app_idea_connections` | Edges between cards |
| `workspace_issues` | Workspace Improvements issues |
| `marble_worlds` | Marble Studio generated worlds |
| `marble_studio_settings` | Marble Studio API key (encrypted) |
| `research_topics` | Deep Research topics |
| `research_sessions` | Deep Research sessions |
| `research_findings` | Deep Research individual findings |
| `research_reports` | Deep Research generated reports |
| `flow_sessions` | Flow Capture sessions |
| `flow_chunks` | Flow Capture transcript segments |
| `flow_diagrams` | Flow Capture generated diagrams |
| `analytics_events` | Analytics event log |
| `workflows` | Workflow Engine definitions |
| `workflow_runs` | Workflow execution history |
| `users` | GitHub OAuth users |
| `sessions` | Auth sessions |

## Warnings

- Edits here are **direct database writes** — no validation, no undo
- Deleting rows with foreign key references may fail (FK constraints are enforced)
- `id`, `created_at`, `updated_at` columns are auto-managed — avoid editing them
