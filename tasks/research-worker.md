# Research Worker Task

This task runs automatically when research is queued (triggered immediately on new topics/re-queue) and every 30 minutes as a background cron.

Your job: process pending research sessions and revisit ongoing topics that are due.

---

## Step 1 — Check the queue

```
GET /app/api/research/queue
```

Returns:
- `queued` — sessions waiting to be processed (each has topic title, description, detail_level, session_type)
- `due_for_revisit` — ongoing topics whose `next_revisit_at` has passed

**Process at most 2 items per run** to avoid timeouts. Prioritize `queued` first, then `due_for_revisit`.

If both arrays are empty, log "No research work pending" in today's daily notes and stop.

**Session types you may encounter in the queue:**
- `full` — first-time research session; write a comprehensive full report
- `master_synthesis` — synthesize all existing findings into a new master report (no new searching needed)
- `delta` — set by you after novelty detection; write a focused "what changed" report
- `no_update` — set by you when novelty is below threshold; skip report, just complete

---

## Step 2 — For each queued session

### 2a. Mark as in_progress

```
PUT /app/api/research/sessions/{session_id}
Body: { "status": "in_progress", "started_at": "<ISO datetime>", "current_step": "Planning searches…" }
```

Also update the parent topic:
```
PUT /app/api/research/topics/{topic_id}
Body: { "status": "in_progress" }
```

---

### IF session_type == 'master_synthesis' → Go to Step 5

Skip all searching — this session is purely about synthesizing existing knowledge.

---

### 2b. Determine search queries (full and delta sessions)

Based on the topic title + description, generate search queries depending on detail_level:
- **brief**: 3–5 queries
- **standard**: 10–20 queries
- **deep**: 25–40 queries

Think about different angles: definitions, history, comparisons, recent developments, criticisms, use cases, examples, statistics, expert opinions, counterarguments. For deep research, explore every major sub-angle exhaustively.

For **revisit sessions** (ongoing topics being re-researched), bias queries toward recent developments:
- Add "latest", "2025", "2026", "recent" qualifiers
- Focus on news, announcements, updates since the last research date

### 2c. Execute searches

Update current_step before starting:
```
PUT /app/api/research/sessions/{session_id}
Body: { "current_step": "Searching the web…" }
```

Use `WebSearch` tool for each query. Collect the results (titles, URLs, snippets).

### 2d. Fetch key pages

Update current_step before fetching:
```
PUT /app/api/research/sessions/{session_id}
Body: { "current_step": "Reading sources (1 of N)…" }
```

From the search results, select the most relevant URLs:
- **brief**: up to 10 URLs
- **standard**: 10–50 URLs (aim for 20–30 where content is rich)
- **deep**: 50+ URLs — be thorough; read as many relevant sources as possible

Use `WebFetch` to read each page. As you work through them, keep current_step updated:
```
PUT /app/api/research/sessions/{session_id}
Body: { "current_step": "Reading sources (3 of 8)…" }
```

Extract the key information from each page.

### 2e. Save findings

For each meaningful piece of information found, save a finding:

```
POST /app/api/research/sessions/{session_id}/findings
Body: {
  "type": "fact" | "evidence" | "reference",
  "content": "The key information extracted...",
  "source_url": "https://...",
  "source_title": "Page title"
}
```

Batch up findings — save them as you go, not all at once.

---

## Step 3 — Novelty detection (revisit sessions only)

This step determines whether there's enough new material to warrant a report, and whether to write a delta report or skip.

**Only run this for ongoing topic revisits.** Skip for first-time `full` sessions.

### 3a. Get previously known URLs

```
GET /app/api/research/topics/{topic_id}/known-urls
```

This returns all source URLs that have appeared in any prior session for this topic.

### 3b. Count novel findings

Count how many findings you saved this session whose `source_url` is NOT in the known-urls list.

Also assess content novelty: even if a URL is known, did you find meaningfully new information from it (e.g., an article was updated, a new statement appeared)?

Use this threshold:
- **< 3 genuinely novel pieces** → this is a `no_update` session
- **≥ 3 novel pieces** → write a `delta` report

### 3c. Handle no_update

If novelty is below threshold:

```
PUT /app/api/research/sessions/{session_id}
Body: { "session_type": "no_update", "current_step": "No significant updates found" }
```

Then complete the session:
```
POST /app/api/research/sessions/{session_id}/complete
Body: {}
```

Log in daily notes: "Revisited [topic] — no significant updates"

**Stop processing this session.** Move to next work item.

### 3d. Mark as delta

If novelty is sufficient, mark the session:

```
PUT /app/api/research/sessions/{session_id}
Body: { "session_type": "delta" }
```

Then proceed to Step 4 to write the delta report.

---

## Step 4 — Write the report

