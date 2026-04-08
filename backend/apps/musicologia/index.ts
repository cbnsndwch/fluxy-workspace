import { Router } from 'express';
import type Database from 'better-sqlite3';

export function createRouter(db: InstanceType<typeof Database>) {
    const router = Router();

    // ── Tracks ────────────────────────────────────────────────────────────────

    router.get('/api/musicologia/tracks', (req, res) => {
        const limit = parseInt(String(req.query.limit ?? '50'), 10);
        const offset = parseInt(String(req.query.offset ?? '0'), 10);
        const tracks = db.prepare(
            `SELECT t.*, d.tempo, d.key, d.mode, d.energy, d.valence, d.danceability, d.loudness,
                    l.tagline
             FROM tracks t
             LEFT JOIN track_dna d ON d.track_id = t.id
             LEFT JOIN track_lore l ON l.track_id = t.id
             ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
        ).all(limit, offset);
        const total = (db.prepare(`SELECT COUNT(*) as n FROM tracks`).get() as { n: number }).n;
        res.json({ tracks, total, limit, offset });
    });

    router.get('/api/musicologia/tracks/:artistSlug/:trackSlug', (req, res) => {
        const { artistSlug, trackSlug } = req.params;
        const track = db.prepare(
            `SELECT * FROM tracks WHERE artist_slug = ? AND track_slug = ?`
        ).get(artistSlug, trackSlug);
        if (!track) return res.status(404).json({ error: 'Track not found' });

        const dna = db.prepare(`SELECT * FROM track_dna WHERE track_id = ?`).get((track as { id: number }).id);
        const lore = db.prepare(`SELECT * FROM track_lore WHERE track_id = ?`).get((track as { id: number }).id);
        const sections = db.prepare(`SELECT sections FROM track_sections WHERE track_id = ?`).get((track as { id: number }).id);
        const lyrics = db.prepare(`SELECT * FROM track_lyrics WHERE track_id = ? ORDER BY start_ms`).all((track as { id: number }).id);

        res.json({ track, dna, lore, sections, lyrics });
    });

    router.post('/api/musicologia/tracks', (req, res) => {
        const {
            title, artist, artist_slug, track_slug, cover_url, duration_ms,
            spotify_id, musicbrainz_id, isrc,
        } = req.body;
        if (!title || !artist) return res.status(400).json({ error: 'title and artist required' });

        const source_ids = JSON.stringify({ spotify_id, musicbrainz_id, isrc });
        const r = db.prepare(
            `INSERT INTO tracks (title, artist, artist_slug, track_slug, cover_url, duration_ms, source_ids)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(title, artist, artist_slug || null, track_slug || null, cover_url || null, duration_ms || null, source_ids);

        res.status(201).json(db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(r.lastInsertRowid));
    });

    router.patch('/api/musicologia/tracks/:id', (req, res) => {
        const {
            title, artist, artist_slug, track_slug, cover_url, duration_ms,
            spotify_id, musicbrainz_id, isrc,
        } = req.body;
        const existing = db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(req.params.id) as Record<string, unknown> | undefined;
        if (!existing) return res.status(404).json({ error: 'Track not found' });

        const source_ids = JSON.stringify({
            ...JSON.parse((existing.source_ids as string) || '{}'),
            ...(spotify_id !== undefined ? { spotify_id } : {}),
            ...(musicbrainz_id !== undefined ? { musicbrainz_id } : {}),
            ...(isrc !== undefined ? { isrc } : {}),
        });

        db.prepare(
            `UPDATE tracks SET title=COALESCE(?,title), artist=COALESCE(?,artist),
             artist_slug=COALESCE(?,artist_slug), track_slug=COALESCE(?,track_slug),
             cover_url=COALESCE(?,cover_url), duration_ms=COALESCE(?,duration_ms),
             source_ids=?, updated_at=datetime('now') WHERE id=?`
        ).run(title ?? null, artist ?? null, artist_slug ?? null, track_slug ?? null,
              cover_url ?? null, duration_ms ?? null, source_ids, req.params.id);

        res.json(db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(req.params.id));
    });

    // ── DNA ───────────────────────────────────────────────────────────────────

    router.put('/api/musicologia/tracks/:id/dna', (req, res) => {
        const { tempo, key, mode, energy, valence, danceability, loudness, acousticness,
                instrumentalness, liveness, speechiness, time_signature,
                palette, motion_profile, lyric_settings } = req.body;
        const existing = db.prepare(`SELECT id FROM track_dna WHERE track_id = ?`).get(req.params.id);
        if (existing) {
            db.prepare(
                `UPDATE track_dna SET tempo=?,key=?,mode=?,energy=?,valence=?,danceability=?,
                 loudness=?,acousticness=?,instrumentalness=?,liveness=?,speechiness=?,time_signature=?,
                 palette=?,motion_profile=?,lyric_settings=?,updated_at=datetime('now') WHERE track_id=?`
            ).run(tempo, key, mode, energy, valence, danceability, loudness, acousticness,
                  instrumentalness, liveness, speechiness, time_signature,
                  palette ? JSON.stringify(palette) : null,
                  motion_profile ? JSON.stringify(motion_profile) : null,
                  lyric_settings ? JSON.stringify(lyric_settings) : null,
                  req.params.id);
        } else {
            db.prepare(
                `INSERT INTO track_dna (track_id, tempo, key, mode, energy, valence, danceability,
                 loudness, acousticness, instrumentalness, liveness, speechiness, time_signature,
                 palette, motion_profile, lyric_settings)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
            ).run(req.params.id, tempo, key, mode, energy, valence, danceability, loudness,
                  acousticness, instrumentalness, liveness, speechiness, time_signature,
                  palette ? JSON.stringify(palette) : null,
                  motion_profile ? JSON.stringify(motion_profile) : null,
                  lyric_settings ? JSON.stringify(lyric_settings) : null);
        }
        res.json(db.prepare(`SELECT * FROM track_dna WHERE track_id = ?`).get(req.params.id));
    });

    // ── Lore ──────────────────────────────────────────────────────────────────

    router.put('/api/musicologia/tracks/:id/lore', (req, res) => {
        const { tagline, story, trivia, themes, credits } = req.body;
        const existing = db.prepare(`SELECT id FROM track_lore WHERE track_id = ?`).get(req.params.id);
        if (existing) {
            db.prepare(
                `UPDATE track_lore SET tagline=?,story=?,trivia=?,themes=?,credits=?,updated_at=datetime('now') WHERE track_id=?`
            ).run(tagline, story,
                  trivia ? JSON.stringify(trivia) : null,
                  themes ? JSON.stringify(themes) : null,
                  credits ? JSON.stringify(credits) : null,
                  req.params.id);
        } else {
            db.prepare(
                `INSERT INTO track_lore (track_id, tagline, story, trivia, themes, credits)
                 VALUES (?,?,?,?,?,?)`
            ).run(req.params.id, tagline, story,
                  trivia ? JSON.stringify(trivia) : null,
                  themes ? JSON.stringify(themes) : null,
                  credits ? JSON.stringify(credits) : null);
        }
        res.json(db.prepare(`SELECT * FROM track_lore WHERE track_id = ?`).get(req.params.id));
    });

    return router;
}
