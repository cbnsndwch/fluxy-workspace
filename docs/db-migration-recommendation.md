# Database Migration Recommendation
## Issue #43 — Migrate workspace from SQLite to a database server

**Author:** Sebastian (Fluxy Agent)
**Date:** 2026-04-06
**Status:** Proposal — awaiting approval before implementation

---

## 1. Current State Audit

### What we have

| Item | Detail |
|------|--------|
| Driver | `better-sqlite3` v12 (synchronous API) |
| Schema location | `backend/db.ts` — all tables defined inline |
| Total tables | 23 across main db + app routers |
| `db.prepare()` call sites | ~190 spread across 11 app routers |
| Separate DB | `analytics.duckdb` (DuckDB, already decoupled — **no change needed**) |
| Pattern | Fully synchronous: `db.prepare(SQL).all()`, `.get(id)`, `.run(...)` |

### Tables inventory

**`backend/db.ts` (18 tables):**
`users`, `sessions`, `app_ideas`, `app_idea_connections`, `workspace_issues`, `dispatch_batches`, `image_generations`, `workflows`, `workflow_runs`, `workflow_run_nodes`, `roles`, `role_permissions`, `user_roles`, `research_topics`, `research_sessions`, `research_findings`, `research_reports`, `marble_worlds`

**App-router owned (5 tables):**
`flow_sessions`, `flow_chunks`, `flow_diagrams` (flow-capture router), `marble_studio_settings` (marble-studio router)

### Key constraint
The entire query layer is **synchronous**. Migrating to any network-connected DB requires making all ~190 call sites `async`/`await`. This is the primary migration cost.

---

## 2. Candidate Database Evaluation

| Database | Self-hosted | Managed | Zero-setup dev | Node driver | SQLite compat | Verdict |
|----------|-------------|---------|----------------|-------------|---------------|---------|
| **PostgreSQL** | ✅ Docker | ✅ Neon, Supabase | ✅ Neon free tier | `pg`, `postgres` | ❌ | **Winner** |
| MySQL/MariaDB | ✅ Docker | ✅ PlanetScale | ❌ local required | `mysql2` | ❌ | Skip — no benefit over PG |
| Turso (LibSQL) | ⚠️ self-host complex | ✅ Managed only | ✅ managed URL | `@libsql/client` | ✅ SQLite wire compat | Viable; SQLite compat helps but vendor lock-in concern |
| Neon | ❌ managed only | ✅ serverless Postgres | ✅ free tier | `@neondatabase/serverless` | ❌ | Best managed option (PG-compatible) |

**Recommendation: PostgreSQL**, with **Neon** as the zero-setup dev/cloud option and Docker Compose for self-hosted installs.

**Why not Turso:**
Despite SQLite wire compatibility reducing dialect friction, Turso is managed-only (no simple self-host), has free-tier row limits, and the `@libsql/client` driver is still async — so the sync→async migration cost is the same as Postgres.

---

## 3. Query Layer Evaluation

| Option | SQLite support | PG support | API style | Migration friction | TypeScript | Verdict |
|--------|---------------|------------|-----------|-------------------|------------|---------|
| **Drizzle ORM** | ✅ | ✅ | Schema-as-code + raw SQL | Medium | ✅ First-class | **Winner** |
| Prisma | ✅ | ✅ | Schema file + generated client | High — full rewrite | ✅ Generated | Skip — daemon overhead, schema DSL is foreign |
| Knex | ✅ | ✅ | Query builder | Medium | ⚠️ Types mediocre | Viable but adds little over raw SQL |
| Raw `pg` / `mysql2` | — | ✅ | Raw SQL async | Medium | ✅ Manual | Viable; low abstraction but verbose |

**Recommendation: Drizzle ORM**

Reasons:
- Supports both `drizzle-orm/better-sqlite3` (SQLite, sync) and `drizzle-orm/postgres-js` (PG, async) from one schema
- TypeScript schema definitions in `backend/db/schema.ts` replace all the inline `CREATE TABLE IF NOT EXISTS` blocks
- Drizzle Kit generates versioned SQL migration files — no runtime schema drift
- Raw SQL still available via the `sql` template tag for complex queries
- No daemon, no separate codegen step on every change
- The transition from `db.prepare('SELECT * FROM x WHERE id = ?').get(id)` to `await db.select().from(schema.x).where(eq(schema.x.id, id))` is systematic and mechanical

---

## 4. Backward Compatibility Plan

Use an environment variable to select the database:

```
# .env
# Leave unset → SQLite (app.db) — current behavior
# Set this → PostgreSQL
DATABASE_URL=postgres://user:pass@host/dbname
```

`backend/db.ts` becomes a factory:

```typescript
// Pseudocode
if (process.env.DATABASE_URL) {
  // drizzle(postgres(process.env.DATABASE_URL))
} else {
  // drizzle(new Database('./app.db'))
}
```

This means:
- **Local installs with no config change** continue working exactly as today
- **Any install with `DATABASE_URL`** uses PostgreSQL
- No breaking change for Diego's current setup

---

## 5. Migration Strategy

### Phase 1 — Schema consolidation (non-breaking)

**Goal:** Move all `CREATE TABLE` DDL into Drizzle schema files. No behavioral change.

Files touched:
- `backend/db/schema.ts` — new file, all 23 tables defined as Drizzle schema objects
- `backend/db.ts` — rewritten to instantiate Drizzle based on `DATABASE_URL`
- `drizzle.config.ts` — Drizzle Kit config (SQLite and PG targets)
- `backend/apps/flow-capture/index.ts` — remove inline `db.exec(CREATE TABLE...)`, handled by schema
- `backend/apps/marble-studio/index.ts` — same

