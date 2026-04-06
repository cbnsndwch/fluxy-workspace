# React Router v7 Framework Mode — Evaluation & Recommendation

**Date:** 2026-04-06
**Issue:** #44
**Status:** Research complete — recommendation: **stay on library mode**

---

## Executive Summary

The workspace frontend is already on React Router v7 (`^7.13.2`) using **library mode** (Data Router, `createBrowserRouter`). Migrating to **framework mode** (`@react-router/dev`, file-based routing, `clientLoader`) is **not recommended at this time**. The gains are real but marginal for a pure SPA with a separate Express backend, and there are active friction points — most notably a Vite 7→8 upgrade lock and an SSR-safety audit required for `@xyflow/react` — that raise the cost-to-benefit ratio above what's justified.

---

## What Framework Mode Actually Gives in SPA Mode

Framework mode (`ssr: false`) is essentially Remix v3 applied to pure SPAs. The `react-router.config.ts` is minimal:

```ts
// react-router.config.ts
import { type Config } from "@react-router/dev/config";
export default { ssr: false } satisfies Config;
```

The `reactRouter()` Vite plugin replaces `@vitejs/plugin-react` entirely (they cannot coexist — conflict in `RefreshRuntime`). It:

- Manages route manifest and per-route code splitting automatically
- Runs `react-router typegen` in watch mode → generates `.react-router/types/` with typed `Route.*` interfaces
- Performs a **build-time root route render in Node.js** even with `ssr: false` — this produces `index.html` and is the most surprising aspect of SPA framework mode
- Replaces `index.html` + `main.tsx` with `root.tsx` as the HTML shell

**Critical SPA gotcha:** Even with `ssr: false`, the root route is server-rendered at build time. All modules imported at root scope must be SSR-safe (no `window`, `document`, or canvas API access). `@xyflow/react` touches the DOM at import time and **will break the build if imported from root-level code**.

---

## `clientLoader` vs `loader` in SPA Mode

In SPA mode:
- `loader` on non-root routes → **not permitted** (no server to run it)
- `clientLoader` → runs in the browser at navigation time, before the route component mounts

A `clientLoader` that calls `fetch('/app/api/...')` is functionally identical to the same fetch inside `useEffect` — the URL resolves against the browser origin, the supervisor proxy strips `/app`, the Express backend receives `/api/...` unchanged. **No behavioral difference for our backend proxy model.**

The practical gain over current component-level fetching is timing (data is ready before mount) and structured error boundaries — essentially what React Query already provides. If a route uses React Query/TanStack Query today, `clientLoader` adds little.

---

## Migration Complexity — 25 Routes

Framework mode routing defaults to a **config file** (`routes.ts` with `route()`, `layout()`, `prefix()` helpers) — not auto-file-based routing. File-based routing requires the optional `@react-router/fs-routes` package and is not mandatory.

**Files to create:** `react-router.config.ts`, `src/root.tsx`, `src/routes.ts`, `src/entry.client.tsx`
**Files to delete:** `index.html`, `src/main.tsx`
**Per-route work (×25):** Each route becomes a separate module with `clientLoader` + default export component + typed `Route.ComponentProps`. The co-located `loader` in `router.tsx` moves into the route file.

**What breaks:**
- Any root-scope import of `@xyflow/react` or similar DOM-touching libs → build failure
- All non-root `loader` functions → must rename to `clientLoader`
- Context providers in `main.tsx` → must move into `root.tsx`
- Nested layouts → must become explicit `layout()` entries in `routes.ts`

**What survives untouched:** All `fetch('/app/api/...')` calls, shadcn/ui components, TailwindCSS classes, React Query usage, Zustand stores.

**Realistic effort:** 1–2 days of careful migration + debugging SSR-safe issues.

---

## Typed Routes (Typegen)

The strongest argument for framework mode. The `reactRouter()` plugin generates `.react-router/types/+types/<route>.d.ts` per route, exporting a `Route` namespace:

```ts
// auto-generated, co-located via rootDirs trick in tsconfig.json
export namespace Route {
  interface ClientLoaderArgs { params: { id: string }; request: Request; }
  interface ComponentProps { loaderData: Awaited<ReturnType<typeof clientLoader>>; }
}
```

Route params are fully typed from the route path definition. No manual `useParams()` casting.

**For our setup:** Moderate value. We have dynamic params across several routes (`:id`, `:tableName`, `:sessionId`, `:worldId`, `:viewMode`, `:token`). Native typegen would clean up param handling. However, this can be approximated in library mode today via `react-router-typesafe-routes` if it becomes a pain point.