Update current_step before writing:
```
PUT /app/api/research/sessions/{session_id}
Body: { "current_step": "Writing report…" }
```

### For `full` sessions (first time):

Write a comprehensive markdown report synthesizing everything you found. Structure it well:
- Title (# heading)
- Executive summary (2–3 sentences)
- Main sections with ## headings
- Key findings as bullet points where appropriate
- Balanced analysis — include multiple perspectives
- Conclusion

Target length by detail_level:
- **brief**: ~400–600 words
- **standard**: ~1000–1500 words
- **deep**: ~3000–5000 words — exhaustive, well-structured, with subsections covering every significant angle

Save the report:
```
POST /app/api/research/sessions/{session_id}/report
Body: { "content": "# Topic Title\n\n...", "report_type": "full" }
```

### For `delta` sessions (revisit with new content):

Write a focused **delta report** — not a full re-synthesis. Structure:

```markdown
# [Topic]: What's New (since [last_researched_at date])

## New Developments

[2–5 bullet points or brief sections covering what actually changed]

## Key Takeaways

[1–3 sentences summarizing the significance of these developments]

## Sources

[List of new sources found this session]
```

Keep it tight — 200–600 words. The master report covers the full picture; this is just the update layer.

Save the report:
```
POST /app/api/research/sessions/{session_id}/report
Body: { "content": "# [Topic]: What's New...", "report_type": "delta" }
```

---

## Step 4a. Complete the session

```
POST /app/api/research/sessions/{session_id}/complete
Body: {}
```

This automatically:
- Marks the session as `completed`
- Updates `last_researched_at` on the topic
- Computes and sets `next_revisit_at` if the topic is ongoing
- For `delta` sessions: increments `delta_count` on the topic
- For `full` sessions: sets this session as the new master

### Check auto-synthesis threshold

After completing a delta session, check the response:
```json
{ "ok": true, "next_revisit_at": "...", "delta_count": 4 }
```

If `delta_count >= 5`, automatically trigger master synthesis:
```
POST /app/api/research/topics/{topic_id}/synthesize
```

This queues a `master_synthesis` session. It will be processed on the next worker run (either this run if slots remain, or the next 30-minute pulse).

---

## Step 5 — Master synthesis (master_synthesis sessions)

This is a special session type: synthesize all existing knowledge into one authoritative master report. No searching.

### 5a. Gather all prior data

Get all sessions and their findings for this topic:
```
GET /app/api/research/topics/{topic_id}/sessions
```

For each completed session (full + delta, not no_update), load its report content and findings. You don't need to re-fetch pages — everything is already in the DB.

Also get the current master report (if any) to understand what already exists.

### 5b. Write the master report

Synthesize everything into a single authoritative document:

```markdown
# [Topic Title]

> *Master report — synthesized [date] from [N] research sessions*

## Executive Summary

[3–4 sentences covering the full state of knowledge]

## [Main section 1]
...

## [Main section 2]
...

## Timeline / Recent Developments

[Ordered list of major developments across all sessions, newest first]

## Key Findings

[Top 5–10 bullets]

## Conclusion
...
```

Target: comprehensive but not padded. For most topics: 1500–3000 words. For deep topics with many deltas: up to 5000 words.

Save the report:
```
POST /app/api/research/sessions/{session_id}/report
Body: { "content": "# Topic Title...", "report_type": "master" }
```

### 5c. Complete the session

```
POST /app/api/research/sessions/{session_id}/complete
Body: {}
```

The backend will:
- Set this session as the new `master_report_session_id` on the topic
- Reset `delta_count` to 0

---

## Step 3 (due_for_revisit) — For each due_for_revisit topic

These are ongoing topics that need a fresh research run.

1. Create a new session:
   ```
   POST /app/api/research/topics/{topic_id}/queue
   ```
   This returns a new session object with `session_type = 'full'` by default.

2. Immediately process that session following Steps 2–4 above.
   - During novelty detection (Step 3), this session may be reclassified as `delta` or `no_update`.
   - **Important**: Previous sessions and reports are preserved. Do NOT delete old data. The new session is self-contained; the UI shows all sessions in a timeline.

---

## Error handling

If any step fails:
1. Complete the session with an error:
   ```
   POST /app/api/research/sessions/{session_id}/complete
   Body: { "error": "Brief description of what went wrong" }
   ```
2. Log the error in today's daily notes
3. Move on to the next work item

---

## After processing

Log a brief summary in today's daily notes:
- How many topics were researched
- Which topics (titles), their session types (full/delta/no_update/master)
- Any errors encountered
- Any auto-synthesis triggers fired

If research completed on a topic Diego seems particularly interested in (e.g. something recently added), send a message to let him know it's ready (importance 7+).

For master synthesis completions, always notify (importance 8): "Master report synthesized for [topic] — covers [N] sessions."
