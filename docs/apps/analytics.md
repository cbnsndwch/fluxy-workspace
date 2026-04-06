# Analytics

> Library: [@cbnsndwch/react-tracking](https://github.com/cbnsndwch/react-tracking) — modernized fork of nytimes/react-tracking for React 18/19
> Storage: DuckDB (OLAP columnar — not SQLite)
> Status: **Live** — pageviews tracking across all apps. Action events planned (Phase 2).

---

## How It Works

`@cbnsndwch/react-tracking` wraps the entire app via `AnalyticsProvider` in `main.tsx`. Every page mount fires a `pageview` event. Events are batched (800ms debounce) and dispatched to our own backend — **no third-party tracking, all data stays on your machine**.

```
Browser → /app/api/analytics/events → DuckDB (analytics.duckdb)
```

Each event payload:
```json
{
  "app": "crm",
  "event": "pageview",
  "page": "crm",
  "session_id": "abc123",
  "meta": {}
}
```

Session IDs are generated per browser tab (stored in `sessionStorage`) — so multiple tabs = multiple sessions.

---

## Apps with Analytics

### CRM
**Status:** Pageview tracking live. Action events planned.

| Event | Trigger | Status |
|-------|---------|--------|
| `pageview` | App opens / tab gains focus | ✅ Live |
| `contact_created` | New contact saved | 🔲 Planned |
| `contact_viewed` | Contact detail opened | 🔲 Planned |
| `deal_moved` | Deal dragged to new pipeline stage | 🔲 Planned |
| `company_created` | New company saved | 🔲 Planned |

---

### App Ideas Canvas
**Status:** Pageview tracking live. Action events planned.

| Event | Trigger | Status |
|-------|---------|--------|
| `pageview` | App opens | ✅ Live |
| `idea_created` | New idea node added | 🔲 Planned |
| `idea_stage_changed` | Idea stage updated | 🔲 Planned |
| `connection_added` | Edge drawn between ideas | 🔲 Planned |
| `canvas_zoomed` | Canvas zoom changed | 🔲 Planned |

---

### Workspace Improvements (Issues)
**Status:** Pageview tracking live. Action events planned.

| Event | Trigger | Status |
|-------|---------|--------|
| `pageview` | App opens | ✅ Live |
| `issue_created` | New issue submitted | 🔲 Planned |
| `issue_status_changed` | Issue workflow status updated | 🔲 Planned |
| `issue_viewed` | Issue detail opened | 🔲 Planned |

---

### Workflow Engine
**Status:** Pageview tracking live. Action events planned.

| Event | Trigger | Status |
|-------|---------|--------|
| `pageview` | App opens | ✅ Live |
| `workflow_run` | Workflow executed manually | 🔲 Planned |
| `workflow_saved` | Workflow saved | 🔲 Planned |
| `node_added` | Node dropped onto canvas | 🔲 Planned |
| `run_failed` | Workflow execution errors | 🔲 Planned |

---

### Deep Research
**Status:** Pageview tracking live. Action events planned.

| Event | Trigger | Status |
|-------|---------|--------|
| `pageview` | App opens | ✅ Live |
| `topic_created` | New research topic added | 🔲 Planned |
| `research_triggered` | Manual research run started | 🔲 Planned |
| `report_viewed` | Research report opened | 🔲 Planned |

---

### Image Studio
**Status:** Pageview tracking live. Action events planned.

| Event | Trigger | Status |
|-------|---------|--------|
| `pageview` | App opens | ✅ Live |
| `image_generated` | Generation request fired | 🔲 Planned |
| `image_downloaded` | Image saved to disk | 🔲 Planned |
| `gallery_opened` | Gallery view opened | 🔲 Planned |

---

### Marketplace
**Status:** Pageview tracking live. Action events planned.

| Event | Trigger | Status |
|-------|---------|--------|
| `pageview` | App opens | ✅ Live |
| `tier_selected` | Pricing tier clicked | 🔲 Planned |
| `app_toggled` | Individual app toggled in custom tier | 🔲 Planned |
| `bundle_cta_clicked` | CTA button clicked | 🔲 Planned |

---

### Docs
**Status:** Pageview tracking live. Action events planned.

| Event | Trigger | Status |
|-------|---------|--------|
| `pageview` | App opens | ✅ Live |
| `doc_viewed` | Specific doc opened | 🔲 Planned |
| `doc_edited` | Doc edit saved | 🔲 Planned |
| `doc_created` | New doc created | 🔲 Planned |

---

## Analytics Dashboard

Available at `/analytics` in the workspace sidebar.

**Overview tab** — total events, unique sessions, events-over-time line chart, per-app bar chart, top events table.

**Per App tab** — pick any app + date range, see daily chart + event breakdown.

**Live Feed tab** — real-time event stream polling every 3s. Toggle ● Live / ○ Paused.

---

## Backend

- **Endpoint:** `POST /analytics/events` — batch ingestion (array of event objects)
- **Storage:** `analytics.duckdb` — separate DuckDB database, columnar/OLAP optimized
- **Queries:** `GET /analytics/overview`, `GET /analytics/apps/:appId`, `GET /analytics/feed`

DuckDB was chosen over SQLite specifically for analytics: columnar storage, vectorized execution, and analytical queries (GROUP BY, window functions, date_trunc) that would choke SQLite at scale.

---

## Adding Action Events (Phase 2)

To instrument a new action in any app:

```tsx
import { useAppTracking } from '@/components/Analytics/AnalyticsProvider';

const { trackAction } = useAppTracking('crm');

// In your event handler:
trackAction('contact_created', { source: 'quick-add' });
```

The `meta` field accepts any JSON-serializable object — use it for context (source, variant, counts, etc.).

---

## Notes

- **Privacy:** Zero third-party tracking. Events never leave the machine.
- **Performance:** Fire-and-forget. Analytics never blocks UI.
- **Anonymous sessions:** `session_id` is per tab. User identity is not yet linked to events (planned once multi-user is wired up).
- **No Dashboard/DB Viewer/User Management tracking** — internal tools, not product surfaces.
