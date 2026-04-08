# Musicologia — Build Roadmap

> Phases 1–7 are shipped and documented below. Phases 8–11 are the next chapter: **feature parity with the reference app**, with a richer data pipeline that doesn't depend on Spotify's now-restricted APIs.

---

## ✅ Phase 1 — Foundation

**Status: Done**

13-table SQLite schema covering the full data model:

| Table | Purpose |
|-------|---------|
| `tracks` | Core track metadata (title, artist, album, duration, cover art, Spotify ID) |
| `track_dna` | Audio features: energy, valence, tempo, key, mode, palette, archetype |
| `track_sections` | Track timeline split into sections with energy per segment |
| `track_lyrics` | Plain and synced (LRC) lyric storage |
| `track_lore` | AI-generated narrative: tagline, story, trivia, themes |
| `playlists` | Playlist metadata |
| `playlist_tracks` | Junction table (playlist ↔ track, ordered) |
| `music_interactions` | User reactions (heart, fire, brain, ghost) per track |
| `music_suggestions` | User-submitted track suggestions |
| `music_images` | Extra image assets per track |
| `music_follows` | Social follow graph |
| `music_comments` | Nested comments per track |
| `music_activity_feed` | Fan-out activity events |

Full CRUD backend routes + gallery grid + track detail page. `Music` icon, purple theme, main section, `/musicologia`.

---

## ✅ Phase 2 — Spotify Import

**Status: Done**

- Spotify OAuth flow (Diego-only — scoped to owner account)
- Import from saved tracks and playlists
- Audio feature extraction: energy, valence, tempo, key, mode pulled from Spotify's features endpoint (now restricted for new apps — existing tokens still work for already-imported data)
- Track DNA row populated from import

---

## ✅ Phase 3 — Lore Generation

**Status: Done**

- AI-generated narrative lore per track using `OPENAI_API_KEY`
- Generates: tagline, story paragraphs, trivia facts, themes
- Admin panel with batch lore generation via **SSE streaming** — live progress per track as it generates
- Lore stored in `track_lore` table, surfaced in track detail views

---

## ✅ Phase 4 — Immersive Player

**Status: Done**

885-line GSAP + Three.js player at `/musicologia/tracks/:artist/:track`:

- **Full-screen cinematic hero** — palette-derived radial glows, word-by-word GSAP title animation with 3D perspective, scroll-driven parallax exit
- **Scroll CTA** — bouncing `ChevronDown` arrow, auto-hides on first scroll
- **LRC lyric sync** — timestamp-based RAF loop, active line highlight
- **Three.js particle effects** — ambient particles driven by energy
- **Visual themes** — palette-derived color injection
- **Back button** — `absolute` positioned (fixed → regression fix applied), stays within player bounds
- Dependencies added: `gsap`, `three`

---

## ✅ Phase 5 — Community

**Status: Done**

Social layer built on top of the existing schema:

- **Follow graph** — `music_follows` table, follow/unfollow endpoints
- **Activity feed** — fan-out writes to `music_activity_feed` on interactions
- **Reactions** — 6 emoji types (heart, fire, brain, ghost + 2 more), per-track counts
- **Nested comments** — threaded replies, `music_comments` table
- Feed page at `/musicologia/feed`

---

## ✅ Phase 6 — Admin + Migration

**Status: Done**

- **MongoDB → SQLite migration script** (`backend/apps/musicologia/migrate.ts`) — one-shot import of existing data from old DB
- **Full tabbed admin panel:**
  - Stats overview
  - Batch lore generation with SSE streaming
  - Playlist import
  - Sync audio features from Spotify
  - LRC lyrics editor
  - Audit log (`musicologia_audit` table)

---

## ✅ Phase 7 — Scrobbler + Staging Area

**Status: Done**

- `musicologia_plays` table — persistent play history
- `musicologia_staging` table — import queue before committing to library
- `POST /api/musicologia/scrobble/tick` — polls Spotify currently-playing API, scrobbles at 50% listened or 4-minute threshold
- `spotify-scrobbler` CRON fires every minute (registered in `CRONS.json`)
- `ListeningTab.tsx` — Queue + History sub-tabs inside the main Musicologia page
- Library / Listening tab switcher in page header

---

## Context

The reference app (cloned at `/home/serge/projects/musicologia`) uses a **TrackDNA** model — a comprehensive data object derived from multiple free/open sources — that drives every visual and interactive layer of the player. Our current implementation has the visual shell but lacks the data backbone.

