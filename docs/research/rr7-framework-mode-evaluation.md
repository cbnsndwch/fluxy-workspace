# React Router v7 Framework Mode — Evaluation & Recommendation

> Research completed: 2026-04-06
> Issue: #44 | Priority: medium | Scope: all apps

---

## TL;DR — **Stay on RR7 Data Mode**

The workspace is already running React Router v7 in data mode (`createBrowserRouter`, loaders, actions). Adopting framework mode carries high migration cost, documented dev-server performance regressions, and real compatibility risk with the non-standard Vite setup — for benefits that are either marginal in this codebase or achievable without the switch.

---

## Current State

| Item | Detail |
|---|---|
| React Router version | `react-router@^7.13.2` (already RR7) |
| Mode | **Data mode** — `createBrowserRouter` in `client/src/router.tsx` |
| Routes | ~25 routes with loaders already co-located in component files |
| Vite version | `vite@^7.2.0` |
| Vite plugin | `@vitejs/plugin-react` |
| Vite root | Non-standard: `client/` directory, not `.` |
| Other Vite plugins | TailwindCSS v4 (`@tailwindcss/vite`), PWA (`vite-plugin-pwa`) |
| React version | React 19 |

**This is not a v6 → v7 migration question.** We're already on v7. The question is v7 data mode → v7 framework mode.

---

## What Framework Mode Actually Provides

React Router v7 has three distinct modes:

1. **Declarative mode** — `<BrowserRouter>` + `<Routes>`. Basic. We don't use this.
2. **Data mode** — `createBrowserRouter` + loaders/actions. **We are here.**
3. **Framework mode** — wraps data mode with the `@react-router/dev` Vite plugin, adding: file-based routing (`routes.ts`), generated types, automatic code splitting, and `HydratedRouter` entry point.

### What framework mode adds (vs our current data mode)

| Feature | Data Mode (current) | Framework Mode |
|---|---|---|
| File-based routing | ❌ manual `router.tsx` | ✅ `routes.ts` conventions |
| Generated TypeScript types | ❌ manual | ✅ auto-generated `+types/*.ts` |
| Route-level code splitting | ❌ single bundle | ✅ automatic per-route lazy chunks |
| `clientLoader` / `clientAction` | ✅ same as `loader`/`action` in SPA mode | ✅ explicit SPA-only variants |
| SSR / pre-rendering option | ❌ | ✅ opt-in with `ssr: true` in config |
| `react-router dev` CLI | ❌ | ✅ replaces `vite dev` |

### `clientLoader` in SPA mode

In SPA mode (`ssr: false`), `clientLoader` and `loader` are functionally identical — both run only in the browser. The naming convention exists to be explicit about intent, but there is no behavioral difference for our use case. Our existing `fetch('/app/api/...')` calls would work unchanged — they're just async functions.

```ts
// Current (data mode) — works fine in framework mode SPA too
export async function loader({ params }) {
  const res = await fetch(`/app/api/issues/${params.id}`);
  return res.json();
}

// Framework mode explicit SPA variant — same thing
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const res = await fetch(`/app/api/issues/${params.id}`);
  return res.json();
}
```

### `react-router.config.ts` for pure SPA

```ts
import { defineConfig } from "@react-router/dev/config";
export default defineConfig({
  ssr: false,  // Pure SPA — no server rendering
});
```

---

## Migration Complexity

### What changes (25-route router)

1. **Delete `client/src/router.tsx`** — replaced by `routes.ts`
2. **Rewrite `client/index.html`** → move `<head>` markup to `src/root.tsx`, add `<Links />`, `<Meta />`, `<Scripts />`, `<ScrollRestoration />`
3. **Rewrite `client/src/main.tsx`**: `createRoot` → `hydrateRoot`, `<RouterProvider>` → `<HydratedRouter />`
4. **Create `routes.ts`** with route tree referencing file paths instead of imports
5. **Move each page component** into a `routes/` directory following naming conventions
6. **Replace `@vitejs/plugin-react`** with `reactRouter()` from `@react-router/dev/vite` in `vite.config.ts`
7. **Replace `react-router-dom` imports** with the route module API in every loader/component file
8. **Add `@react-router/dev`** package
9. **Remove the `react-router` direct import** of `createBrowserRouter`, `RouterProvider`

Effort estimate: **1–2 days of careful migration** for 25 routes, given the existing loaders are already co-located. But it's non-trivial due to the structural changes to `main.tsx`, `index.html`, and the root component.

---

## Compatibility Assessment

### Vite 7 + `@react-router/dev`

This is the **biggest unknown.** `@react-router/dev` is primarily tested against Vite 5 and 6. Vite 7 introduced breaking changes in its plugin API. As of April 2026, there are open discussions about performance issues with `@react-router/dev` even in Vite 5/6:

