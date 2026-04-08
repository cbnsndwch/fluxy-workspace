import { Router } from 'express';
import type Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getSessionUser } from '../../auth/index.js';

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

// ── Claude OAuth helper ───────────────────────────────────────────────────────

function readClaudeToken(): string | null {
    try {
        const credFile = path.join(os.homedir(), '.claude', '.credentials.json');
        const creds = JSON.parse(fs.readFileSync(credFile, 'utf-8'));
        const oauth = creds.claudeAiOauth ?? creds;
        if (oauth.accessToken && (!oauth.expiresAt || Date.now() < oauth.expiresAt)) {
            return oauth.accessToken as string;
        }
    } catch {}
    return null;
}

const KEY_NAMES_LORE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function musicalKeyLabel(key: number | null, mode: number | null): string {
    if (key == null) return 'unknown key';
    const name = KEY_NAMES_LORE[key] ?? 'Unknown';
    return `${name} ${mode === 0 ? 'minor' : 'major'}`;
}

function tempoLabel(tempo: number | null): string {
    if (tempo == null) return 'unknown tempo';
    if (tempo < 70) return `slow (${Math.round(tempo)} BPM)`;
    if (tempo < 120) return `mid-tempo (${Math.round(tempo)} BPM)`;
    return `fast (${Math.round(tempo)} BPM)`;
}

function energyValenceLabel(energy: number | null, valence: number | null): string {
    if (energy == null || valence == null) return 'unknown mood';
    const e = energy > 0.6 ? 'high energy' : energy > 0.35 ? 'moderate energy' : 'low energy';
    const v = valence > 0.6 ? 'uplifting' : valence > 0.35 ? 'mixed emotions' : 'melancholic';
    return `${e}, ${v}`;
}

interface LoreOutput {
    tagline: string;
    story: string;
    trivia: string[];
    themes: string[];
    credits: Array<{ role: string; name: string }>;
}

async function generateLoreWithClaude(
    title: string,
    artist: string,
    album: string | null,
    dna: {
        tempo?: number | null;
        key?: number | null;
        mode?: number | null;
        energy?: number | null;
        valence?: number | null;
        danceability?: number | null;
        acousticness?: number | null;
        instrumentalness?: number | null;
    } | null,
    genres: string[],
): Promise<LoreOutput | null> {
    const token = readClaudeToken();
    if (!token) return null;

    const keyLabel = musicalKeyLabel(dna?.key ?? null, dna?.mode ?? null);
    const tempoStr = tempoLabel(dna?.tempo ?? null);
    const moodStr = energyValenceLabel(dna?.energy ?? null, dna?.valence ?? null);
    const genreStr = genres.length > 0 ? genres.slice(0, 5).join(', ') : 'unknown genre';

    const prompt = `You are a music journalist writing liner notes. Generate rich, evocative narrative content for this track:

Track: "${title}"
Artist: ${artist}${album ? `\nAlbum: ${album}` : ''}
Musical key: ${keyLabel}
Tempo: ${tempoStr}
Mood profile: ${moodStr}
Genres: ${genreStr}${dna?.danceability != null ? `\nDanceability: ${Math.round(dna.danceability * 100)}%` : ''}${dna?.acousticness != null ? `\nAcousticness: ${Math.round(dna.acousticness * 100)}%` : ''}${dna?.instrumentalness != null ? `\nInstrumentalness: ${Math.round(dna.instrumentalness * 100)}%` : ''}

Generate a JSON object with exactly these fields:
- "tagline": A single evocative sentence (max 12 words) that captures the essence of this track
- "story": 3–4 paragraphs of narrative prose. Reference the musical key and mode (${keyLabel} = ${(dna?.mode ?? 1) === 0 ? 'introspective, dark' : 'bright, resolute'}), the ${moodStr} character, and the ${tempoStr} pace. Write like a music journalist — evocative, specific, authoritative.
- "trivia": Array of exactly 5 interesting facts or observations about the track, artist, or musical elements
- "themes": Array of 4–7 thematic keywords (e.g. "nostalgia", "rebellion", "urban longing")
- "credits": Array of objects {role, name} — generate plausible creative credits based on genre and style (producer, mixer, arranger, etc.). Use "${artist}" for the primary role.

Return ONLY the raw JSON object, no markdown, no explanation.`;

    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'oauth-2025-04-20',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'claude-opus-4-5',
                max_tokens: 1200,
                messages: [{ role: 'user', content: prompt }],
            }),
            signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) return null;
        const data = await res.json() as { content?: Array<{ text?: string }> };
        const text = data.content?.[0]?.text ?? '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        const lore = JSON.parse(match[0]) as LoreOutput;
        if (!lore.tagline || !lore.story) return null;
        return lore;
    } catch {
        return null;
    }
}