---

## Compatibility — Vite 7, Tailwind v4, `@xyflow/react`, shadcn/ui

| Concern | Status |
|---|---|
| `@react-router/dev` + Vite 7 | ✅ Works — peer dep updated to include `^7` |
| `@react-router/dev` + Vite 8 | ⚠️ **Not yet supported** — peer dep range stops at Vite 7 |
| `@tailwindcss/vite` v4 + framework mode | ✅ Works — place `tailwindcss()` before `reactRouter()` in plugins array |
| `@xyflow/react` | ⚠️ Must be leaf-route-only; cannot be imported from `root.tsx` or global scope |
| shadcn/ui | ✅ Official framework mode install guide exists, no known issues |
| `@vitejs/plugin-react` | ❌ Must be removed — conflicts with `reactRouter()` |

---

## Ecosystem Maturity (April 2026)

Framework mode is production-stable. It's architecturally Remix v3, merged into React Router in v7.0.0 (November 2024). Active release cadence continues through the v7.x series.

Current workspace is on `react-router ^7.13.2`. The latest is in the `7.13–7.14` range. No breaking changes between library mode and framework mode are pending in v7.

Known production gotchas with `ssr: false`:
1. `@react-router/node` required in prod even for pure SPAs
2. Build-time root render surprises SSR-unsafe dependencies (see `@xyflow/react` note above)
3. Dev server loads all 25 routes eagerly via `virtual:react-router/server-build` (fine at 25 routes; scaling concern past ~300)

---

## Recommendation: Stay on Library Mode

**Verdict: Do not migrate at this time.**

### Reasons

1. **Library mode is a first-class citizen.** It is not deprecated, not discouraged, and explicitly recommended by the RR7 docs for teams "happy with the v6.4 data router." We are happy.

2. **The Vite 8 constraint is the deciding factor.** We're on Vite 7 now. Migrating to framework mode pins us to Vite 7 until `@react-router/dev` adds Vite 8 peer dep support. Given that Vite upgrades often bring meaningful perf wins (Rolldown/oxc integration in Vite 6+), this is a real cost.

3. **`@xyflow/react` SSR-safety audit is non-trivial.** The build-time root render in `ssr: false` framework mode is the most-reported surprise in community issues. We use Xyflow in multiple apps. Auditing and isolating all xyflow imports from the root path adds meaningful risk to the migration.

4. **Primary gains are available without migration.**
   - Code splitting → achievable now with `route.lazy()` (granular lazy, v7.5+)
   - Typed params → approximated with `react-router-typesafe-routes` if needed
   - Structured loading states → React Query handles this

5. **The backend proxy model doesn't benefit.** Framework mode's biggest advantages are SSR and full-stack data colocation. Our backend is a separate Express API — we never get server-side `loader` execution. The `clientLoader` pattern is equivalent to what we do today.

### When to Reconsider

| Trigger | Action |
|---|---|
| `@react-router/dev` adds Vite 8 support | Re-evaluate — removes the toolchain lock |
| Team hits pain with untyped route params | Migrate specific dynamic routes first, or try `react-router-typesafe-routes` |
| Pre-rendering needed for SEO without a separate SSR server | Framework mode `prerender` is the cleanest path |
| All React Query fetching replaced by `clientLoader`/`useFetcher` | Migration becomes worthwhile for end-to-end type safety |

---

## References

- [React Router: Picking a Mode](https://reactrouter.com/start/modes)
- [React Router: Single Page App (SPA)](https://reactrouter.com/how-to/spa)
- [React Router: Framework Adoption from RouterProvider](https://reactrouter.com/upgrading/router-provider)
- [React Router: Type Safety](https://reactrouter.com/explanation/type-safety)
- [React Router: Automatic Code Splitting](https://reactrouter.com/explanation/code-splitting)
- [Tailwind CSS: Install with React Router](https://tailwindcss.com/docs/installation/framework-guides/react-router)
- [shadcn/ui: React Router installation](https://ui.shadcn.com/docs/installation/react-router)
- [GitHub: #12870 — @react-router/dev + @vitejs/plugin-react conflict](https://github.com/remix-run/react-router/issues/12870)
- [GitHub: #13228 — window is not defined with ssr: false](https://github.com/remix-run/react-router/issues/13228)
- [GitHub: discussion #14869 — Vite 8 support for @react-router/dev](https://github.com/remix-run/react-router/discussions/14869)
