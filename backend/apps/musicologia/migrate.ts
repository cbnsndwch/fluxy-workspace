/**
 * MongoDB -> SQLite migration script for Musicologia
 *
 * Usage:
 *   npx ts-node migrate.ts --input /path/to/mongoexport.json
 *
 * Input:  mongoexport file — one JSON document per line (NDJSON/JSONL), or a JSON array
 * Output: documents imported into the SQLite database (../../app.db relative to this script)
 *
 * Tables written:
 *   tracks, track_dna, track_lore, track_lyrics_lrc
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const inputFlag = args.indexOf('--input');

if (inputFlag === -1 || !args[inputFlag + 1]) {
    console.error('Usage: npx ts-node migrate.ts --input /path/to/export.json');
    process.exit(1);
}

const inputPath = args[inputFlag + 1];
if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert any string to a URL-safe slug */
function toSlug(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics
        .replace(/[^\w\s-]/g, '')           // remove non-word chars (except - and space)
        .replace(/[\s_]+/g, '-')            // spaces/underscores -> dashes
        .replace(/^-+|-+$/g, '');           // trim leading/trailing dashes
}

/**
 * Parse LRC-formatted lyrics into timed line objects.
 * Supports the standard [mm:ss.xx] timestamp format.
 */
function parseLrc(lrc: string): { time_seconds: number; text: string; line_index: number }[] {
    const lines: { time_seconds: number; text: string; line_index: number }[] = [];
    const lrcPattern = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/;
    let lineIndex = 0;

    for (const raw of lrc.split('\n')) {
        const m = raw.trim().match(lrcPattern);
        if (!m) continue;
        const minutes = parseInt(m[1], 10);
        const seconds = parseFloat(m[2]);
        const text = m[3].trim();
        if (!text) continue;
        lines.push({ time_seconds: minutes * 60 + seconds, text, line_index: lineIndex++ });
    }

    return lines;
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const dbPath = path.resolve(__dirname, '..', '..', 'app.db');
console.log(`Using database: ${dbPath}`);

const db = new Database(dbPath);

// Ensure all required tables exist (idempotent — safe to run on an existing DB)
db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT NOT NULL,
        artist      TEXT NOT NULL,
        artist_slug TEXT,
        track_slug  TEXT,
        cover_url   TEXT,
        duration_ms INTEGER,
        source_ids  TEXT DEFAULT '{}',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS track_dna (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id         INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        tempo            REAL,
        key              INTEGER,
        mode             INTEGER,
        energy           REAL,
        valence          REAL,
        danceability     REAL,
        loudness         REAL,
        acousticness     REAL,
        instrumentalness REAL,
        liveness         REAL,
        speechiness      REAL,
        time_signature   INTEGER,
        palette          TEXT,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS track_lore (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        tagline    TEXT,
        story      TEXT,
        trivia     TEXT,
        themes     TEXT,
        credits    TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS track_lyrics_lrc (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id     INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        time_seconds REAL    NOT NULL,
        text         TEXT    NOT NULL,
        line_index   INTEGER NOT NULL DEFAULT 0
    );
`);

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const stmtFindBySpotifyId = db.prepare<[string]>(
    `SELECT id FROM tracks WHERE JSON_EXTRACT(source_ids, '$.spotify_id') = ?`
);

const stmtInsertTrack = db.prepare<[string, string, string, string, string | null, number | null, string]>(`
    INSERT INTO tracks (title, artist, artist_slug, track_slug, cover_url, duration_ms, source_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertDna = db.prepare<[
    number,
    number | null, number | null, number | null,
    number | null, number | null, number | null,
    number | null, number | null, number | null,
    number | null, number | null, number | null,
    string | null
]>(`
    INSERT INTO track_dna
        (track_id, tempo, key, mode, energy, valence, danceability,
         loudness, acousticness, instrumentalness, liveness, speechiness,
         time_signature, palette)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertLore = db.prepare<[number, string | null, string | null, string | null, string | null, string | null]>(`
    INSERT INTO track_lore (track_id, tagline, story, trivia, themes, credits)
    VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtInsertLyricLine = db.prepare<[number, number, string, number]>(`
    INSERT INTO track_lyrics_lrc (track_id, time_seconds, text, line_index)
    VALUES (?, ?, ?, ?)
`);

// ---------------------------------------------------------------------------
// Read & parse input file
// ---------------------------------------------------------------------------

console.log(`Reading input: ${inputPath}`);
const raw = fs.readFileSync(inputPath, 'utf-8').trim();

let documents: Record<string, unknown>[];

try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
        documents = parsed as Record<string, unknown>[];
    } else {
        // Single-object JSON file
        documents = [parsed as Record<string, unknown>];
    }
} catch {
    // Not valid JSON as a whole — treat as NDJSON / JSONL
    documents = raw
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map((line, i) => {
            try {
                return JSON.parse(line) as Record<string, unknown>;
            } catch (e) {
                throw new Error(`Failed to parse line ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
            }
        });
}

console.log(`Found ${documents.length} document(s) to process.\n`);

// ---------------------------------------------------------------------------
// Migration loop
// ---------------------------------------------------------------------------

let imported = 0;
let skipped = 0;
let errors = 0;

// Wrap everything in a single transaction for performance
const migrate = db.transaction(() => {
    for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];

        // Progress report every 100 records
        if (i > 0 && i % 100 === 0) {
            console.log(`  [${i}/${documents.length}] imported=${imported} skipped=${skipped} errors=${errors}`);
        }

        try {
            // ------------------------------------------------------------------
            // Extract core fields from the MongoDB document
            // ------------------------------------------------------------------
            const spotifyId = (doc.spotify_id ?? null) as string | null;
            const musicbrainzId = (doc.musicbrainz_id ?? null) as string | null;
            const isrc = (doc.isrc ?? null) as string | null;

            const title = String(doc.title ?? doc.name ?? 'Unknown');
            const artist = String(doc.artist ?? 'Unknown');
            const coverUrl = (doc.cover_url ?? null) as string | null;
            const durationMs = (doc.duration_ms ?? null) as number | null;

            const artistSlug = (doc.artist_slug as string | undefined)
                ?? toSlug(artist.split(',')[0].trim());
            const trackSlug = (doc.track_slug as string | undefined)
                ?? toSlug(title);

            // ------------------------------------------------------------------
            // Skip check — look up by spotify_id
            // ------------------------------------------------------------------
            if (spotifyId) {
                const existing = stmtFindBySpotifyId.get(spotifyId) as { id: number } | undefined;
                if (existing) {
                    skipped++;
                    continue;
                }
            }

            // ------------------------------------------------------------------
            // Insert into `tracks`
            // ------------------------------------------------------------------
            const sourceIds = JSON.stringify({
                spotify_id: spotifyId,
                musicbrainz_id: musicbrainzId,
                isrc,
            });

            const trackResult = stmtInsertTrack.run(
                title,
                artist,
                artistSlug,
                trackSlug,
                coverUrl,
                durationMs,
                sourceIds,
            );

            const trackId = Number(trackResult.lastInsertRowid);

            // ------------------------------------------------------------------
            // Insert into `track_dna`
            // ------------------------------------------------------------------
            const dna = doc.dna as Record<string, unknown> | undefined;
            if (dna && typeof dna === 'object') {
                const palette = (dna.palette != null) ? JSON.stringify(dna.palette) : null;

                stmtInsertDna.run(
                    trackId,
                    (dna.tempo as number | null) ?? null,
                    (dna.key as number | null) ?? null,
                    (dna.mode as number | null) ?? null,
                    (dna.energy as number | null) ?? null,
                    (dna.valence as number | null) ?? null,
                    (dna.danceability as number | null) ?? null,
                    (dna.loudness as number | null) ?? null,
                    (dna.acousticness as number | null) ?? null,
                    (dna.instrumentalness as number | null) ?? null,
                    (dna.liveness as number | null) ?? null,
                    (dna.speechiness as number | null) ?? null,
                    (dna.time_signature as number | null) ?? null,
                    palette,
                );
            }

            // ------------------------------------------------------------------
            // Insert into `track_lore`
            // ------------------------------------------------------------------
            const lore = doc.lore as Record<string, unknown> | undefined;
            if (lore && typeof lore === 'object') {
                const tagline = (lore.tagline as string | null) ?? null;
                const story = (lore.story as string | null) ?? null;
                const trivia = (lore.trivia != null) ? JSON.stringify(lore.trivia) : null;
                const themes = (lore.themes != null) ? JSON.stringify(lore.themes) : null;
                const credits = (lore.credits != null) ? JSON.stringify(lore.credits) : null;

                stmtInsertLore.run(trackId, tagline, story, trivia, themes, credits);
            }

            // ------------------------------------------------------------------
            // Insert into `track_lyrics_lrc`
            // ------------------------------------------------------------------
            const lyricsRaw = doc.lyrics as string | undefined;
            if (lyricsRaw && typeof lyricsRaw === 'string') {
                const lines = parseLrc(lyricsRaw);
                for (const line of lines) {
                    stmtInsertLyricLine.run(trackId, line.time_seconds, line.text, line.line_index);
                }
            }

            imported++;
        } catch (e: unknown) {
            errors++;
            const docId = (doc._id as Record<string, string> | undefined)?.$oid
                ?? String(doc.spotify_id ?? `index ${i}`);
            console.error(`  ERROR processing document [${docId}]: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
});

migrate();

// ---------------------------------------------------------------------------
// Final report
// ---------------------------------------------------------------------------
console.log('\n----------------------------------------');
console.log('Migration complete:');
console.log(`  Imported : ${imported}`);
console.log(`  Skipped  : ${skipped}  (already exist by spotify_id)`);
console.log(`  Errors   : ${errors}`);
console.log('----------------------------------------\n');

db.close();