Spotify killed the audio features endpoint for new apps. The reference app routes around this using open data sources + AI generation. We need to do the same.

---

## The TrackDNA Model

Everything in the player derives from a single enriched data object:

```
TrackDNA {
  energy        // 0–1 (estimated from genre heuristics or Spotify if available)
  valence       // 0–1 (mood: sad→happy)
  tempo         // BPM
  key           // 0–11 (C=0)
  mode          // 0=minor, 1=major
  palette       // top 5 hex colors extracted from album art
  mbid          // MusicBrainz ID
  isrc          // International Standard Recording Code
  genres        // vote-weighted genre tags from MusicBrainz
  lrc           // synced lyrics (LRC format) from LRCLIB
  lore          // AI-generated narrative object (see below)
  archetype     // derived: "neon" | "chrome" | "glass" | "void" | "ink" | "smoke" | "crystal" | "paper"
}
```

The **archetype** is computed from energy + valence:

| energy | valence | archetype |
|--------|---------|-----------|
| high   | high    | neon      |
| high   | low     | chrome    |
| mid    | high    | glass     |
| mid    | low     | void      |
| low    | high    | crystal   |
| low    | low     | ink       |
| very low | any   | smoke     |
| special | any   | paper     |

---

## Phase 8 — TrackDNA Enrichment Pipeline (Backend)

**Goal:** Build the data foundation. Everything else depends on this.

### 8.1 MusicBrainz Enrichment

- Lookup track by ISRC → get MBID + genre tags (vote-weighted)
- Map genre tags → energy/valence/tempo estimates via 100+ genre heuristics
- Store results in `track_dna` table (already exists, needs populating)
- Free, no auth, rate-limit: 1 req/sec

**Route:** `POST /api/musicologia/enrich/:trackId` (manual trigger per track)
**Batch:** `POST /api/musicologia/enrich/batch` (all un-enriched tracks)

### 8.2 LRCLIB Lyrics Sync

- Query LRCLIB by artist + title + duration
- Returns synced LRC (timestamped lines) or plain text fallback
- Store in `track_lyrics` table (already exists)
- Free, no auth

**Route:** `POST /api/musicologia/lyrics/sync/:trackId`
**Batch:** `POST /api/musicologia/lyrics/sync-all`

### 8.3 Album Art Color Extraction

- Fetch album art → downsample to 64×64 via `sharp`
- Extract top 5 dominant palette colors
- Store in `track_dna.palette` as JSON array of hex strings
- Install: `npm install sharp`

### 8.4 Genre→Feature Heuristics

Map MusicBrainz genre tags to audio feature estimates when Spotify features unavailable:

```typescript
const GENRE_FEATURES: Record<string, Partial<AudioFeatures>> = {
  "death metal":    { energy: 0.95, valence: 0.2,  tempo: 165 },
  "ambient":        { energy: 0.15, valence: 0.5,  tempo: 80  },
  "bossa nova":     { energy: 0.35, valence: 0.85, tempo: 120 },
  "drum and bass":  { energy: 0.9,  valence: 0.5,  tempo: 174 },
  // ... 100+ entries
};
```

### 8.5 Lore Generation (OpenAI)

Generate per-track narrative using existing `OPENAI_API_KEY`:

```typescript
interface TrackLore {
  tagline:    string;        // one-line hook ("A cathedral of distortion and grief")
  story:      string[];      // 3–4 atmospheric paragraphs
  trivia:     string[];      // 8–10 facts (production, history, cultural impact)
  themes:     string[];      // e.g. ["isolation", "late capitalism", "nostalgia"]
  archetype:  string;        // the material archetype determined by AI
}
```

Already partially built — needs genre + MusicBrainz context added to the prompt for richer output.

### 8.6 CRON: nightly-enrichment

```json
{
  "id": "musicologia-enrichment",
  "schedule": "0 3 * * *",
  "task": "Enrich un-processed Musicologia tracks: MusicBrainz, LRCLIB, color palette, lore. Max 20 tracks per run."
}
```

---

## Phase 9 — Material System (Frontend Foundation)

**Goal:** TrackDNA drives the visual layer via CSS variables.

### 9.1 TrackDNA Context

```tsx
// client/src/components/Musicologia/TrackDNAContext.tsx
const TrackDNAContext = createContext<TrackDNA | null>(null);
export function useTrackDNA() { return useContext(TrackDNAContext); }
```

### 9.2 CSS Variable Injection

Inject DNA values as CSS custom properties on the player root:

