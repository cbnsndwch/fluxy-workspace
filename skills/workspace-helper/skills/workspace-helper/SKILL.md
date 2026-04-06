---
name: workspace-helper
description: Helps manage and understand the Fluxy workspace structure. Use this skill whenever the user asks about the project layout, file organization, where things are, how the workspace is structured, or needs help navigating the codebase. Also use when the user asks to scaffold new components, pages, or API routes.
---

# Workspace Helper

## Overview

This skill helps navigate and manage the Fluxy workspace — a full-stack app with a React + Vite + Tailwind frontend and an Express backend.

## Workspace Structure

```
workspace/
  client/                 React + Vite + Tailwind frontend
    index.html            HTML shell, PWA manifest
    src/
      main.tsx            React DOM entry
      App.tsx             Root component with error boundary
      components/         UI components
  backend/
    index.ts              Express server (port 3004, accessed at /app/api/*)
  .env                    Environment variables for the backend
  app.db                  SQLite database for workspace data
  files/                  Uploaded file storage (audio, images, documents)
```

## Key Rules

1. The **frontend** is served by Vite with HMR — changes are picked up instantly
2. The **backend** runs on port 3004, proxied through `/app/api/*` — the `/app/api` prefix is stripped, so define routes as `/health` not `/app/api/health`
3. The backend auto-restarts when you edit files
4. You may ONLY modify files inside the `workspace/` directory
5. NEVER touch `supervisor/`, `worker/`, `shared/`, or `bin/`

## When Adding New Pages

1. Create the component in `client/src/components/`
2. Add a route in `client/src/App.tsx`
3. Use Tailwind for styling — no separate CSS files needed

## When Adding New API Routes

1. Add the route in `backend/index.ts`
2. Remember: routes are relative (e.g., `app.get('/my-route', ...)`)
3. The frontend calls them at `/app/api/my-route`
4. Use the existing `app.db` SQLite database if persistence is needed

## When Asked "Where is X?"

Read the relevant files to find the answer. Start with:

- Frontend components: `client/src/components/`
- App entry: `client/src/App.tsx`
- Backend routes: `backend/index.ts`
- Environment config: `.env`
