import { Router } from 'express';
import type Database from 'better-sqlite3';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSlug(text: string): string {
    return text.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

interface SpotifyTokenRow {
    id: number;
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scope: string | null;
}

function getStoredToken(db: InstanceType<typeof Database>): SpotifyTokenRow | null {
    return (db.prepare('SELECT * FROM musicologia_spotify_tokens ORDER BY id DESC LIMIT 1').get() as SpotifyTokenRow | undefined) ?? null;
}

async function refreshAccessToken(db: InstanceType<typeof Database>, row: SpotifyTokenRow): Promise<string | null> {
    const clientId = process.env.SPOTIFY_CLIENT_ID || '';
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) return null;

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string; expires_in?: number; refresh_token?: string };
    if (!data.access_token) return null;

    const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    db.prepare(
        `UPDATE musicologia_spotify_tokens SET access_token=?, refresh_token=COALESCE(?,refresh_token), expires_at=?, updated_at=datetime('now') WHERE id=?`
    ).run(data.access_token, data.refresh_token ?? null, expiresAt, row.id);

    return data.access_token;
}

/** Returns a valid access token (refreshing if needed), or null if not connected / misconfigured. */
async function getValidToken(db: InstanceType<typeof Database>): Promise<string | null> {
    const row = getStoredToken(db);
    if (!row) return null;
    if (Date.now() < row.expires_at - 60_000) return row.access_token;
    return refreshAccessToken(db, row);
}

async function spotifyGet(url: string, token: string): Promise<{ ok: boolean; status: number; data: unknown }> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    let data: unknown;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
}

async function musicBrainzLookup(isrc: string): Promise<{ mbid?: string; tags?: string[] }> {
    try {
        const url = `https://musicbrainz.org/ws/2/recording?query=isrc:${encodeURIComponent(isrc)}&fmt=json&limit=1`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Musicologia/1.0 (fluxy-workspace)' } });
        if (!res.ok) return {};
        const data = await res.json() as { recordings?: Array<{ id?: string; tags?: Array<{ name: string }> }> };
        const rec = data.recordings?.[0];
        if (!rec) return {};
        return {
            mbid: rec.id,
            tags: rec.tags?.map(t => t.name) ?? [],
        };
    } catch {
        return {};
    }
}

interface SpotifyTrack {
    id: string;
    name: string;
    artists: Array<{ id: string; name: string }>;
    album: { name: string; images: Array<{ url: string; width: number; height: number }> };
    duration_ms: number;
    popularity: number;
    external_ids?: { isrc?: string };
}

interface SpotifyAudioFeatures {
    tempo: number;
    key: number;
    mode: number;
    energy: number;
    valence: number;
    danceability: number;
    acousticness: number;
    instrumentalness: number;
    liveness: number;
    loudness: number;
    speechiness: number;
    time_signature: number;
}