### Phase 2 — Query migration (the bulk of the work)

Replace all synchronous `db.prepare().all()/.get()/.run()` with async Drizzle queries.

This requires adding `async` to every Express route handler that touches the DB. Approximate scope:

| File | `db.prepare` calls | Estimated effort |
|------|------------------|-----------------|
| `apps/research/index.ts` | 37 | ~2h |
| `apps/workflows/index.ts` | 23 | ~1.5h |
| `apps/issues/index.ts` | 23 | ~1.5h |
| `apps/marble-studio/index.ts` | 26 | ~1.5h |
| `apps/users/index.ts` | 22 | ~1h |
| `apps/flow-capture/index.ts` | 21 | ~1h |
| `apps/db-viewer/index.ts` | 15 | ~1h (see note) |
| `apps/app-ideas/index.ts` | 11 | ~0.5h |
| `auth/index.ts` | ~10 | ~0.5h |
| `apps/image-gen/index.ts` | 5 | ~0.25h |
| **Total** | **~190** | **~11h** |

### Phase 3 — DB Viewer adaptation

The DB Viewer currently uses SQLite-specific introspection:
- `SELECT name FROM sqlite_master` → `SELECT table_name FROM information_schema.tables`
- `PRAGMA table_info(x)` → `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`

This needs to be dialect-aware. Simplest approach: detect driver type and call the appropriate introspection query.

### Phase 4 — Data migration tooling

Write a one-time script `scripts/migrate-sqlite-to-pg.ts`:
1. Read all rows from each table in `app.db`
2. Transform types (TEXT → proper PG types, INTEGER → BIGINT/SERIAL)
3. INSERT batches into PostgreSQL
4. Reset sequences to `MAX(id) + 1`

For new installs, Drizzle Kit handles schema creation via `drizzle-kit migrate`.

### Phase 5 — Developer setup documentation

Two paths:
- **Cloud path (zero local install):** Sign up for [Neon](https://neon.tech) free tier → paste connection string into `.env`
- **Self-hosted path:** `docker-compose up -d postgres` with a provided `docker-compose.yml`

---

## 6. Packages to Add/Remove

```bash
# Add
npm install drizzle-orm postgres pg
npm install -D drizzle-kit @types/pg

# Keep (SQLite fallback)
# better-sqlite3 stays — used when DATABASE_URL is not set

# No change
# @duckdb/node-api stays — analytics is already decoupled
```

---

## 7. File-Level Change Summary

| File | Change |
|------|--------|
| `backend/db.ts` | Complete rewrite — factory pattern, conditional SQLite/PG |
| `backend/db/schema.ts` | **New** — Drizzle schema for all 23 tables |
| `backend/db/migrate.ts` | **New** — run Drizzle migrations at boot |
| `drizzle.config.ts` | **New** — Drizzle Kit config |
| `docker-compose.yml` | **New** — local Postgres for self-hosted dev |
| `scripts/migrate-sqlite-to-pg.ts` | **New** — one-time data migration utility |
| `backend/index.ts` | Import `runMigrations` from `db/migrate.ts` at startup |
| `backend/apps/*/index.ts` | All route handlers → `async`, queries → Drizzle |
| `backend/auth/index.ts` | Same |
| `backend/apps/db-viewer/index.ts` | SQLite introspection → `information_schema` compat |
| `.env.example` | Add `DATABASE_URL` (commented out) |

---

## 8. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| SQLite-specific syntax in existing queries (e.g. `datetime('now')`) | Medium | Drizzle schema handles defaults; Drizzle Kit generates dialect-appropriate SQL |
| `ALTER TABLE ... ADD COLUMN` try/catch hack for migrations | Low | Eliminated — Drizzle Kit migrations are versioned and idempotent |
| DB Viewer breaking with PostgreSQL | Medium | Phase 3 addresses with dialect detection |
| Missing `async`/`await` in a route handler after migration | Medium | TypeScript will error on `.all()/.get()` if the Drizzle adapter doesn't have those methods |
| Data loss during SQLite→PG migration | High | Migration script is a copy, not a move; keep `app.db` as backup |
| Connection pool exhaustion (serverless environments) | Low | `postgres` driver uses a default pool; configure `max` via `DATABASE_URL` params |

---

## 9. Recommendation Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database engine | **PostgreSQL** | Most mature, self-hostable, best managed options (Neon) |
| Dev setup (cloud) | **Neon free tier** | Zero local install, instant connection string |
| Dev setup (local) | **Docker Compose** | Full data sovereignty, no internet required |
| Query layer | **Drizzle ORM** | SQLite+PG dialect, TypeScript-first, low abstraction overhead |
| Backward compat | **`DATABASE_URL` env var gate** | Zero breaking change for existing installs |
| Analytics | **No change** | DuckDB is already decoupled and appropriate for analytics workloads |
| Migration tooling | **Drizzle Kit + custom script** | Drizzle Kit for schema, custom script for data |

**Estimated total implementation time: ~15–20 hours** (schema definition + query migration + testing).

**Suggested implementation order:**
1. Schema consolidation (Phase 1) — safe, non-breaking, high value
2. Add `DATABASE_URL` gate to `db.ts` (Phase 1 completion)
3. Migrate queries one app at a time (Phase 2) — can be done incrementally
4. DB Viewer compat (Phase 3) — defer until PG is the primary target
5. Data migration script (Phase 4) — needed only when switching an existing install

---

*This document is a research and planning artifact. No code changes were made as part of this issue. Implementation requires a separate approved issue/task.*
