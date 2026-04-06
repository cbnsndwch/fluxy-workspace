# Routing

The workspace uses **React Router 7** in SPA (browser history) mode. Every page has a real URL — you can reload, bookmark, and share links without losing context.

## Route Map

| Path | Page |
|------|------|
| `/` | Dashboard |
| `/app-ideas` | App Ideas |
| `/image-studio` | Image Studio (redirects to `/image-studio/canvas`) |
| `/image-studio/:viewMode` | Image Studio — `canvas` or `gallery` |
| `/marble-studio` | Marble Studio — gallery |
| `/marble-studio/new` | Marble Studio — generation form |
| `/marble-studio/worlds/:worldId` | Marble Studio — 3D viewer |
| `/marble-studio/settings` | Marble Studio — API key settings |
| `/issues` | Workspace Improvements |
| `/db-viewer` | DB Viewer |
| `/docs/*` | Docs (wildcard — any slug maps to a doc file) |
| `/workflows` | Workflows |
| `/workflows/:id` | Workflow detail |
| `/users` | User Management |
| `/deep-research` | Deep Research |
| `/flow-capture` | Flow Capture — session list |
| `/flow-capture/:sessionId` | Flow Capture — active session |
| `/analytics` | Analytics |
| `/marketplace` | Marketplace |
| `/share/:token` | Public shared research report (unauthenticated) |
| `/login` | Login (unauthenticated) |

Any unmatched path (`*`) redirects to the Dashboard.

## How It Works

`createBrowserRouter` is called in `router.tsx` and mounted via `RouterProvider` in `main.tsx`. The layout (`RootLayout` / `DashboardLayout`) sits at the root — it's always rendered — only the page content swaps via `<Outlet>`.

```
RouterProvider (main.tsx)
└── RootLayout (App.tsx)        ← rootLoader gates auth
    └── DashboardLayout
        └── <Outlet>
            ├── / → DashboardPage
            ├── /app-ideas → AppIdeasPage
            ├── /marble-studio → MarbleStudioPage
            │   ├── (index) → MarbleStudioIndexRoute
            │   ├── /new → MarbleStudioNewRoute
            │   ├── /settings → MarbleStudioSettingsRoute
            │   └── /worlds/:worldId → MarbleStudioWorldRoute
            └── ...
```

## Navigation

**Sidebar links** use `<NavLink>` from `react-router`, which automatically applies an active class when its `to` path matches the current URL. The `end` prop is set on the Dashboard link to prevent it from matching every route.

**Programmatic navigation** (e.g. clicking an app card on the Dashboard, or navigating between sub-routes) uses the `useNavigate()` hook:

```tsx
import { useNavigate } from 'react-router';

const navigate = useNavigate();
navigate('/marble-studio/new');
```

## Adding a New Page

1. Create your page component in `client/src/components/YourApp/YourAppPage.tsx`
2. Add a route entry in `router.tsx`:
   ```tsx
   import YourAppPage from './components/YourApp/YourAppPage';
   // Inside the root children array:
   { path: 'your-app', element: <YourAppPage /> },
   ```
3. Add an entry to `client/src/lib/appRegistry.ts` — the sidebar and dashboard card auto-populate from there
4. Optionally add a Dashboard widget in `DashboardPage.tsx`

## Nested Routes

Some apps use nested routes with `<Outlet>`. The parent component renders the shared layout (sidebar, header); child routes render the content area.

```tsx
// router.tsx
{ path: 'marble-studio', element: <MarbleStudioPage />, children: [
    { index: true,              element: <MarbleStudioIndexRoute /> },
    { path: 'new',              element: <MarbleStudioNewRoute /> },
    { path: 'worlds/:worldId',  element: <MarbleStudioWorldRoute /> },
]},
```

The parent (`MarbleStudioPage`) renders `<Outlet />` where children appear.

## SPA & Reloading

Vite's dev server serves `index.html` for any path that doesn't match a static asset — so reloading `/marble-studio/worlds/42` correctly loads the app and React Router takes over. No server-side configuration is needed in development.