```css
--dna-primary:    /* palette[0] */
--dna-secondary:  /* palette[1] */
--dna-accent:     /* palette[2] */
--audio-energy:   /* energy * 100 as % */
--audio-valence:  /* valence * 100 as % */
--audio-tempo:    /* tempo */
```

### 9.3 MaterialBackground Component

8 visual archetypes, each a distinct atmospheric background:

| archetype | visual treatment |
|-----------|-----------------|
| neon      | electric grid, scan lines, glitch flickers |
| chrome    | metallic gradient, sharp specular highlights |
| glass     | frosted blur layers, light refraction |
| void      | deep black, sparse particle dust |
| ink       | paper texture, ink bleeds, organic shapes |
| smoke     | soft volumetric fog, slow drift |
| crystal   | prismatic geometry, light scatter |
| paper     | warm cream, typographic texture |

Component: `client/src/components/Musicologia/MaterialBackground.tsx`

---

## Phase 10 — Player Sections

**Goal:** Populate the immersive player scroll journey with real content.

### 10.1 AudioFeaturesSection

- Energy, valence, tempo, key/mode visualized as animated bars
- Palette-colored fill, DNA-driven heights
- Reference: `src/components/player/AudioFeaturesSection.tsx`

### 10.2 LoreSection

- AI tagline (large, centered, atmospheric)
- Story paragraphs (staggered fade-in on scroll)
- Trivia grid (8–10 cards, flip-reveal on hover)
- Theme chips (palette-colored badges)

### 10.3 LyricsSection (Synced)

Three choreography modes based on energy:

| energy | mode | behavior |
|--------|------|----------|
| > 0.7 | **cinematic** | full-screen line-by-line, heavy blur on inactive |
| 0.4–0.7 | **karaoke** | scrolling list, active line highlighted + scaled |
| < 0.4 | **scattered** | words drift in 3D space, ambient placement |

Sync engine: timestamp-based, requestAnimationFrame loop, no external dep.

### 10.4 EnergyTimeline

BPM-synced horizontal timeline — shows energy curve across the track's sections. Derived from section data in `track_sections` table.

### 10.5 CreditsSection

Production credits pulled from MusicBrainz relationships (producer, mixer, engineer, featured artists). Simple typographic layout.

---

## Phase 11 — Polish & Interactions

- **Lenis** smooth scroll (`npm install @studio-freight/lenis`)
- **Mobile tab switcher** — bottom sheet tabs: Overview / Lyrics / Lore / Credits
- **Track reactions** — heart, fire, brain, ghost (already have `music_interactions` table)
- **Playlist navigation** — prev/next within playlist context, keyboard shortcuts
- **Share card** — OG-style shareable image generated server-side with `sharp`

---

## Data Flow Summary

```
Track imported (Spotify / manual)
        ↓
nightly-enrichment CRON (3am)
        ↓
MusicBrainz → MBID + genres
LRCLIB      → synced lyrics
sharp       → palette colors
OpenAI      → lore + trivia
        ↓
track_dna row populated
        ↓
ImmersivePlayer fetches /api/musicologia/tracks/:id/dna
        ↓
TrackDNAContext → MaterialBackground + CSS vars
        ↓
AudioFeatures + Lyrics + Lore + Credits sections render
```

---

## Open Questions

1. **Lyrics licensing** — LRCLIB is community-maintained. Fine for personal use, unclear for distribution.
2. **Rate limits** — MusicBrainz: 1 req/sec. LRCLIB: undocumented but lenient. Need queuing for batch jobs.
3. **Spotify features fallback** — for tracks where we _do_ have audio features (imported before the restriction), use real data. For others, use genre heuristics.
4. **Admin UI** — Phase 6 admin already has batch lore gen. Extend it with: enrichment status per track, manual re-enrich, lyrics editor (already exists), DNA preview.

---

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Foundation (schema + CRUD) | ✅ Done |
| 2 | Spotify Import | ✅ Done |
| 3 | Lore Generation (basic) | ✅ Done |
| 4 | Immersive Player shell | ✅ Done |
| 5 | Community (follows, feed, reactions) | ✅ Done |
| 6 | Admin + MongoDB migration | ✅ Done |
| 7 | Scrobbler + Staging | ✅ Done |
| 8 | TrackDNA enrichment pipeline | 🔜 Next |
| 9 | Material system | 🔜 Planned |
| 10 | Player sections (full) | 🔜 Planned |
| 11 | Polish & interactions | 🔜 Planned |