- [Dev server performance issues with react-router@7.5.0](https://github.com/remix-run/react-router/discussions/13463): Eager loading of all routes in framework mode can make HMR 5–10 seconds in larger projects.
- [React Router 7 dev environment unacceptably slow in big projects](https://github.com/remix-run/react-router/issues/12806): 30–40 second page render times reported.
- [HMR breaks with library mode createBrowserRouter](https://github.com/remix-run/react-router/issues/13159): Regression introduced in 7.1.3 (later fixed).
- `@react-router/dev` uses **Babel** for compilation — slower than Vite 7's esbuild-first pipeline.

Our workspace has a **non-standard Vite root** (`root: 'client/'` in `vite.config.ts`). Framework mode takes ownership of the Vite config in more invasive ways. TailwindCSS v4's Vite plugin and the PWA plugin would need to coexist with `reactRouter()` — untested combination.

### Supervisor proxy model

The `/app/api/` prefix stripping done by the supervisor is transparent to the frontend — `fetch('/app/api/...')` calls are unchanged in either mode. No compatibility issue here.

### shadcn/ui + `@xyflow/react`

These are pure React component libraries. They have no dependency on the routing mode. No issues expected.

### React 19

Framework mode is compatible with React 19. No known blockers.

---

## Tradeoffs Summary

### Gains from framework mode

- **Generated route types** — `Route.LoaderArgs`, `Route.ComponentProps` etc. eliminate manual `useLoaderData<typeof loader>()` casting. This is genuinely nice.
- **Automatic code splitting** — currently all routes are in a single bundle. Framework mode would split per route, improving initial load time.
- **`routes.ts` as single source of truth** — replaces `router.tsx` with a more structured convention.
- **Future SSR option** — flip `ssr: true` to add server rendering later.

### Losses / Risks

- **Vite 7 compatibility uncertainty** — untested combination; likely to hit edge cases.
- **Known dev perf regressions** — 5–10s HMR delays reported in framework mode projects.
- **Babel slowdown** — `@react-router/dev` injects Babel; Vite 7 is optimized around esbuild.
- **Non-standard Vite setup** — custom root, PWA plugin, TailwindCSS v4 plugin all need to coexist with `reactRouter()`. Documented as friction.
- **Structural overhaul** — `index.html`, `main.tsx`, and root component must all change. 1–2 day migration scope.
- **No functional gain for data fetching** — we already use loaders correctly. `clientLoader` in SPA mode is syntactic sugar.
- **Convention overhead** — file-naming conventions (`routes/home.tsx`, `routes/issues.tsx`) require reorganizing 25 modules.

---

## Recommendation

**Verdict: Stay on RR7 data mode. Do not migrate to framework mode.**

### Rationale

1. **Already on the right version.** We're on RR7. The gains from framework mode are incremental, not categorical.

2. **Dev performance risk is real.** The reported 5–10s HMR delays and 30–40s page render times in framework mode are a serious quality-of-life regression. Given Diego's preference for a polished, snappy dev experience, this alone is disqualifying.

3. **Vite 7 + framework mode is uncharted.** `@react-router/dev` is not yet validated against Vite 7. We'd be early adopters of an untested combination, likely absorbing bugs.

4. **The code splitting gain can be deferred.** If initial bundle size becomes a real problem, route-level `lazy()` with `React.lazy()` can be added incrementally to the current data mode setup without any structural overhaul.

5. **Type safety is achievable without migration.** Explicit `useLoaderData<typeof loader>()` typing (already done in places) or a generic `inferLoader` helper gives type safety without framework mode overhead.

6. **Migration cost > benefit window.** The 1–2 day migration would touch 30+ files, restructure the project layout, and require validating all routes and loaders — risky given the workspace's active development pace.

---

## If We Revisit Later

Conditions that would change this recommendation:

- `@react-router/dev` officially supports and benchmarks well with Vite 7
- The known dev-server performance issues are resolved
- The codebase scales to the point where initial bundle size is a real user problem (currently not the case)
- Diego explicitly needs SSR or static pre-rendering for some routes

At that point, the migration plan would be:
1. `npm install @react-router/dev`
2. Replace `@vitejs/plugin-react` with `reactRouter()` in `vite.config.ts`
3. Add `react-router.config.ts` with `ssr: false`
4. Create `src/root.tsx` from current `App.tsx` shell
5. Rewrite `main.tsx` to use `hydrateRoot` + `HydratedRouter`
6. Create `routes.ts` referencing existing component files
7. Move loaders to use `clientLoader` naming (optional in SPA mode)
8. Delete `router.tsx`, update all named imports
9. Test all 25 routes, loaders, auth flow, and PWA behaviour

---

## Sources

- [React Router — Picking a Mode](https://reactrouter.com/start/modes)
- [Framework Adoption from RouterProvider](https://reactrouter.com/upgrading/router-provider)
- [Library mode vs Framework mode discussion](https://github.com/remix-run/react-router/discussions/12423)
- [Dev server performance issues #13463](https://github.com/remix-run/react-router/discussions/13463)
- [Dev environment unacceptably slow #12806](https://github.com/remix-run/react-router/issues/12806)
- [HMR regression #13159](https://github.com/remix-run/react-router/issues/13159)
- [What's New in React Router 7 — Syncfusion](https://www.syncfusion.com/blogs/post/whats-new-react-router-7)
