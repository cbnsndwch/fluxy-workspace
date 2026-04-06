---
name: do-commits
description: Commit uncommitted changes in thematic groups with short messages that follow the repo's semantic conventions. Use this skill when the user asks to commit, "do commits", "group commits", or "commit these changes".
---

Great! Now let's commit these changes in thematic groups with short messages that follow the repo's semantic conventions.

## Commit Message Convention

Use the format: `type(scope): message`

**Types:**

- `feat`: New feature, component, or app
- `fix`: Bug fix
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `build`: Changes to build system or dependencies (package.json, tsconfig, vite.config, etc.)
- `chore`: Maintenance tasks (lockfile updates, etc.)
- `docs`: Documentation changes (Docs app content, README, inline comments)
- `test`: Adding or updating tests
- `perf`: Performance improvements
- `style`: Code style changes (formatting, semicolons, etc.)
- `research`: Research findings, design proposals, architectural evaluations

**Scope Examples:**

Apps/Features:
- `issues` — Workspace Issues / Improvements app
- `docs` — Docs app
- `analytics` — Analytics app
- `flow-capture` — Flow Capture app
- `deep-research` — Deep Research app
- `marble` — Marble Studio app
- `app-ideas` — App Ideas Canvas
- `db-viewer` — DB Viewer app
- `workflow` — Workflow Engine app

Infrastructure/Cross-cutting:
- `auth` — Authentication (GitHub OAuth, sessions)
- `backend` — Express backend, routes, middleware
- `db` — Database schema, migrations, SQLite
- `routing` — React Router, navigation, deep links
- `layout` — AppLayout, Sidebar, shared UI structure
- `extensions` — Workspace Extensions / injected header actions
- `skills` — Agent skills
- `deps` — Dependencies

**Message Guidelines:**

- Use imperative mood ("add" not "added", "migrate" not "migrated")
- Keep under 72 characters
- Be specific but concise
- No period at the end

**Grouping Strategy:**

1. **Feature additions** — New components, pages, apps, routes created
2. **Refactors/Updates** — Restructured code, extracted components, updated logic
3. **Backend changes** — New API routes, DB schema changes, middleware
4. **Build/config changes** — package.json, tsconfig, vite config
5. **Lockfile** — Always a separate commit for `package-lock.json`
6. **Documentation** — Docs app content, README, markdown files

**Examples:**

```
feat(issues): add dispatch-to-agent action from report issue toast
fix(routing): deep-link issue modal via /issues/:issueId sub-route
refactor(layout): extract IssueModal into standalone module
build(deps): add sonner for toast notifications
chore(deps): update package lockfile
docs(#43): add PostgreSQL migration recommendation
```

## Steps

1. Run `git status` and `git diff` to understand all uncommitted changes
2. Group changes by theme using the strategy above
3. Stage and commit each group in order — features first, lockfile last
4. After all commits, run `git log --oneline -10` to confirm the result looks clean