function derivePalette(dna: {
    energy?: number | null;
    valence?: number | null;
    tempo?: number | null;
    acousticness?: number | null;
    danceability?: number | null;
} | null): string[] {
    // Derive 5 hex colors from audio features
    const energy = dna?.energy ?? 0.5;
    const valence = dna?.valence ?? 0.5;
    const tempo = dna?.tempo ?? 120;
    const acousticness = dna?.acousticness ?? 0.5;

    // energy → saturation (low energy = muted, high energy = vivid)
    const sat = Math.round(20 + energy * 75); // 20–95%

    // valence → warm (high) vs cool (low) hue
    // warm: 0–60 (red-yellow), cool: 180–270 (blue-green-purple)
    const baseHue = valence > 0.5
        ? Math.round(valence * 60)          // warm: 0–60
        : Math.round(180 + (1 - valence) * 90); // cool: 180–270

    // tempo → contrast/lightness spread
    const tempoFactor = Math.min(1, tempo / 180);
    const lightnessSpread = 15 + tempoFactor * 25;

    // acousticness → earthy modifier
    const hueShift = acousticness > 0.6 ? 20 : 0; // shift toward earthy tones

    function hslToHex(h: number, s: number, l: number): string {
        h = ((h % 360) + 360) % 360;
        s = Math.max(0, Math.min(100, s));
        l = Math.max(5, Math.min(95, l));
        const hNorm = h / 360, sNorm = s / 100, lNorm = l / 100;
        const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
        const p = 2 * lNorm - q;
        const rgb = [hNorm + 1 / 3, hNorm, hNorm - 1 / 3].map(t => {
            t = ((t % 1) + 1) % 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        });
        return '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    }

    const mid = 50;
    return [
        hslToHex(baseHue + hueShift, sat, mid - lightnessSpread),           // deep
        hslToHex(baseHue + hueShift + 15, sat - 5, mid - lightnessSpread / 2), // shade
        hslToHex(baseHue + hueShift + 30, sat - 10, mid),                   // mid
        hslToHex(baseHue + hueShift + 45, sat - 15, mid + lightnessSpread / 2), // tint
        hslToHex(baseHue + hueShift + 60, sat - 20, mid + lightnessSpread), // light
    ];
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
        url.searchParams.set('scope', 'user-read-private playlist-read-private playlist-read-collaborative streaming user-modify-playback-state user-read-playback-state');
        url.searchParams.set('show_dialog', 'false');
        res.redirect(url.toString());
    });

    // Return the current valid Spotify access token (for Web Playback SDK)
    router.get('/api/musicologia/spotify/token', async (_req, res) => {
        const token = await getValidToken(db);
        if (!token) return res.status(404).json({ error: 'Not connected' });
        const row = getStoredToken(db);
        res.json({ access_token: token, scope: row?.scope ?? '' });
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

        const trackId = (track as { id: number }).id;
        const dna = db.prepare(`SELECT * FROM track_dna WHERE track_id = ?`).get(trackId);
        const lore = db.prepare(`SELECT * FROM track_lore WHERE track_id = ?`).get(trackId);
        const sections = db.prepare(`SELECT sections FROM track_sections WHERE track_id = ?`).get(trackId);
        const lyrics = db.prepare(`SELECT * FROM track_lyrics WHERE track_id = ? ORDER BY start_ms`).all(trackId);
        const lrcLyrics = db.prepare(`SELECT id, time_seconds, text, line_index FROM track_lyrics_lrc WHERE track_id = ? ORDER BY time_seconds ASC`).all(trackId);

        res.json({ track, dna, lore, sections, lyrics, lrcLyrics });
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

    // ── AI Lore Generation ─────────────────────────────────────────────────────

    router.post('/api/musicologia/tracks/:id/generate-lore', async (req, res) => {
        const trackId = req.params.id;
        const track = db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(trackId) as Record<string, unknown> | undefined;
        if (!track) return res.status(404).json({ error: 'Track not found' });

        const dna = db.prepare(`SELECT * FROM track_dna WHERE track_id = ?`).get(trackId) as Record<string, unknown> | null;
        const sourceIds = JSON.parse((track.source_ids as string) || '{}') as Record<string, string>;
        const spotifyId = sourceIds.spotify_id;

        // Fetch genres from Spotify if we have a spotify_id and a valid token
        let genres: string[] = [];
        try {
            const token = await getValidToken(db);
            if (token && spotifyId) {
                const trackRes = await spotifyGet(`https://api.spotify.com/v1/tracks/${spotifyId}`, token);
                if (trackRes.ok) {
                    const sp = trackRes.data as { artists?: Array<{ id: string }> };
                    const artistId = sp.artists?.[0]?.id;
                    if (artistId) {
                        const artistRes = await spotifyGet(`https://api.spotify.com/v1/artists/${artistId}`, token);
                        if (artistRes.ok) {
                            genres = ((artistRes.data as { genres?: string[] }).genres ?? []).slice(0, 5);
                        }
                    }
                }
            }
        } catch { /* genres optional */ }

        const loreOutput = await generateLoreWithClaude(
            track.title as string,
            track.artist as string,
            null,
            dna ? {
                tempo: dna.tempo as number | null,
                key: dna.key as number | null,
                mode: dna.mode as number | null,
                energy: dna.energy as number | null,
                valence: dna.valence as number | null,
                danceability: dna.danceability as number | null,
                acousticness: dna.acousticness as number | null,
                instrumentalness: dna.instrumentalness as number | null,
            } : null,
            genres,
        );

        if (!loreOutput) {
            return res.status(503).json({ error: 'Lore generation failed. Claude token may be unavailable.' });
        }

        const existing = db.prepare(`SELECT id FROM track_lore WHERE track_id = ?`).get(trackId);
        if (existing) {
            db.prepare(
                `UPDATE track_lore SET tagline=?,story=?,trivia=?,themes=?,credits=?,updated_at=datetime('now') WHERE track_id=?`
            ).run(
                loreOutput.tagline, loreOutput.story,
                JSON.stringify(loreOutput.trivia),
                JSON.stringify(loreOutput.themes),
                JSON.stringify(loreOutput.credits),
                trackId,
            );
        } else {
            db.prepare(
                `INSERT INTO track_lore (track_id, tagline, story, trivia, themes, credits) VALUES (?,?,?,?,?,?)`
            ).run(
                trackId, loreOutput.tagline, loreOutput.story,
                JSON.stringify(loreOutput.trivia),
                JSON.stringify(loreOutput.themes),
                JSON.stringify(loreOutput.credits),
            );
        }

        res.json(db.prepare(`SELECT * FROM track_lore WHERE track_id = ?`).get(trackId));
    });

    router.post('/api/musicologia/tracks/:id/generate-palette', async (req, res) => {
        const trackId = req.params.id;
        const track = db.prepare(`SELECT id FROM tracks WHERE id = ?`).get(trackId);
        if (!track) return res.status(404).json({ error: 'Track not found' });

        const dna = db.prepare(`SELECT * FROM track_dna WHERE track_id = ?`).get(trackId) as Record<string, unknown> | null;
        const palette = derivePalette(dna ? {
            energy: dna.energy as number | null,
            valence: dna.valence as number | null,
            tempo: dna.tempo as number | null,
            acousticness: dna.acousticness as number | null,
            danceability: dna.danceability as number | null,
        } : null);

        if (dna) {
            db.prepare(
                `UPDATE track_dna SET palette=?,updated_at=datetime('now') WHERE track_id=?`
            ).run(JSON.stringify(palette), trackId);
        } else {
            db.prepare(
                `INSERT INTO track_dna (track_id, palette) VALUES (?,?)`
            ).run(trackId, JSON.stringify(palette));
        }

        res.json({ palette });
    });

    router.post('/api/musicologia/admin/batch-generate', async (req, res) => {
        const { trackIds } = req.body as { trackIds?: number[] };
        if (!Array.isArray(trackIds) || trackIds.length === 0) {
            return res.status(400).json({ error: 'trackIds array required' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

        const total = trackIds.length;
        let done = 0;

        for (const trackId of trackIds) {
            const track = db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(trackId) as Record<string, unknown> | undefined;
            if (!track) {
                done++;
                send({ trackId, status: 'skipped', done, total });
                continue;
            }

            send({ trackId, status: 'generating', done, total });

            try {
                const dna = db.prepare(`SELECT * FROM track_dna WHERE track_id = ?`).get(trackId) as Record<string, unknown> | null;
                const sourceIds = JSON.parse((track.source_ids as string) || '{}') as Record<string, string>;
                const spotifyId = sourceIds.spotify_id;

                let genres: string[] = [];
                try {
                    const token = await getValidToken(db);
                    if (token && spotifyId) {
                        const trackRes = await spotifyGet(`https://api.spotify.com/v1/tracks/${spotifyId}`, token);
                        if (trackRes.ok) {
                            const sp = trackRes.data as { artists?: Array<{ id: string }> };
                            const artistId = sp.artists?.[0]?.id;
                            if (artistId) {
                                const artistRes = await spotifyGet(`https://api.spotify.com/v1/artists/${artistId}`, token);
                                if (artistRes.ok) {
                                    genres = ((artistRes.data as { genres?: string[] }).genres ?? []).slice(0, 5);
                                }
                            }
                        }
                    }
                } catch { /* genres optional */ }

                const loreOutput = await generateLoreWithClaude(
                    track.title as string,
                    track.artist as string,
                    null,
                    dna ? {
                        tempo: dna.tempo as number | null,
                        key: dna.key as number | null,
                        mode: dna.mode as number | null,
                        energy: dna.energy as number | null,
                        valence: dna.valence as number | null,
                        danceability: dna.danceability as number | null,
                        acousticness: dna.acousticness as number | null,
                        instrumentalness: dna.instrumentalness as number | null,
                    } : null,
                    genres,
                );

                if (loreOutput) {
                    const existing = db.prepare(`SELECT id FROM track_lore WHERE track_id = ?`).get(trackId);
                    if (existing) {
                        db.prepare(
                            `UPDATE track_lore SET tagline=?,story=?,trivia=?,themes=?,credits=?,updated_at=datetime('now') WHERE track_id=?`
                        ).run(
                            loreOutput.tagline, loreOutput.story,
                            JSON.stringify(loreOutput.trivia), JSON.stringify(loreOutput.themes),
                            JSON.stringify(loreOutput.credits), trackId,
                        );
                    } else {
                        db.prepare(
                            `INSERT INTO track_lore (track_id, tagline, story, trivia, themes, credits) VALUES (?,?,?,?,?,?)`
                        ).run(
                            trackId, loreOutput.tagline, loreOutput.story,
                            JSON.stringify(loreOutput.trivia), JSON.stringify(loreOutput.themes),
                            JSON.stringify(loreOutput.credits),
                        );
                    }
                    done++;
                    send({ trackId, status: 'done', done, total });
                } else {
                    done++;
                    send({ trackId, status: 'failed', done, total });
                }
            } catch (err) {
                done++;
                send({ trackId, status: 'failed', error: String(err), done, total });
            }

            // Small delay between requests to avoid rate limiting
            await new Promise(r => setTimeout(r, 500));
        }

        send({ trackId: null, status: 'complete', done, total });
        res.end();
    });

    // ── LRC Lyrics ────────────────────────────────────────────────────────────

    // Ensure the time-based lyrics table exists
    db.exec(`
        CREATE TABLE IF NOT EXISTS track_lyrics_lrc (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            time_seconds REAL NOT NULL,
            text        TEXT NOT NULL,
            line_index  INTEGER NOT NULL DEFAULT 0
        )
    `);

    router.get('/api/musicologia/tracks/:id/lyrics', (req, res) => {
        const trackId = req.params.id;
        const rows = db.prepare(
            `SELECT id, time_seconds, text, line_index FROM track_lyrics_lrc WHERE track_id = ? ORDER BY time_seconds ASC`
        ).all(trackId);
        res.json(rows);
    });

    router.post('/api/musicologia/tracks/:id/lyrics', (req, res) => {
        const trackId = req.params.id;
        const { lrc } = req.body as { lrc?: string };
        if (typeof lrc !== 'string') return res.status(400).json({ error: 'lrc string required' });

        // Parse LRC: [mm:ss.xx] text  or  [mm:ss] text
        const lrcPattern = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/;
        const lines: Array<{ time_seconds: number; text: string; line_index: number }> = [];
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

        const del = db.prepare(`DELETE FROM track_lyrics_lrc WHERE track_id = ?`);
        const ins = db.prepare(`INSERT INTO track_lyrics_lrc (track_id, time_seconds, text, line_index) VALUES (?,?,?,?)`);
        const insertAll = db.transaction(() => {
            del.run(trackId);
            for (const l of lines) {
                ins.run(trackId, l.time_seconds, l.text, l.line_index);
            }
        });
        insertAll();
        res.json({ count: lines.length });
    });

    // ── Community: helper ─────────────────────────────────────────────────────

    function writeActivity(
        actorId: number,
        verb: string,
        objectType: string,
        objectId: number,
        objectTitle: string | null,
        meta: Record<string, unknown> | null = null,
    ) {
        try {
            db.prepare(
                `INSERT INTO music_activity_feed (actor_id, verb, object_type, object_id, object_title, meta)
                 VALUES (?, ?, ?, ?, ?, ?)`
            ).run(actorId, verb, objectType, objectId, objectTitle, meta ? JSON.stringify(meta) : null);
        } catch { /* non-critical */ }
    }

    // ── Community: Follow system ───────────────────────────────────────────────

    router.get('/api/musicologia/users/:userId/followers', (req, res) => {
        const { userId } = req.params;
        const rows = db.prepare(
            `SELECT u.id, u.login, u.name, u.avatar_url,
                    (SELECT COUNT(*) FROM tracks WHERE 0=1) as track_count
             FROM music_follows f JOIN users u ON u.id = f.follower_id
             WHERE f.following_id = ? ORDER BY f.created_at DESC`
        ).all(userId);
        res.json(rows);
    });

    router.get('/api/musicologia/users/:userId/following', (req, res) => {
        const { userId } = req.params;
        const rows = db.prepare(
            `SELECT u.id, u.login, u.name, u.avatar_url
             FROM music_follows f JOIN users u ON u.id = f.following_id
             WHERE f.follower_id = ? ORDER BY f.created_at DESC`
        ).all(userId);
        res.json(rows);
    });

    router.post('/api/musicologia/users/:userId/follow', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });
        const targetId = Number(req.params.userId);
        if (me.id === targetId) return res.status(400).json({ error: 'Cannot follow yourself' });

        const target = db.prepare(`SELECT id, login, name FROM users WHERE id = ?`).get(targetId) as { id: number; login: string; name: string | null } | undefined;
        if (!target) return res.status(404).json({ error: 'User not found' });

        db.prepare(
            `INSERT OR IGNORE INTO music_follows (follower_id, following_id) VALUES (?, ?)`
        ).run(me.id, targetId);

        writeActivity(me.id, 'followed', 'user', targetId, target.name ?? target.login);
        res.json({ ok: true });
    });

    router.delete('/api/musicologia/users/:userId/follow', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });
        db.prepare(`DELETE FROM music_follows WHERE follower_id = ? AND following_id = ?`).run(me.id, Number(req.params.userId));
        res.json({ ok: true });
    });

    // Check if current user follows a given user
    router.get('/api/musicologia/users/:userId/follow-status', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.json({ following: false });
        const row = db.prepare(
            `SELECT 1 FROM music_follows WHERE follower_id = ? AND following_id = ?`
        ).get(me.id, Number(req.params.userId));
        res.json({ following: !!row });
    });

    // ── Community: Activity Feed ───────────────────────────────────────────────

    router.get('/api/musicologia/feed/global', (req, res) => {
        const limit = Math.min(Number(req.query.limit ?? 50), 100);
        const offset = Number(req.query.offset ?? 0);
        const rows = db.prepare(
            `SELECT a.id, a.verb, a.object_type, a.object_id, a.object_title, a.meta, a.created_at,
                    u.id as actor_id, u.login as actor_login, u.name as actor_name, u.avatar_url as actor_avatar
             FROM music_activity_feed a
             LEFT JOIN users u ON u.id = a.actor_id
             ORDER BY a.created_at DESC
             LIMIT ? OFFSET ?`
        ).all(limit, offset);
        res.json(rows.map(formatActivity));
    });

    router.get('/api/musicologia/feed', (req, res) => {
        const me = getSessionUser(db, req);
        const limit = Math.min(Number(req.query.limit ?? 50), 100);
        const offset = Number(req.query.offset ?? 0);

        if (!me) {
            // Not logged in — return global feed
            const rows = db.prepare(
                `SELECT a.id, a.verb, a.object_type, a.object_id, a.object_title, a.meta, a.created_at,
                        u.id as actor_id, u.login as actor_login, u.name as actor_name, u.avatar_url as actor_avatar
                 FROM music_activity_feed a
                 LEFT JOIN users u ON u.id = a.actor_id
                 ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
            ).all(limit, offset);
            return res.json(rows.map(formatActivity));
        }

        // Following feed: activities from users I follow
        const rows = db.prepare(
            `SELECT a.id, a.verb, a.object_type, a.object_id, a.object_title, a.meta, a.created_at,
                    u.id as actor_id, u.login as actor_login, u.name as actor_name, u.avatar_url as actor_avatar
             FROM music_activity_feed a
             LEFT JOIN users u ON u.id = a.actor_id
             WHERE a.actor_id IN (
                 SELECT following_id FROM music_follows WHERE follower_id = ?
             )
             ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
        ).all(me.id, limit, offset);
        res.json(rows.map(formatActivity));
    });

    function formatActivity(row: Record<string, unknown>) {
        return {
            id: row.id,
            verb: row.verb,
            object_type: row.object_type,
            object_id: row.object_id,
            object_title: row.object_title,
            meta: row.meta ? (() => { try { return JSON.parse(row.meta as string); } catch { return null; } })() : null,
            created_at: row.created_at,
            actor: {
                id: row.actor_id,
                login: row.actor_login,
                name: row.actor_name,
                avatar_url: row.actor_avatar,
            },
        };
    }

    // ── Community: Reactions ───────────────────────────────────────────────────

    router.get('/api/musicologia/tracks/:id/reactions', (req, res) => {
        const me = getSessionUser(db, req);
        const trackId = Number(req.params.id);

        const counts = db.prepare(
            `SELECT emoji, COUNT(*) as count FROM music_reactions WHERE track_id = ? GROUP BY emoji`
        ).all(trackId) as Array<{ emoji: string; count: number }>;

        const myReaction = me
            ? (db.prepare(`SELECT emoji FROM music_reactions WHERE user_id = ? AND track_id = ?`).get(me.id, trackId) as { emoji: string } | undefined)?.emoji ?? null
            : null;

        const emojiList = ['🔥', '❤️', '😭', '🎵', '✨', '🤯'];
        const result: Record<string, { count: number; reacted: boolean }> = {};
        for (const e of emojiList) {
            const found = counts.find(c => c.emoji === e);
            result[e] = { count: found?.count ?? 0, reacted: myReaction === e };
        }
        res.json(result);
    });

    router.post('/api/musicologia/tracks/:id/reactions', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });

        const trackId = Number(req.params.id);
        const track = db.prepare(`SELECT id, title, artist FROM tracks WHERE id = ?`).get(trackId) as { id: number; title: string; artist: string } | undefined;
        if (!track) return res.status(404).json({ error: 'Track not found' });

        const { emoji } = req.body as { emoji?: string };
        const valid = ['🔥', '❤️', '😭', '🎵', '✨', '🤯'];
        if (!emoji || !valid.includes(emoji)) return res.status(400).json({ error: 'Invalid emoji' });

        const existing = db.prepare(`SELECT emoji FROM music_reactions WHERE user_id = ? AND track_id = ?`).get(me.id, trackId) as { emoji: string } | undefined;

        if (existing?.emoji === emoji) {
            // Toggle off
            db.prepare(`DELETE FROM music_reactions WHERE user_id = ? AND track_id = ?`).run(me.id, trackId);
            return res.json({ toggled: 'off', emoji });
        }

        // Upsert reaction
        db.prepare(
            `INSERT OR REPLACE INTO music_reactions (user_id, track_id, emoji) VALUES (?, ?, ?)`
        ).run(me.id, trackId, emoji);

        // Activity: loved (🔥 or ❤️ → loved, others → reacted)
        writeActivity(me.id, 'loved', 'track', track.id, `${track.title} — ${track.artist}`, { emoji });

        res.json({ toggled: 'on', emoji });
    });

    // ── Community: Comments ────────────────────────────────────────────────────

    router.get('/api/musicologia/comments', (req, res) => {
        const targetType = String(req.query.target_type ?? '');
        const targetId = Number(req.query.target_id ?? 0);
        if (!targetType || !targetId) return res.status(400).json({ error: 'target_type and target_id required' });

        const rows = db.prepare(
            `SELECT c.id, c.user_id, c.user_name, c.user_avatar, c.body, c.parent_id, c.created_at,
                    u.login as user_login, u.name as user_display_name, u.avatar_url as user_avatar_url
             FROM music_comments c
             LEFT JOIN users u ON u.id = c.user_id
             WHERE c.target_type = ? AND c.target_id = ?
             ORDER BY c.created_at ASC`
        ).all(targetType, targetId) as Array<Record<string, unknown>>;

        // Build nested tree
        const byId = new Map<number, Record<string, unknown>>();
        const roots: Array<Record<string, unknown>> = [];
        for (const row of rows) {
            const item = {
                ...row,
                user_name: row.user_display_name ?? row.user_name ?? row.user_login ?? 'Unknown',
                user_avatar: row.user_avatar_url ?? row.user_avatar ?? null,
                replies: [] as Array<Record<string, unknown>>,
            };
            byId.set(row.id as number, item);
        }
        for (const item of byId.values()) {
            if (item.parent_id) {
                const parent = byId.get(item.parent_id as number);
                if (parent) (parent.replies as Array<Record<string, unknown>>).push(item);
                else roots.push(item);
            } else {
                roots.push(item);
            }
        }
        res.json(roots);
    });

    router.post('/api/musicologia/comments', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });

        const { target_type, target_id, body, parent_id } = req.body as {
            target_type?: string;
            target_id?: number;
            body?: string;
            parent_id?: number | null;
        };

        if (!target_type || !target_id || !body?.trim()) {
            return res.status(400).json({ error: 'target_type, target_id, body required' });
        }

        const r = db.prepare(
            `INSERT INTO music_comments (user_id, user_name, user_avatar, target_type, target_id, body, parent_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(me.id, me.name ?? me.login, me.avatar_url, target_type, target_id, body.trim(), parent_id ?? null);

        const comment = db.prepare(`SELECT * FROM music_comments WHERE id = ?`).get(r.lastInsertRowid) as Record<string, unknown>;

        // Activity: commented
        if (!parent_id) {
            // Only log top-level comments
            let objectTitle: string | null = null;
            if (target_type === 'track') {
                const t = db.prepare(`SELECT title, artist FROM tracks WHERE id = ?`).get(target_id) as { title: string; artist: string } | undefined;
                if (t) objectTitle = `${t.title} — ${t.artist}`;
            }
            writeActivity(me.id, 'commented', target_type, target_id, objectTitle);
        }

        res.status(201).json({ ...comment, user_name: me.name ?? me.login, user_avatar: me.avatar_url, replies: [] });
    });

    router.delete('/api/musicologia/comments/:id', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });

        const commentId = Number(req.params.id);
        const comment = db.prepare(`SELECT user_id FROM music_comments WHERE id = ?`).get(commentId) as { user_id: number } | undefined;
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        if (comment.user_id !== me.id) return res.status(403).json({ error: 'Not your comment' });

        db.prepare(`DELETE FROM music_comments WHERE id = ?`).run(commentId);
        res.json({ ok: true });
    });

    // ── Tracks without lore (for admin batch UI) ───────────────────────────────

    router.get('/api/musicologia/admin/tracks-without-lore', (_req, res) => {
        const tracks = db.prepare(
            `SELECT t.id, t.title, t.artist, t.cover_url, t.artist_slug, t.track_slug,
                    d.energy, d.valence, d.tempo
             FROM tracks t
             LEFT JOIN track_dna d ON d.track_id = t.id
             LEFT JOIN track_lore l ON l.track_id = t.id
             WHERE l.id IS NULL OR l.tagline IS NULL
             ORDER BY t.created_at DESC`
        ).all();
        res.json({ tracks });
    });

    // ── Migrations for existing installs ─────────────────────────────────────

    for (const sql of [
        `ALTER TABLE music_comments ADD COLUMN user_name TEXT`,
        `ALTER TABLE music_comments ADD COLUMN user_avatar TEXT`,
        `ALTER TABLE music_activity_feed ADD COLUMN actor_name TEXT`,
        `ALTER TABLE music_activity_feed ADD COLUMN actor_avatar TEXT`,
    ]) {
        try { db.exec(sql); } catch { /* column already exists */ }
    }

    // ── Follow System ─────────────────────────────────────────────────────────

    router.get('/api/musicologia/users/:userId/followers', (req, res) => {
        const rows = db.prepare(
            `SELECT u.id, u.login, u.name, u.avatar_url, f.created_at
             FROM music_follows f
             JOIN users u ON u.id = f.follower_id
             WHERE f.following_id = ?
             ORDER BY f.created_at DESC`
        ).all(req.params.userId);
        res.json({ followers: rows });
    });

    router.get('/api/musicologia/users/:userId/following', (req, res) => {
        const rows = db.prepare(
            `SELECT u.id, u.login, u.name, u.avatar_url, f.created_at
             FROM music_follows f
             JOIN users u ON u.id = f.following_id
             WHERE f.follower_id = ?
             ORDER BY f.created_at DESC`
        ).all(req.params.userId);
        res.json({ following: rows });
    });

    router.post('/api/musicologia/users/:userId/follow', (req, res) => {
        const currentUser = getSessionUser(db, req);
        if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
        const followingId = Number(req.params.userId);
        if (currentUser.id === followingId) return res.status(400).json({ error: 'Cannot follow yourself' });

        try {
            db.prepare(
                `INSERT OR IGNORE INTO music_follows (follower_id, following_id) VALUES (?,?)`
            ).run(currentUser.id, followingId);

            // Log to activity feed
            const followed = db.prepare(`SELECT login, name FROM users WHERE id = ?`).get(followingId) as { login: string; name: string | null } | undefined;
            if (followed) {
                db.prepare(
                    `INSERT INTO music_activity_feed (actor_id, actor_name, actor_avatar, verb, object_type, object_id, object_title)
                     VALUES (?,?,?,?,?,?,?)`
                ).run(
                    currentUser.id, currentUser.name ?? currentUser.login, currentUser.avatar_url,
                    'followed', 'user', followingId, followed.name ?? followed.login
                );
            }

            res.json({ following: true });
        } catch (err) {
            res.status(500).json({ error: String(err) });
        }
    });

    router.delete('/api/musicologia/users/:userId/follow', (req, res) => {
        const currentUser = getSessionUser(db, req);
        if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
        db.prepare(`DELETE FROM music_follows WHERE follower_id=? AND following_id=?`).run(currentUser.id, Number(req.params.userId));
        res.json({ following: false });
    });

    // ── Activity Feed ─────────────────────────────────────────────────────────

    router.get('/api/musicologia/feed', (req, res) => {
        const currentUser = getSessionUser(db, req);
        if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
        const offset = Number(req.query.offset ?? 0);
        const rows = db.prepare(
            `SELECT a.*, u.login as actor_login, u.avatar_url as actor_avatar_url
             FROM music_activity_feed a
             LEFT JOIN users u ON u.id = a.actor_id
             WHERE a.actor_id IN (
               SELECT following_id FROM music_follows WHERE follower_id = ?
             )
             ORDER BY a.created_at DESC LIMIT 50 OFFSET ?`
        ).all(currentUser.id, offset);
        res.json({ activities: rows });
    });

    router.get('/api/musicologia/feed/global', (req, res) => {
        const offset = Number(req.query.offset ?? 0);
        const rows = db.prepare(
            `SELECT a.*, u.login as actor_login, u.avatar_url as actor_avatar_url
             FROM music_activity_feed a
             LEFT JOIN users u ON u.id = a.actor_id
             ORDER BY a.created_at DESC LIMIT 50 OFFSET ?`
        ).all(offset);
        res.json({ activities: rows });
    });

    // ── Reactions ─────────────────────────────────────────────────────────────

    const ALLOWED_EMOJIS = new Set(['🔥', '❤️', '😭', '🎵', '✨', '🤯']);

    router.get('/api/musicologia/tracks/:id/reactions', (req, res) => {
        const currentUser = getSessionUser(db, req);
        const trackId = req.params.id;

        const counts = db.prepare(
            `SELECT emoji, COUNT(*) as count FROM music_reactions WHERE track_id = ? GROUP BY emoji`
        ).all(trackId) as Array<{ emoji: string; count: number }>;

        let userReaction: string | null = null;
        if (currentUser) {
            const row = db.prepare(
                `SELECT emoji FROM music_reactions WHERE user_id = ? AND track_id = ?`
            ).get(currentUser.id, trackId) as { emoji: string } | undefined;
            userReaction = row?.emoji ?? null;
        }

        res.json({ counts, userReaction });
    });

    router.post('/api/musicologia/tracks/:id/reactions', (req, res) => {
        const currentUser = getSessionUser(db, req);
        if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

        const trackId = req.params.id;
        const { emoji } = req.body as { emoji?: string };
        if (!emoji || !ALLOWED_EMOJIS.has(emoji)) {
            return res.status(400).json({ error: 'Invalid emoji' });
        }

        const track = db.prepare(`SELECT id, title FROM tracks WHERE id = ?`).get(trackId) as { id: number; title: string } | undefined;
        if (!track) return res.status(404).json({ error: 'Track not found' });

        const existing = db.prepare(
            `SELECT emoji FROM music_reactions WHERE user_id = ? AND track_id = ?`
        ).get(currentUser.id, trackId) as { emoji: string } | undefined;

        if (existing && existing.emoji === emoji) {
            // Toggle off
            db.prepare(`DELETE FROM music_reactions WHERE user_id = ? AND track_id = ?`).run(currentUser.id, trackId);
            res.json({ userReaction: null });
        } else {
            // Set or replace reaction
            db.prepare(
                `INSERT OR REPLACE INTO music_reactions (user_id, track_id, emoji) VALUES (?,?,?)`
            ).run(currentUser.id, trackId, emoji);

            // Log to activity feed if new reaction
            if (!existing) {
                db.prepare(
                    `INSERT INTO music_activity_feed (actor_id, actor_name, actor_avatar, verb, object_type, object_id, object_title, meta)
                     VALUES (?,?,?,?,?,?,?,?)`
                ).run(
                    currentUser.id, currentUser.name ?? currentUser.login, currentUser.avatar_url,
                    'loved', 'track', track.id, track.title, JSON.stringify({ emoji })
                );
            }

            res.json({ userReaction: emoji });
        }
    });

    // ── Comments ──────────────────────────────────────────────────────────────

    router.get('/api/musicologia/comments', (req, res) => {
        const { target_type, target_id } = req.query as { target_type?: string; target_id?: string };
        if (!target_type || !target_id) return res.status(400).json({ error: 'target_type and target_id required' });

        const rows = db.prepare(
            `SELECT c.id, c.user_id, c.user_name, c.user_avatar, c.body, c.parent_id, c.created_at,
                    u.login as user_login, u.avatar_url as user_avatar_url
             FROM music_comments c
             LEFT JOIN users u ON u.id = c.user_id
             WHERE c.target_type = ? AND c.target_id = ?
             ORDER BY c.created_at ASC`
        ).all(target_type, target_id);
        res.json({ comments: rows });
    });

    router.post('/api/musicologia/comments', (req, res) => {
        const currentUser = getSessionUser(db, req);
        if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

        const { target_type, target_id, body, parent_id } = req.body as {
            target_type?: string;
            target_id?: number;
            body?: string;
            parent_id?: number | null;
        };

        if (!target_type || !target_id || !body?.trim()) {
            return res.status(400).json({ error: 'target_type, target_id, and body required' });
        }

        const r = db.prepare(
            `INSERT INTO music_comments (user_id, user_name, user_avatar, target_type, target_id, body, parent_id)
             VALUES (?,?,?,?,?,?,?)`
        ).run(
            currentUser.id,
            currentUser.name ?? currentUser.login,
            currentUser.avatar_url,
            target_type,
            target_id,
            body.trim(),
            parent_id ?? null
        );

        // Log to activity feed (top-level comments only)
        if (!parent_id) {
            let objectTitle: string | null = null;
            if (target_type === 'track') {
                const t = db.prepare(`SELECT title FROM tracks WHERE id = ?`).get(target_id) as { title: string } | undefined;
                objectTitle = t?.title ?? null;
            } else if (target_type === 'playlist') {
                const p = db.prepare(`SELECT title FROM playlists WHERE id = ?`).get(target_id) as { title: string } | undefined;
                objectTitle = p?.title ?? null;
            }
            db.prepare(
                `INSERT INTO music_activity_feed (actor_id, actor_name, actor_avatar, verb, object_type, object_id, object_title)
                 VALUES (?,?,?,?,?,?,?)`
            ).run(
                currentUser.id, currentUser.name ?? currentUser.login, currentUser.avatar_url,
                'commented', target_type, target_id, objectTitle
            );
        }

        const comment = db.prepare(
            `SELECT c.*, u.login as user_login, u.avatar_url as user_avatar_url
             FROM music_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`
        ).get(r.lastInsertRowid);

        res.json(comment);
    });

    router.delete('/api/musicologia/comments/:id', (req, res) => {
        const currentUser = getSessionUser(db, req);
        if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

        const comment = db.prepare(`SELECT user_id FROM music_comments WHERE id = ?`).get(req.params.id) as { user_id: number } | undefined;
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        if (comment.user_id !== currentUser.id) return res.status(403).json({ error: 'Not your comment' });

        db.prepare(`DELETE FROM music_comments WHERE id = ?`).run(req.params.id);
        res.json({ deleted: true });
    });

    // ── Community Tables ──────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS musicologia_follows (
            follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (follower_id, following_id)
        );
        CREATE TABLE IF NOT EXISTS musicologia_activity_feed (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id     INTEGER NOT NULL,
            actor_name   TEXT NOT NULL,
            actor_avatar TEXT,
            verb         TEXT NOT NULL,
            object_type  TEXT NOT NULL,
            object_id    TEXT NOT NULL,
            object_title TEXT,
            meta         TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS musicologia_reactions (
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            emoji      TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (user_id, track_id)
        );
        CREATE TABLE IF NOT EXISTS musicologia_comments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_name   TEXT NOT NULL,
            user_avatar TEXT,
            target_type TEXT NOT NULL,
            target_id   INTEGER NOT NULL,
            body        TEXT NOT NULL,
            parent_id   INTEGER REFERENCES musicologia_comments(id) ON DELETE CASCADE,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);

    // Helper: write to activity feed
    function writeActivity(
        actorId: number,
        actorName: string,
        actorAvatar: string | null,
        verb: string,
        objectType: string,
        objectId: string,
        objectTitle: string | null,
        meta?: Record<string, unknown>,
    ) {
        db.prepare(
            `INSERT INTO musicologia_activity_feed (actor_id, actor_name, actor_avatar, verb, object_type, object_id, object_title, meta)
             VALUES (?,?,?,?,?,?,?,?)`
        ).run(actorId, actorName, actorAvatar ?? null, verb, objectType, objectId, objectTitle ?? null, meta ? JSON.stringify(meta) : null);
    }

    // ── Follow routes ─────────────────────────────────────────────────────────

    router.get('/api/musicologia/users/:userId/followers', (req, res) => {
        const rows = db.prepare(
            `SELECT u.id, u.login, u.name, u.avatar_url, f.created_at
             FROM musicologia_follows f JOIN users u ON u.id = f.follower_id
             WHERE f.following_id = ? ORDER BY f.created_at DESC`
        ).all(req.params.userId);
        res.json(rows);
    });

    router.get('/api/musicologia/users/:userId/following', (req, res) => {
        const rows = db.prepare(
            `SELECT u.id, u.login, u.name, u.avatar_url, f.created_at
             FROM musicologia_follows f JOIN users u ON u.id = f.following_id
             WHERE f.follower_id = ? ORDER BY f.created_at DESC`
        ).all(req.params.userId);
        res.json(rows);
    });

    router.post('/api/musicologia/users/:userId/follow', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });
        const targetId = parseInt(req.params.userId, 10);
        if (me.id === targetId) return res.status(400).json({ error: 'Cannot follow yourself' });

        const target = db.prepare(`SELECT id, login, name, avatar_url FROM users WHERE id = ?`).get(targetId) as { id: number; login: string; name: string | null; avatar_url: string | null } | undefined;
        if (!target) return res.status(404).json({ error: 'User not found' });

        db.prepare(
            `INSERT OR IGNORE INTO musicologia_follows (follower_id, following_id) VALUES (?,?)`
        ).run(me.id, targetId);

        writeActivity(me.id, me.name ?? me.login, me.avatar_url ?? null, 'followed', 'user', String(targetId), target.name ?? target.login);
        res.json({ ok: true });
    });

    router.delete('/api/musicologia/users/:userId/follow', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });

        db.prepare(`DELETE FROM musicologia_follows WHERE follower_id = ? AND following_id = ?`).run(me.id, req.params.userId);
        res.json({ ok: true });
    });

    // ── Activity Feed ─────────────────────────────────────────────────────────

    router.get('/api/musicologia/feed', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });

        const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);
        const offset = parseInt(String(req.query.offset ?? '0'), 10);

        const rows = db.prepare(
            `SELECT a.*
             FROM musicologia_activity_feed a
             WHERE a.actor_id IN (SELECT following_id FROM musicologia_follows WHERE follower_id = ?)
             ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
        ).all(me.id, limit, offset);
        res.json(rows);
    });

    router.get('/api/musicologia/feed/global', (req, res) => {
        const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);
        const offset = parseInt(String(req.query.offset ?? '0'), 10);
        const rows = db.prepare(
            `SELECT * FROM musicologia_activity_feed ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).all(limit, offset);
        res.json(rows);
    });

    // ── Reactions ─────────────────────────────────────────────────────────────

    const ALLOWED_EMOJIS_TRACK = ['🔥', '❤️', '😭', '🎵', '✨', '🤯'];

    router.get('/api/musicologia/tracks/:id/reactions', (req, res) => {
        const me = getSessionUser(db, req);
        const trackId = req.params.id;

        const rows = db.prepare(
            `SELECT emoji, COUNT(*) as count FROM musicologia_reactions WHERE track_id = ? GROUP BY emoji`
        ).all(trackId) as Array<{ emoji: string; count: number }>;

        const counts: Record<string, number> = {};
        for (const emoji of ALLOWED_EMOJIS_TRACK) counts[emoji] = 0;
        for (const r of rows) counts[r.emoji] = r.count;

        let myReaction: string | null = null;
        if (me) {
            const mine = db.prepare(`SELECT emoji FROM musicologia_reactions WHERE user_id = ? AND track_id = ?`).get(me.id, trackId) as { emoji: string } | undefined;
            myReaction = mine?.emoji ?? null;
        }

        res.json({ counts, myReaction });
    });

    router.post('/api/musicologia/tracks/:id/reactions', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });

        const trackId = req.params.id;
        const { emoji } = req.body as { emoji?: string };
        if (!emoji || !ALLOWED_EMOJIS_TRACK.includes(emoji)) return res.status(400).json({ error: 'Invalid emoji' });

        const track = db.prepare(`SELECT id, title FROM tracks WHERE id = ?`).get(trackId) as { id: number; title: string } | undefined;
        if (!track) return res.status(404).json({ error: 'Track not found' });

        const existing = db.prepare(`SELECT emoji FROM musicologia_reactions WHERE user_id = ? AND track_id = ?`).get(me.id, trackId) as { emoji: string } | undefined;

        if (existing?.emoji === emoji) {
            // Toggle off
            db.prepare(`DELETE FROM musicologia_reactions WHERE user_id = ? AND track_id = ?`).run(me.id, trackId);
        } else {
            // Set new reaction (replaces any existing)
            db.prepare(`INSERT OR REPLACE INTO musicologia_reactions (user_id, track_id, emoji) VALUES (?,?,?)`).run(me.id, trackId, emoji);
            writeActivity(me.id, me.name ?? me.login, me.avatar_url ?? null, 'loved', 'track', String(trackId), track.title, { emoji });
        }

        // Return updated counts
        const rows = db.prepare(
            `SELECT emoji, COUNT(*) as count FROM musicologia_reactions WHERE track_id = ? GROUP BY emoji`
        ).all(trackId) as Array<{ emoji: string; count: number }>;
        const counts: Record<string, number> = {};
        for (const e of ALLOWED_EMOJIS_TRACK) counts[e] = 0;
        for (const r of rows) counts[r.emoji] = r.count;

        const mine = db.prepare(`SELECT emoji FROM musicologia_reactions WHERE user_id = ? AND track_id = ?`).get(me.id, trackId) as { emoji: string } | undefined;
        res.json({ counts, myReaction: mine?.emoji ?? null });
    });

    // ── Comments ──────────────────────────────────────────────────────────────

    router.get('/api/musicologia/comments', (req, res) => {
        const targetType = String(req.query.target_type ?? '');
        const targetId = String(req.query.target_id ?? '');
        if (!targetType || !targetId) return res.status(400).json({ error: 'target_type and target_id required' });

        const rows = db.prepare(
            `SELECT * FROM musicologia_comments WHERE target_type = ? AND target_id = ? ORDER BY created_at ASC`
        ).all(targetType, targetId);
        res.json(rows);
    });

    router.post('/api/musicologia/comments', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });

        const { target_type, target_id, body, parent_id } = req.body as {
            target_type?: string;
            target_id?: number;
            body?: string;
            parent_id?: number | null;
        };
        if (!target_type || !target_id || !body?.trim()) {
            return res.status(400).json({ error: 'target_type, target_id, and body required' });
        }

        const r = db.prepare(
            `INSERT INTO musicologia_comments (user_id, user_name, user_avatar, target_type, target_id, body, parent_id)
             VALUES (?,?,?,?,?,?,?)`
        ).run(me.id, me.name ?? me.login, me.avatar_url ?? null, target_type, target_id, body.trim(), parent_id ?? null);

        // Write to activity feed (top-level comments only, no replies)
        if (!parent_id) {
            let objectTitle: string | null = null;
            if (target_type === 'track') {
                const t = db.prepare(`SELECT title FROM tracks WHERE id = ?`).get(target_id) as { title: string } | undefined;
                objectTitle = t?.title ?? null;
            }
            writeActivity(me.id, me.name ?? me.login, me.avatar_url ?? null, 'commented', target_type, String(target_id), objectTitle);
        }

        const comment = db.prepare(`SELECT * FROM musicologia_comments WHERE id = ?`).get(r.lastInsertRowid);
        res.status(201).json(comment);
    });

    router.delete('/api/musicologia/comments/:id', (req, res) => {
        const me = getSessionUser(db, req);
        if (!me) return res.status(401).json({ error: 'Not authenticated' });

        const comment = db.prepare(`SELECT * FROM musicologia_comments WHERE id = ?`).get(req.params.id) as { user_id: number } | undefined;
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        if (comment.user_id !== me.id) return res.status(403).json({ error: 'Not your comment' });

        db.prepare(`DELETE FROM musicologia_comments WHERE id = ?`).run(req.params.id);
        res.json({ ok: true });
    });

    // ── Audit Log ─────────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS musicologia_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            meta TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    function logAudit(
        userId: string | null,
        action: string,
        entityType: string,
        entityId?: number | null,
        meta?: Record<string, unknown> | null,
    ) {
        try {
            db.prepare(
                `INSERT INTO musicologia_audit (user_id, action, entity_type, entity_id, meta) VALUES (?, ?, ?, ?, ?)`
            ).run(userId ?? null, action, entityType, entityId ?? null, meta ? JSON.stringify(meta) : '{}');
        } catch { /* non-critical */ }
    }

    // ── Admin Stats ───────────────────────────────────────────────────────────

    router.get('/api/musicologia/admin/stats', (_req, res) => {
        const totalTracks = db.prepare('SELECT COUNT(*) as count FROM tracks').get() as { count: number };
        const withoutLore = db.prepare(
            `SELECT COUNT(*) as count FROM tracks t WHERE NOT EXISTS (SELECT 1 FROM track_lore l WHERE l.track_id = t.id AND l.tagline IS NOT NULL AND l.tagline != '')`
        ).get() as { count: number };
        const withoutLyrics = db.prepare(
            `SELECT COUNT(*) as count FROM tracks t WHERE NOT EXISTS (SELECT 1 FROM track_lyrics_lrc l WHERE l.track_id = t.id)`
        ).get() as { count: number };
        res.json({
            total: totalTracks.count,
            withoutLore: withoutLore.count,
            withoutLyrics: withoutLyrics.count,
        });
    });

    // ── Admin Audit Log ───────────────────────────────────────────────────────

    router.get('/api/musicologia/admin/audit', (req, res) => {
        const { action, entity_type, limit = 50, offset = 0 } = req.query;
        let query = 'SELECT * FROM musicologia_audit WHERE 1=1';
        const params: unknown[] = [];
        if (action) { query += ' AND action = ?'; params.push(action); }
        if (entity_type) { query += ' AND entity_type = ?'; params.push(entity_type); }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(Number(limit), Number(offset));
        const rows = db.prepare(query).all(...params);
        res.json(rows);
    });

    // ── Admin Playlist Import ─────────────────────────────────────────────────

    router.post('/api/musicologia/admin/import-playlist', async (req, res) => {
        const { playlistUrl } = req.body as { playlistUrl?: string };
        if (!playlistUrl) return res.status(400).json({ error: 'playlistUrl required' });

        const match = playlistUrl.match(/playlist\/([a-zA-Z0-9]+)/);
        if (!match) return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
        const playlistId = match[1];

        const token = await getValidToken(db);
        if (!token) return res.status(401).json({ error: 'Spotify not connected. Connect at /musicologia settings.' });

        try {
            const tracksRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!tracksRes.ok) return res.status(tracksRes.status).json({ error: 'Failed to fetch playlist from Spotify' });
            const tracksData = await tracksRes.json() as { items?: Array<{ track: SpotifyTrack | null }> };

            let imported = 0, skipped = 0, errors = 0;

            for (const item of (tracksData.items || [])) {
                const sp = item.track;
                if (!sp || !sp.id) { errors++; continue; }
                try {
                    const result = await importSpotifyTrack(db, token, sp.id);
                    if (result.isNew) {
                        logAudit(null, 'track.created', 'track', (result.track as { id: number }).id, { source: 'playlist_import', spotify_id: sp.id });
                        imported++;
                    } else {
                        skipped++;
                    }
                } catch {
                    errors++;
                }
            }

            res.json({ imported, skipped, errors, total: tracksData.items?.length || 0 });
        } catch (e: unknown) {
            res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
        }
    });

    // ── Admin Sync Audio Features ─────────────────────────────────────────────

    router.post('/api/musicologia/admin/sync-audio-features', async (_req, res) => {
        const tracks = db.prepare(
            `SELECT t.id, JSON_EXTRACT(t.source_ids, '$.spotify_id') as spotify_id
             FROM tracks t
             LEFT JOIN track_dna d ON d.track_id = t.id
             WHERE JSON_EXTRACT(t.source_ids, '$.spotify_id') IS NOT NULL
               AND (d.id IS NULL OR (d.tempo IS NULL AND d.energy IS NULL))
             LIMIT 100`
        ).all() as Array<{ id: number; spotify_id: string }>;

        if (tracks.length === 0) return res.json({ synced: 0, message: 'All tracks already have audio features' });

        const token = await getValidToken(db);
        if (!token) return res.status(401).json({ error: 'Spotify not connected. Connect at /musicologia settings.' });

        try {
            let synced = 0;

            // Process in batches of up to 100
            const ids = tracks.map(t => t.spotify_id).join(',');
            const featuresRes = await fetch(`https://api.spotify.com/v1/audio-features?ids=${ids}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!featuresRes.ok) return res.status(featuresRes.status).json({ error: 'Failed to fetch audio features from Spotify' });
            const featuresData = await featuresRes.json() as { audio_features?: Array<SpotifyAudioFeatures | null> };

            for (const [i, feature] of (featuresData.audio_features || []).entries()) {
                if (!feature) continue;
                const track = tracks[i];
                if (!track) continue;

                const dnaExists = db.prepare(`SELECT id FROM track_dna WHERE track_id = ?`).get(track.id);
                if (dnaExists) {
                    db.prepare(
                        `UPDATE track_dna SET tempo=?,key=?,mode=?,energy=?,valence=?,danceability=?,
                         loudness=?,acousticness=?,instrumentalness=?,liveness=?,speechiness=?,time_signature=?,
                         updated_at=datetime('now') WHERE track_id=?`
                    ).run(
                        feature.tempo, feature.key, feature.mode, feature.energy, feature.valence,
                        feature.danceability, feature.loudness, feature.acousticness, feature.instrumentalness,
                        feature.liveness, feature.speechiness, feature.time_signature, track.id
                    );
                } else {
                    db.prepare(
                        `INSERT INTO track_dna (track_id, tempo, key, mode, energy, valence, danceability,
                         loudness, acousticness, instrumentalness, liveness, speechiness, time_signature)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
                    ).run(
                        track.id, feature.tempo, feature.key, feature.mode, feature.energy, feature.valence,
                        feature.danceability, feature.loudness, feature.acousticness, feature.instrumentalness,
                        feature.liveness, feature.speechiness, feature.time_signature
                    );
                }
                synced++;
            }

            res.json({ synced, total: tracks.length });
        } catch (e: unknown) {
            res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
        }
    });

    // ── Admin Batch Lore Generate (SSE) ───────────────────────────────────────

    router.post('/api/musicologia/admin/batch-lore-generate', async (req, res) => {
        const { trackIds, all } = req.body as { trackIds?: number[]; all?: boolean };

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const send = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`);

        let tracks: Array<{ id: number; title: string; artist: string }>;
        if (all) {
            tracks = db.prepare(
                `SELECT t.id, t.title, t.artist FROM tracks t
                 LEFT JOIN track_lore l ON l.track_id = t.id
                 WHERE l.id IS NULL OR l.tagline IS NULL OR l.tagline = ''`
            ).all() as Array<{ id: number; title: string; artist: string }>;
        } else if (Array.isArray(trackIds) && trackIds.length > 0) {
            const placeholders = trackIds.map(() => '?').join(',');
            tracks = db.prepare(
                `SELECT id, title, artist FROM tracks WHERE id IN (${placeholders})`
            ).all(...trackIds) as Array<{ id: number; title: string; artist: string }>;
        } else {
            send({ error: 'Provide trackIds or all:true' });
            res.end();
            return;
        }

        const total = tracks.length;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            send({ done: i, total, trackId: track.id, status: 'generating', title: track.title });

            try {
                const dna = db.prepare(`SELECT * FROM track_dna WHERE track_id = ?`).get(track.id) as Record<string, unknown> | null;
                const sourceIds = JSON.parse((db.prepare(`SELECT source_ids FROM tracks WHERE id = ?`).get(track.id) as { source_ids: string } | undefined)?.source_ids || '{}') as Record<string, string>;
                const spotifyId = sourceIds.spotify_id;

                let genres: string[] = [];
                try {
                    const token = await getValidToken(db);
                    if (token && spotifyId) {
                        const trackRes = await spotifyGet(`https://api.spotify.com/v1/tracks/${spotifyId}`, token);
                        if (trackRes.ok) {
                            const sp = trackRes.data as { artists?: Array<{ id: string }> };
                            const artistId = sp.artists?.[0]?.id;
                            if (artistId) {
                                const artistRes = await spotifyGet(`https://api.spotify.com/v1/artists/${artistId}`, token);
                                if (artistRes.ok) {
                                    genres = ((artistRes.data as { genres?: string[] }).genres ?? []).slice(0, 5);
                                }
                            }
                        }
                    }
                } catch { /* genres optional */ }

                const loreOutput = await generateLoreWithClaude(
                    track.title,
                    track.artist,
                    null,
                    dna ? {
                        tempo: dna.tempo as number | null,
                        key: dna.key as number | null,
                        mode: dna.mode as number | null,
                        energy: dna.energy as number | null,
                        valence: dna.valence as number | null,
                        danceability: dna.danceability as number | null,
                        acousticness: dna.acousticness as number | null,
                        instrumentalness: dna.instrumentalness as number | null,
                    } : null,
                    genres,
                );

                if (loreOutput) {
                    const existing = db.prepare(`SELECT id FROM track_lore WHERE track_id = ?`).get(track.id);
                    if (existing) {
                        db.prepare(
                            `UPDATE track_lore SET tagline=?,story=?,trivia=?,themes=?,credits=?,updated_at=datetime('now') WHERE track_id=?`
                        ).run(
                            loreOutput.tagline, loreOutput.story,
                            JSON.stringify(loreOutput.trivia), JSON.stringify(loreOutput.themes),
                            JSON.stringify(loreOutput.credits), track.id,
                        );
                    } else {
                        db.prepare(
                            `INSERT INTO track_lore (track_id, tagline, story, trivia, themes, credits) VALUES (?,?,?,?,?,?)`
                        ).run(
                            track.id, loreOutput.tagline, loreOutput.story,
                            JSON.stringify(loreOutput.trivia), JSON.stringify(loreOutput.themes),
                            JSON.stringify(loreOutput.credits),
                        );
                    }
                    logAudit(null, 'lore.generated', 'track', track.id, { title: track.title });
                    send({ done: i + 1, total, trackId: track.id, status: 'done', title: track.title });
                } else {
                    send({ done: i + 1, total, trackId: track.id, status: 'error', title: track.title, error: 'Lore generation failed' });
                }
            } catch (e: unknown) {
                send({ done: i + 1, total, trackId: track.id, status: 'error', title: track.title, error: e instanceof Error ? e.message : String(e) });
            }

            await new Promise(r => setTimeout(r, 500));
        }

        send({ done: total, total, status: 'complete' });
        res.end();
    });

    // ── DELETE track ─────────────────────────────────────────────────────────

    router.delete('/api/musicologia/tracks/:id', (req, res) => {
        const me = getSessionUser(db, req);
        const trackId = req.params.id;
        const track = db.prepare(`SELECT id, title FROM tracks WHERE id = ?`).get(trackId) as { id: number; title: string } | undefined;
        if (!track) return res.status(404).json({ error: 'Track not found' });
        db.prepare(`DELETE FROM tracks WHERE id = ?`).run(trackId);
        logAudit(me ? String(me.id) : null, 'track.deleted', 'track', track.id, { title: track.title });
        res.json({ ok: true });
    });

    // ── LRC Lyrics PUT route ──────────────────────────────────────────────────

    router.put('/api/musicologia/tracks/:id/lyrics', (req, res) => {
        const trackId = req.params.id;
        const { lrc, lines } = req.body as { lrc?: string; lines?: Array<{ time_ms: number; text: string }> };

        let parsedLines: Array<{ time_seconds: number; text: string; line_index: number }> = [];

        if (lrc && typeof lrc === 'string') {
            const lrcPattern = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/;
            let lineIndex = 0;
            for (const raw of lrc.split('\n')) {
                const m = raw.trim().match(lrcPattern);
                if (!m) continue;
                const minutes = parseInt(m[1], 10);
                const seconds = parseFloat(m[2]);
                const text = m[3].trim();
                if (!text) continue;
                parsedLines.push({ time_seconds: minutes * 60 + seconds, text, line_index: lineIndex++ });
            }
        } else if (Array.isArray(lines)) {
            parsedLines = lines.map((l, i) => ({
                time_seconds: (l.time_ms || 0) / 1000,
                text: l.text,
                line_index: i,
            }));
        } else {
            return res.status(400).json({ error: 'lrc string or lines array required' });
        }

        const del = db.prepare(`DELETE FROM track_lyrics_lrc WHERE track_id = ?`);
        const ins = db.prepare(`INSERT INTO track_lyrics_lrc (track_id, time_seconds, text, line_index) VALUES (?,?,?,?)`);
        db.transaction(() => {
            del.run(trackId);
            for (const l of parsedLines) {
                ins.run(trackId, l.time_seconds, l.text, l.line_index);
            }
        })();

        logAudit(null, 'lyrics.imported', 'track', parseInt(trackId, 10), { lines: parsedLines.length });

        res.json({ imported: parsedLines.length });
    });

    return router;
}