async function importSpotifyTrack(
    db: InstanceType<typeof Database>,
    token: string,
    spotifyId: string
): Promise<{ track: Record<string, unknown>; isNew: boolean }> {
    // 1. Fetch track metadata
    const trackRes = await spotifyGet(`https://api.spotify.com/v1/tracks/${spotifyId}`, token);
    if (!trackRes.ok) throw new Error(`Spotify track fetch failed: ${trackRes.status}`);
    const sp = trackRes.data as SpotifyTrack;

    const title = sp.name;
    const artist = sp.artists.map(a => a.name).join(', ');
    const artistSlug = toSlug(sp.artists[0]?.name ?? 'unknown');
    const trackSlug = toSlug(title);
    const coverUrl = sp.album?.images?.find(i => i.width >= 300)?.url ?? sp.album?.images?.[0]?.url ?? null;
    const isrc = sp.external_ids?.isrc ?? null;

    // 2. Fetch audio features (gracefully handled — API may not be available)
    let features: SpotifyAudioFeatures | null = null;
    try {
        const featRes = await spotifyGet(`https://api.spotify.com/v1/audio-features/${spotifyId}`, token);
        if (featRes.ok) features = featRes.data as SpotifyAudioFeatures;
    } catch { /* audio features unavailable */ }

    // 3. MusicBrainz enrichment
    let mbid: string | null = null;
    let mbTags: string[] | null = null;
    if (isrc) {
        const mb = await musicBrainzLookup(isrc);
        mbid = mb.mbid ?? null;
        mbTags = mb.tags ?? null;
    }

    // 4. Upsert into tracks
    const sourceIds = JSON.stringify({ spotify_id: spotifyId, musicbrainz_id: mbid, isrc });

    const existing = db.prepare(
        `SELECT id FROM tracks WHERE JSON_EXTRACT(source_ids,'$.spotify_id') = ?`
    ).get(spotifyId) as { id: number } | undefined;

    let trackId: number;
    let isNew: boolean;

    if (existing) {
        db.prepare(
            `UPDATE tracks SET title=?, artist=?, artist_slug=?, track_slug=?, cover_url=COALESCE(?,cover_url),
             duration_ms=COALESCE(?,duration_ms), source_ids=?, updated_at=datetime('now') WHERE id=?`
        ).run(title, artist, artistSlug, trackSlug, coverUrl, sp.duration_ms, sourceIds, existing.id);
        trackId = existing.id;
        isNew = false;
    } else {
        const r = db.prepare(
            `INSERT INTO tracks (title, artist, artist_slug, track_slug, cover_url, duration_ms, source_ids)
             VALUES (?,?,?,?,?,?,?)`
        ).run(title, artist, artistSlug, trackSlug, coverUrl, sp.duration_ms, sourceIds);
        trackId = Number(r.lastInsertRowid);
        isNew = true;
    }

    // 5. Upsert DNA (audio features)
    if (features) {
        const dnaExists = db.prepare(`SELECT id FROM track_dna WHERE track_id = ?`).get(trackId);
        if (dnaExists) {
            db.prepare(
                `UPDATE track_dna SET tempo=?,key=?,mode=?,energy=?,valence=?,danceability=?,
                 loudness=?,acousticness=?,instrumentalness=?,liveness=?,speechiness=?,time_signature=?,
                 updated_at=datetime('now') WHERE track_id=?`
            ).run(features.tempo, features.key, features.mode, features.energy, features.valence,
                features.danceability, features.loudness, features.acousticness, features.instrumentalness,
                features.liveness, features.speechiness, features.time_signature, trackId);
        } else {
            db.prepare(
                `INSERT INTO track_dna (track_id, tempo, key, mode, energy, valence, danceability,
                 loudness, acousticness, instrumentalness, liveness, speechiness, time_signature)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
            ).run(trackId, features.tempo, features.key, features.mode, features.energy, features.valence,
                features.danceability, features.loudness, features.acousticness, features.instrumentalness,
                features.liveness, features.speechiness, features.time_signature);
        }
    }

    // 6. Store MB tags in lore if any
    if (mbTags && mbTags.length > 0) {
        const loreExists = db.prepare(`SELECT id FROM track_lore WHERE track_id = ?`).get(trackId);
        if (!loreExists) {
            db.prepare(
                `INSERT INTO track_lore (track_id, themes) VALUES (?, ?)`
            ).run(trackId, JSON.stringify(mbTags.slice(0, 10)));
        }
    }

    const track = db.prepare(
        `SELECT t.*, d.tempo, d.key, d.mode, d.energy, d.valence, d.danceability, d.loudness
         FROM tracks t LEFT JOIN track_dna d ON d.track_id = t.id WHERE t.id = ?`
    ).get(trackId) as Record<string, unknown>;
    return { track, isNew };
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createRouter(db: InstanceType<typeof Database>) {
    const router = Router();

    const CLIENT_ID = () => process.env.SPOTIFY_CLIENT_ID || '';
    const CLIENT_SECRET = () => process.env.SPOTIFY_CLIENT_SECRET || '';
    const REDIRECT_URI = () => process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/app/api/musicologia/auth/spotify/callback';

    // ── Spotify OAuth ──────────────────────────────────────────────────────────

    router.get('/api/musicologia/auth/spotify/status', (_req, res) => {
        const row = getStoredToken(db);
        if (!row) return res.json({ connected: false });
        const expired = Date.now() >= row.expires_at - 60_000;
        res.json({ connected: true, expired, expires_at: row.expires_at });
    });

    router.get('/api/musicologia/auth/spotify', (_req, res) => {
        if (!CLIENT_ID()) return res.status(500).json({ error: 'SPOTIFY_CLIENT_ID not set in .env' });
        const url = new URL('https://accounts.spotify.com/authorize');
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', CLIENT_ID());
        url.searchParams.set('redirect_uri', REDIRECT_URI());
        url.searchParams.set('scope', 'user-read-private playlist-read-private playlist-read-collaborative');
        url.searchParams.set('show_dialog', 'false');
        res.redirect(url.toString());
    });

    router.get('/api/musicologia/auth/spotify/callback', async (req, res) => {
        const code = req.query.code as string;
        const error = req.query.error as string;
        if (error || !code) return res.redirect('/app/musicologia?spotify_error=' + (error || 'missing_code'));

        const basic = Buffer.from(`${CLIENT_ID()}:${CLIENT_SECRET()}`).toString('base64');
        try {
            const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI() }),
            });
            if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
            const data = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string };

            const expiresAt = Date.now() + data.expires_in * 1000;
            db.prepare('DELETE FROM musicologia_spotify_tokens').run();
            db.prepare(
                `INSERT INTO musicologia_spotify_tokens (access_token, refresh_token, expires_at, scope) VALUES (?,?,?,?)`
            ).run(data.access_token, data.refresh_token, expiresAt, data.scope ?? null);

            res.redirect('/app/musicologia?spotify_connected=1');
        } catch (err) {
            console.error('Spotify OAuth callback error:', err);
            res.redirect('/app/musicologia?spotify_error=callback_failed');
        }
    });

    router.delete('/api/musicologia/auth/spotify', (_req, res) => {
        db.prepare('DELETE FROM musicologia_spotify_tokens').run();
        res.json({ ok: true });
    });

    // ── Search ─────────────────────────────────────────────────────────────────

    router.get('/api/musicologia/search', async (req, res) => {
        const q = String(req.query.q ?? '').trim();
        if (!q) return res.json({ tracks: [] });

        const token = await getValidToken(db);
        if (!token) return res.status(401).json({ error: 'Spotify not connected. Connect at /musicologia settings.' });

        const url = `https://api.spotify.com/v1/search?${new URLSearchParams({ q, type: 'track', limit: '20' })}`;
        const { ok, status, data } = await spotifyGet(url, token);
        if (!ok) return res.status(status).json({ error: 'Spotify search failed', detail: data });

        const typed = data as { tracks?: { items?: SpotifyTrack[] } };
        const items = typed.tracks?.items ?? [];
        const results = items.map(t => ({
            spotify_id: t.id,
            title: t.name,
            artist: t.artists.map(a => a.name).join(', '),
            album: t.album?.name ?? null,
            cover_url: t.album?.images?.find(i => i.width >= 300)?.url ?? t.album?.images?.[0]?.url ?? null,
            duration_ms: t.duration_ms,
            popularity: t.popularity,
            isrc: t.external_ids?.isrc ?? null,
        }));
        res.json({ tracks: results });
    });

    // ── Import single track ────────────────────────────────────────────────────

    router.post('/api/musicologia/import/spotify/:spotifyId', async (req, res) => {
        const { spotifyId } = req.params;
        const token = await getValidToken(db);
        if (!token) return res.status(401).json({ error: 'Spotify not connected' });

        try {
            const result = await importSpotifyTrack(db, token, spotifyId);
            res.status(result.isNew ? 201 : 200).json(result);
        } catch (err) {
            console.error('Import track error:', err);
            res.status(500).json({ error: String(err) });
        }
    });

    // ── Import playlist (SSE streaming) ───────────────────────────────────────

    router.post('/api/musicologia/import/spotify/playlist/:playlistId', async (req, res) => {
        let playlistId = req.params.playlistId;

        // Accept full Spotify playlist URLs too
        const urlMatch = playlistId.match(/playlist\/([A-Za-z0-9]+)/);
        if (urlMatch) playlistId = urlMatch[1];

        const token = await getValidToken(db);
        if (!token) return res.status(401).json({ error: 'Spotify not connected' });

        // Set up SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const send = (event: string, data: unknown) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
            // Fetch all tracks from playlist (paginated)
            const allItems: SpotifyTrack[] = [];
            let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&fields=next,total,items(track(id,name,artists,album,duration_ms,popularity,external_ids))`;

            while (nextUrl) {
                const { ok, status, data } = await spotifyGet(nextUrl, token);
                if (!ok) {
                    send('error', { message: `Failed to fetch playlist tracks: ${status}` });
                    res.end();
                    return;
                }
                const page = data as { next?: string | null; total?: number; items?: Array<{ track: SpotifyTrack | null }> };
                const items = (page.items ?? [])
                    .map(i => i.track)
                    .filter((t): t is SpotifyTrack => t != null && typeof t.id === 'string');
                allItems.push(...items);
                nextUrl = page.next ?? null;
            }

            send('start', { total: allItems.length });

            let imported = 0;
            let errors = 0;
            for (let i = 0; i < allItems.length; i++) {
                const sp = allItems[i];
                try {
                    const result = await importSpotifyTrack(db, token, sp.id);
                    imported++;
                    send('progress', {
                        current: i + 1,
                        total: allItems.length,
                        imported,
                        errors,
                        track: { title: sp.name, artist: sp.artists.map(a => a.name).join(', '), isNew: result.isNew },
                    });
                } catch (err) {
                    errors++;
                    send('progress', {
                        current: i + 1,
                        total: allItems.length,
                        imported,
                        errors,
                        error: String(err),
                        track: { title: sp.name, artist: sp.artists.map(a => a.name).join(', '), isNew: false },
                    });
                }
                // Small delay to avoid Spotify rate limiting
                await new Promise(r => setTimeout(r, 100));
            }

            send('done', { total: allItems.length, imported, errors });
        } catch (err) {
            console.error('Playlist import error:', err);
            send('error', { message: String(err) });
        }

        res.end();
    });

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
