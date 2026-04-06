# Research Worker Task

This task runs automatically when research is queued (triggered immediately on new topics/re-queue) and every 30 minutes as a background cron.

Your job: process pending research sessions and revisit ongoing topics that are due.

---

## Step 1 — Check the queue

```
GET /app/api/research/queue
```

Returns:
- `queued` — sessions waiting to be processed (each has topic title, description, detail_level)
- `due_for_revisit` — ongoing topics whose `next_revisit_at` has passed

**Process at most 2 items per run** to avoid timeouts. Prioritize `queued` first, then `due_for_revisit`.

If both arrays are empty, log "No research work pending" in today's daily notes and stop.

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

### 2b. Determine search queries

Based on the topic title + description, generate search queries depending on detail_level:
- **brief**: 3–5 queries
- **standard**: 10–20 queries
- **deep**: 25–40 queries

Think about different angles: definitions, history, comparisons, recent developments, criticisms, use cases, examples, statistics, expert opinions, counterarguments. For deep research, explore every major sub-angle exhaustively.

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

Update current_step when done reading:
```
PUT /app/api/research/sessions/{session_id}
Body: { "current_step": "Analyzing findings…" }
```

### 2f. Write the report

Update current_step before writing:
```
PUT /app/api/research/sessions/{session_id}
Body: { "current_step": "Writing report…" }
```

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
Body: { "content": "# Topic Title\n\n..." }
```

### 2g. Complete the session

```
POST /app/api/research/sessions/{session_id}/complete
Body: {}
```

This automatically:
- Marks the session as `completed`
- Updates `last_researched_at` on the topic
- Computes and sets `next_revisit_at` if the topic is ongoing

---

## Step 3 — For each due_for_revisit topic

These are ongoing topics that need a fresh research run.

1. Create a new session:
   ```
   POST /app/api/research/topics/{topic_id}/queue
   ```
   This returns a new session object.

2. Immediately process that session following Step 2 above.

   **Important**: Previous sessions and reports are preserved. Do NOT delete old data. The new session is self-contained; the UI shows all sessions in a timeline.

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
- Which topics (titles)
- Any errors encountered

If research completed on a topic Diego seems particularly interested in (e.g. something recently added), send a message to let him know it's ready (importance 7+).
