# Musicologia Enricher — Nightly CRON Task

Runs the Phase 8 enrichment pipeline on all Musicologia tracks that are missing
real album-art palette colors, estimated audio DNA, or synced lyrics.

## What it does

1. **Palette extraction** — Downloads each track's cover art, resizes to 64×64,
   extracts 5 dominant colors via k-means clustering using `sharp`. Replaces the
   algorithmic palette with real colors derived from the actual artwork.

2. **LRCLIB lyrics sync** — Queries `https://lrclib.net/api/get` for synced LRC
   lyrics for any track that has no lyric rows in `track_lyrics_lrc`. Stores the
   parsed timed lines automatically.

3. **MusicBrainz tag enrichment** — If a track has a `musicbrainz_id` in
   `source_ids` but no themes yet, fetches vote-weighted genre tags from the MB
   recording endpoint (respecting 1 req/sec rate limit).

4. **Genre heuristic DNA** — If a track has genres/themes but is missing `energy`
   or `valence`, estimates audio features from the 100+ genre→feature mapping
   table in `enrich.ts`. Uses COALESCE so it never overwrites real Spotify data.

## Steps

1. Call `POST http://localhost:3004/api/musicologia/admin/batch-enrich` (port 3004 direct, no workspace auth).
   This triggers an SSE stream — consume it until a `{"type":"done"}` event arrives.

2. After the stream ends, call `GET http://localhost:3004/api/musicologia/admin/enrichment-stats`
   to get coverage numbers.

3. Log the summary to today's daily notes in `memory/YYYY-MM-DD.md`:
   ```
   ## Musicologia enricher (2am CRON)
   - Total tracks: N
   - Palette: N/N
   - Energy/DNA: N/N
   - Synced lyrics: N/N
   - Lore stories: N/N
   - Errors: N
   ```

4. If coverage is below 80% for any category AND there are more than 10 tracks,
   importance = 7: notify Diego with a summary message.

5. If any individual track consistently fails (errors in multiple runs), note the
   track ID and title in the daily log for manual review.

## Error handling

- If the batch-enrich endpoint returns a non-2xx status, log the error and exit gracefully.
- If the SSE stream never sends `type:done` within 5 minutes, consider it timed out and log.
- Don't retry the same track more than once per run (the backend handles this internally).

## Notes

- MusicBrainz has a 1 req/sec rate limit — the enricher already handles this internally.
- LRCLIB is free and has no rate limit documented, but the enricher pauses 500ms between tracks.
- The enricher uses COALESCE so real Spotify data is NEVER overwritten by estimates.
- Palette extraction requires a reachable cover_url — Spotify CDN URLs may expire eventually.
