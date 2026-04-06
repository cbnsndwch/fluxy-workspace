# Deep Research

An async web research engine. Add a topic, choose a depth level, and Sebastian goes off and scours the web — searching, reading sources, synthesizing findings, and producing a structured markdown report. Research runs in the background so it never blocks the chat.

---

## Overview

Deep Research lives at `/deep-research`. The left panel is your topic list. Click any topic to open its detail panel on the right, where you can see the current session status, read completed reports, and browse session history.

---

## Adding a Topic

1. Click **New Topic** (top-right)
2. Enter a title and optional description (more detail → better search queries)
3. Choose a **detail level** (see below)
4. Optionally enable **Ongoing Research** and set a revisit interval
5. Click **Start Research**

Research kicks off within ~30 seconds via an immediate one-shot CRON trigger.

---

## Detail Levels

| Level | Sources | Report Length | Use When |
|-------|---------|---------------|----------|
| **Brief** | Up to 10 | ~400–600 words | Quick overview, fast answer |
| **Standard** | 10–50 | ~1,000–1,500 words | Solid understanding, multiple angles |
| **Deep** | 50+ | ~3,000–5,000 words | Exhaustive analysis, every sub-angle covered |

Deep research runs 25–40 search queries and reads as many relevant sources as possible. It takes longer but produces publication-quality output.

---

## Session Status

While research is running, the header shows the live current step:

- **Planning searches…** — generating queries from the topic
- **Searching the web…** — executing search queries
- **Reading sources (N of M)…** — fetching and parsing each URL
- **Analyzing findings…** — synthesizing what was found
- **Writing report…** — producing the final markdown report

The topic list and detail panel both poll every 3–4 seconds while a session is active.

---

## Ongoing Research

Toggle **Keep research ongoing** on any topic to make it a long-term research direction. Set how often Sebastian should revisit it:

| Interval | When It Fires |
|----------|---------------|
| Daily | Every day |
| Weekly | Every 7 days |
| Twice a month | Every 15 days |
| Monthly | Every 30 days |
| Quarterly | Every 90 days |
| Yearly | Every 365 days |

When a revisit fires, a **new session is created** with fresh searches and a new report. All previous sessions and reports are preserved and remain accessible in the session history.

---

## Reading Reports

Once a session completes, the **Report** tab shows the full markdown output:

- Constrained reading width (not edge-to-edge) for comfortable reading
- Automatic **Table of Contents** in a sticky right sidebar (on wide screens) — click any heading to scroll directly to it
- **Sources** — numbered reference list at the bottom linking back to every page Sebastian read

### Toolbar Actions

| Button | Action |
|--------|--------|
| **↓ MD** | Download the report as a `.md` file |
| **↓ PDF** | Opens a print-optimized window and triggers browser "Save as PDF" — text-based, fully searchable |
| **Share** | Generate a public share link (see below) |

---

## Sharing Reports

Click **Share** in the report toolbar to generate a public link. Shared reports:

- Are accessible without logging in — share freely with anyone
- Display at `/share/:token` on your workspace domain
- Include the full report, table of contents, and sources
- Use a clean light-theme layout optimized for reading

To revoke access, open the share dialog again and click **Revoke**.

---

## Session History

Every research run on a topic is preserved. Click the **Sessions** tab in the detail panel to browse all past runs, ordered newest-first. Each session shows its status, start time, and a link to its report. Useful for tracking how knowledge on a topic evolves over time.

---

## How Research Works

Sebastian runs the research worker automatically. Two triggers fire it:

1. **Immediate** — when you create a topic or hit Re-research, a one-shot CRON fires within ~30 seconds
2. **Background CRON** — every 30 minutes, Sebastian checks for any sessions still queued or ongoing topics due for revisit

The worker processes at most 2 sessions per run to avoid timeouts, prioritizing queued sessions over revisit checks.

---

## Database Tables

| Table | Contents |
|-------|----------|
| `research_topics` | Topic title, description, detail level, ongoing flag, revisit interval, status, timestamps |
| `research_sessions` | Sessions per topic — status, current_step, error, started/completed timestamps |
| `research_findings` | Individual findings per session — type (fact/evidence/reference), content, source URL and title |
| `research_reports` | Final markdown report per session — content, share_token |
