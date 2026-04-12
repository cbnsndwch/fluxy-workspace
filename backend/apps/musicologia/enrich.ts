/**
 * Musicologia Phase 8 — TrackDNA Enrichment Pipeline
 *
 * Provides Spotify-free enrichment via:
 * - LRCLIB   → synced LRC lyrics auto-fetch
 * - Sharp    → real album art color extraction (k-means clustering)
 * - MusicBrainz tags → genre heuristics → estimated audio features
 */

import sharp from 'sharp';

import type Database from 'better-sqlite3';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnrichmentResult {
    trackId: number;
    palette: string[] | null;
    lyricsImported: boolean;
    dnaEstimated: boolean;
    mbTagsAdded: string[];
    errors: string[];
}

interface TrackRow {
    id: number;
    title: string;
    artist: string;
    cover_url: string | null;
    duration_ms: number | null;
    source_ids: string;
}

interface DnaRow {
    id: number;
    energy: number | null;
    valence: number | null;
    tempo: number | null;
    key: number | null;
    mode: number | null;
    danceability: number | null;
    loudness: number | null;
    acousticness: number | null;
    instrumentalness: number | null;
    liveness: number | null;
    speechiness: number | null;
    time_signature: number | null;
    palette: string | null;
}

interface LoreRow {
    id: number;
    themes: string | null;
}

// ─── Color Extraction (Sharp + K-Means) ───────────────────────────────────────

/** K-means cluster center */
interface Color {
    r: number;
    g: number;
    b: number;
}

function euclidean(a: Color, b: Color): number {
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function kMeans(pixels: Color[], k: number, iterations = 20): Color[] {
    if (pixels.length < k) return pixels;

    // Seed: evenly spread across the pixel array
    let centers: Color[] = Array.from(
        { length: k },
        (_, i) => pixels[Math.floor((i * pixels.length) / k)]
    );

    for (let iter = 0; iter < iterations; iter++) {
        const clusters: Color[][] = Array.from({ length: k }, () => []);

        for (const px of pixels) {
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < k; i++) {
                const d = euclidean(px, centers[i]);
                if (d < bestDist) {
                    bestDist = d;
                    best = i;
                }
            }
            clusters[best].push(px);
        }

        const newCenters: Color[] = centers.map((center, i) => {
            const cl = clusters[i];
            if (cl.length === 0) return center;
            return {
                r: Math.round(cl.reduce((s, p) => s + p.r, 0) / cl.length),
                g: Math.round(cl.reduce((s, p) => s + p.g, 0) / cl.length),
                b: Math.round(cl.reduce((s, p) => s + p.b, 0) / cl.length)
            };
        });

        centers = newCenters;
    }

    // Sort by perceived brightness (descending) for a nice palette order
    return centers.sort((a, b) => {
        const la = 0.299 * a.r + 0.587 * a.g + 0.114 * a.b;
        const lb = 0.299 * b.r + 0.587 * b.g + 0.114 * b.b;
        return lb - la;
    });
}

function toHex(c: Color): string {
    return (
        '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')
    );
}

/**
 * Download a cover image URL and extract a 5-color palette via k-means clustering.
 * Returns null if the image can't be fetched or processed.
 */
export async function extractPaletteFromImage(
    coverUrl: string
): Promise<string[] | null> {
    try {
        const res = await fetch(coverUrl, {
            signal: AbortSignal.timeout(10_000)
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());

        // Resize to 64×64, remove alpha, get raw RGB pixels
        const { data, info } = await sharp(buf)
            .resize(64, 64, { fit: 'cover' })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const pixels: Color[] = [];
        for (let i = 0; i < data.length; i += info.channels) {
            const r = data[i],
                g = data[i + 1],
                b = data[i + 2];
            // Skip near-white and near-black — they're uninteresting for palettes
            const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
            if (brightness > 240 || brightness < 15) continue;
            // Sample every 3rd pixel for speed
            if ((i / info.channels) % 3 !== 0) continue;
            pixels.push({ r, g, b });
        }

        if (pixels.length < 10) return null;

        const clusters = kMeans(pixels, 5);
        return clusters.map(toHex);
    } catch {
        return null;
    }
}

// ─── LRCLIB Lyrics Fetch ──────────────────────────────────────────────────────

interface LrcLibResponse {
    syncedLyrics?: string | null;
    plainLyrics?: string | null;
    duration?: number;
}

interface LrcLine {
    time: number;
    text: string;
}

function parseLrc(lrc: string): LrcLine[] {
    const lines: LrcLine[] = [];
    for (const raw of lrc.split('\n')) {
        const m = raw.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
        if (!m) continue;
        const min = parseInt(m[1], 10);
        const sec = parseInt(m[2], 10);
        const ms = parseInt(m[3].padEnd(3, '0'), 10);
        const text = m[4].trim();
        if (!text) continue;
        lines.push({ time: min * 60 + sec + ms / 1000, text });
    }
    return lines.sort((a, b) => a.time - b.time);
}

/**
 * Fetch synced LRC lyrics from LRCLIB for a track.
 * Returns parsed lines or null if not found.
 */
export async function fetchLrclibLyrics(
    title: string,
    artist: string,
    durationMs: number | null
): Promise<LrcLine[] | null> {
    try {
        const params = new URLSearchParams({
            track_name: title,
            artist_name: artist
        });
        if (durationMs)
            params.set('duration', String(Math.round(durationMs / 1000)));

        const url = `https://lrclib.net/api/get?${params}`;
        const res = await fetch(url, {
            headers: { 'Lrclib-Client': 'Musicologia/1.0 (fluxy-workspace)' },
            signal: AbortSignal.timeout(8_000)
        });

        if (res.status === 404) return null;
        if (!res.ok) return null;

        const data = (await res.json()) as LrcLibResponse;

        // Prefer synced lyrics
        if (data.syncedLyrics) {
            const lines = parseLrc(data.syncedLyrics);
            return lines.length > 0 ? lines : null;
        }

        return null;
    } catch {
        return null;
    }
}

// ─── MusicBrainz Enrichment ───────────────────────────────────────────────────

interface MBRecording {
    id?: string;
    tags?: Array<{ name: string; count?: number }>;
    releases?: Array<{
        title: string;
        date?: string;
        'release-group'?: { 'primary-type'?: string };
    }>;
}

/**
 * Fetch MusicBrainz recording data by MBID, getting tags + release info.
 * Rate-limited: MusicBrainz asks for max 1 req/sec.
 */
export async function fetchMBRecordingDetail(
    mbid: string
): Promise<MBRecording | null> {
    try {
        const url = `https://musicbrainz.org/ws/2/recording/${mbid}?inc=tags+releases&fmt=json`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Musicologia/1.0 (fluxy-workspace)' },
            signal: AbortSignal.timeout(10_000)
        });
        if (!res.ok) return null;
        return (await res.json()) as MBRecording;
    } catch {
        return null;
    }
}

// ─── Genre → Audio Feature Heuristics ────────────────────────────────────────

interface AudioEstimate {
    energy: number;
    valence: number;
    danceability: number;
    acousticness: number;
    instrumentalness: number;
    liveness: number;
    speechiness: number;
    tempo: number;
    key: number;
    mode: number;
    time_signature: number;
    loudness: number;
}

type GenrePartial = Partial<AudioEstimate>;

/**
 * Broad genre → audio feature mapping.
 * Values are reasonable medians; multiple matching genres are averaged.
 */
const GENRE_HEURISTICS: Record<string, GenrePartial> = {
    // Electronic / Dance
    electronic: {
        energy: 0.75,
        valence: 0.5,
        danceability: 0.75,
        acousticness: 0.05,
        instrumentalness: 0.6,
        tempo: 128,
        loudness: -6
    },
    edm: {
        energy: 0.85,
        valence: 0.6,
        danceability: 0.85,
        acousticness: 0.02,
        instrumentalness: 0.7,
        tempo: 130,
        loudness: -5
    },
    techno: {
        energy: 0.88,
        valence: 0.4,
        danceability: 0.82,
        acousticness: 0.02,
        instrumentalness: 0.9,
        tempo: 135,
        loudness: -5
    },
    house: {
        energy: 0.78,
        valence: 0.65,
        danceability: 0.85,
        acousticness: 0.03,
        instrumentalness: 0.6,
        tempo: 124,
        loudness: -6
    },
    'deep house': {
        energy: 0.65,
        valence: 0.55,
        danceability: 0.8,
        acousticness: 0.05,
        instrumentalness: 0.55,
        tempo: 120,
        loudness: -7
    },
    'drum and bass': {
        energy: 0.92,
        valence: 0.45,
        danceability: 0.78,
        acousticness: 0.02,
        instrumentalness: 0.8,
        tempo: 170,
        loudness: -5
    },
    jungle: {
        energy: 0.88,
        valence: 0.48,
        danceability: 0.75,
        acousticness: 0.02,
        instrumentalness: 0.75,
        tempo: 165,
        loudness: -5
    },
    dubstep: {
        energy: 0.9,
        valence: 0.38,
        danceability: 0.72,
        acousticness: 0.02,
        instrumentalness: 0.7,
        tempo: 138,
        loudness: -4
    },
    trance: {
        energy: 0.82,
        valence: 0.6,
        danceability: 0.8,
        acousticness: 0.02,
        instrumentalness: 0.75,
        tempo: 138,
        loudness: -5
    },
    ambient: {
        energy: 0.22,
        valence: 0.35,
        danceability: 0.3,
        acousticness: 0.5,
        instrumentalness: 0.85,
        tempo: 80,
        loudness: -14
    },
    idm: {
        energy: 0.6,
        valence: 0.4,
        danceability: 0.55,
        acousticness: 0.1,
        instrumentalness: 0.85,
        tempo: 110,
        loudness: -8
    },
    downtempo: {
        energy: 0.4,
        valence: 0.42,
        danceability: 0.6,
        acousticness: 0.2,
        instrumentalness: 0.6,
        tempo: 90,
        loudness: -10
    },
    chillout: {
        energy: 0.35,
        valence: 0.5,
        danceability: 0.55,
        acousticness: 0.25,
        instrumentalness: 0.55,
        tempo: 90,
        loudness: -10
    },
    synthpop: {
        energy: 0.65,
        valence: 0.58,
        danceability: 0.72,
        acousticness: 0.05,
        instrumentalness: 0.3,
        tempo: 118,
        loudness: -7
    },
    'synth-pop': {
        energy: 0.65,
        valence: 0.58,
        danceability: 0.72,
        acousticness: 0.05,
        instrumentalness: 0.3,
        tempo: 118,
        loudness: -7
    },

    // Rock
    rock: {
        energy: 0.75,
        valence: 0.5,
        danceability: 0.55,
        acousticness: 0.15,
        instrumentalness: 0.1,
        tempo: 120,
        loudness: -6,
        mode: 0
    },
    'hard rock': {
        energy: 0.87,
        valence: 0.45,
        danceability: 0.52,
        acousticness: 0.05,
        instrumentalness: 0.12,
        tempo: 130,
        loudness: -5,
        mode: 0
    },
    punk: {
        energy: 0.9,
        valence: 0.55,
        danceability: 0.62,
        acousticness: 0.05,
        instrumentalness: 0.05,
        tempo: 160,
        loudness: -4,
        mode: 0
    },
    'punk rock': {
        energy: 0.88,
        valence: 0.52,
        danceability: 0.6,
        acousticness: 0.05,
        instrumentalness: 0.05,
        tempo: 158,
        loudness: -4,
        mode: 0
    },
    'indie rock': {
        energy: 0.65,
        valence: 0.52,
        danceability: 0.55,
        acousticness: 0.2,
        instrumentalness: 0.1,
        tempo: 118,
        loudness: -7
    },
    'alternative rock': {
        energy: 0.7,
        valence: 0.48,
        danceability: 0.54,
        acousticness: 0.15,
        instrumentalness: 0.1,
        tempo: 118,
        loudness: -7
    },
    alternative: {
        energy: 0.68,
        valence: 0.48,
        danceability: 0.53,
        acousticness: 0.15,
        instrumentalness: 0.1,
        tempo: 116,
        loudness: -7
    },
    metal: {
        energy: 0.92,
        valence: 0.35,
        danceability: 0.45,
        acousticness: 0.05,
        instrumentalness: 0.3,
        tempo: 140,
        loudness: -4,
        mode: 0
    },
    'heavy metal': {
        energy: 0.93,
        valence: 0.32,
        danceability: 0.44,
        acousticness: 0.03,
        instrumentalness: 0.35,
        tempo: 145,
        loudness: -4,
        mode: 0
    },
    'death metal': {
        energy: 0.95,
        valence: 0.25,
        danceability: 0.42,
        acousticness: 0.02,
        instrumentalness: 0.45,
        tempo: 165,
        loudness: -3,
        mode: 0
    },
    'black metal': {
        energy: 0.95,
        valence: 0.22,
        danceability: 0.38,
        acousticness: 0.02,
        instrumentalness: 0.5,
        tempo: 168,
        loudness: -3,
        mode: 0
    },
    shoegaze: {
        energy: 0.65,
        valence: 0.42,
        danceability: 0.48,
        acousticness: 0.1,
        instrumentalness: 0.4,
        tempo: 110,
        loudness: -8
    },
    grunge: {
        energy: 0.8,
        valence: 0.38,
        danceability: 0.5,
        acousticness: 0.12,
        instrumentalness: 0.12,
        tempo: 115,
        loudness: -6,
        mode: 0
    },
    'post-rock': {
        energy: 0.58,
        valence: 0.38,
        danceability: 0.42,
        acousticness: 0.2,
        instrumentalness: 0.65,
        tempo: 105,
        loudness: -9
    },
    'progressive rock': {
        energy: 0.7,
        valence: 0.45,
        danceability: 0.48,
        acousticness: 0.18,
        instrumentalness: 0.35,
        tempo: 112,
        loudness: -7
    },
    'classic rock': {
        energy: 0.72,
        valence: 0.55,
        danceability: 0.58,
        acousticness: 0.18,
        instrumentalness: 0.12,
        tempo: 120,
        loudness: -6
    },

    // Pop
    pop: {
        energy: 0.65,
        valence: 0.65,
        danceability: 0.72,
        acousticness: 0.15,
        instrumentalness: 0.03,
        tempo: 118,
        loudness: -6
    },
    'dance pop': {
        energy: 0.75,
        valence: 0.7,
        danceability: 0.8,
        acousticness: 0.08,
        instrumentalness: 0.05,
        tempo: 122,
        loudness: -5
    },
    'indie pop': {
        energy: 0.55,
        valence: 0.6,
        danceability: 0.62,
        acousticness: 0.25,
        instrumentalness: 0.08,
        tempo: 112,
        loudness: -7
    },
    'art pop': {
        energy: 0.52,
        valence: 0.52,
        danceability: 0.6,
        acousticness: 0.25,
        instrumentalness: 0.2,
        tempo: 108,
        loudness: -8
    },
    'k-pop': {
        energy: 0.75,
        valence: 0.7,
        danceability: 0.8,
        acousticness: 0.05,
        instrumentalness: 0.05,
        tempo: 125,
        loudness: -5
    },
    'j-pop': {
        energy: 0.65,
        valence: 0.68,
        danceability: 0.72,
        acousticness: 0.1,
        instrumentalness: 0.08,
        tempo: 120,
        loudness: -6
    },
    electropop: {
        energy: 0.72,
        valence: 0.62,
        danceability: 0.76,
        acousticness: 0.05,
        instrumentalness: 0.25,
        tempo: 122,
        loudness: -6
    },
    'chamber pop': {
        energy: 0.48,
        valence: 0.55,
        danceability: 0.52,
        acousticness: 0.5,
        instrumentalness: 0.2,
        tempo: 105,
        loudness: -9
    },

    // Hip-Hop / R&B
    'hip hop': {
        energy: 0.65,
        valence: 0.6,
        danceability: 0.8,
        acousticness: 0.12,
        instrumentalness: 0.05,
        tempo: 92,
        loudness: -6,
        speechiness: 0.25
    },
    'hip-hop': {
        energy: 0.65,
        valence: 0.6,
        danceability: 0.8,
        acousticness: 0.12,
        instrumentalness: 0.05,
        tempo: 92,
        loudness: -6,
        speechiness: 0.25
    },
    rap: {
        energy: 0.7,
        valence: 0.58,
        danceability: 0.78,
        acousticness: 0.1,
        instrumentalness: 0.02,
        tempo: 90,
        loudness: -5,
        speechiness: 0.35
    },
    trap: {
        energy: 0.72,
        valence: 0.52,
        danceability: 0.78,
        acousticness: 0.08,
        instrumentalness: 0.08,
        tempo: 72,
        loudness: -5,
        speechiness: 0.22
    },
    'r&b': {
        energy: 0.58,
        valence: 0.62,
        danceability: 0.75,
        acousticness: 0.2,
        instrumentalness: 0.05,
        tempo: 98,
        loudness: -7
    },
    rnb: {
        energy: 0.58,
        valence: 0.62,
        danceability: 0.75,
        acousticness: 0.2,
        instrumentalness: 0.05,
        tempo: 98,
        loudness: -7
    },
    soul: {
        energy: 0.6,
        valence: 0.65,
        danceability: 0.7,
        acousticness: 0.4,
        instrumentalness: 0.05,
        tempo: 98,
        loudness: -7
    },
    'neo soul': {
        energy: 0.52,
        valence: 0.58,
        danceability: 0.68,
        acousticness: 0.35,
        instrumentalness: 0.12,
        tempo: 95,
        loudness: -8
    },
    funk: {
        energy: 0.78,
        valence: 0.72,
        danceability: 0.85,
        acousticness: 0.2,
        instrumentalness: 0.2,
        tempo: 108,
        loudness: -6
    },
    disco: {
        energy: 0.75,
        valence: 0.78,
        danceability: 0.88,
        acousticness: 0.15,
        instrumentalness: 0.15,
        tempo: 118,
        loudness: -6
    },
    motown: {
        energy: 0.65,
        valence: 0.72,
        danceability: 0.78,
        acousticness: 0.4,
        instrumentalness: 0.05,
        tempo: 110,
        loudness: -7
    },

    // Jazz / Blues
    jazz: {
        energy: 0.45,
        valence: 0.55,
        danceability: 0.55,
        acousticness: 0.7,
        instrumentalness: 0.45,
        tempo: 120,
        loudness: -10
    },
    'jazz fusion': {
        energy: 0.58,
        valence: 0.52,
        danceability: 0.6,
        acousticness: 0.5,
        instrumentalness: 0.55,
        tempo: 125,
        loudness: -9
    },
    bebop: {
        energy: 0.65,
        valence: 0.5,
        danceability: 0.5,
        acousticness: 0.8,
        instrumentalness: 0.8,
        tempo: 200,
        loudness: -10
    },
    blues: {
        energy: 0.55,
        valence: 0.42,
        danceability: 0.58,
        acousticness: 0.55,
        instrumentalness: 0.15,
        tempo: 92,
        loudness: -9,
        mode: 0
    },
    'blues rock': {
        energy: 0.7,
        valence: 0.45,
        danceability: 0.6,
        acousticness: 0.3,
        instrumentalness: 0.15,
        tempo: 100,
        loudness: -7,
        mode: 0
    },
    swing: {
        energy: 0.62,
        valence: 0.7,
        danceability: 0.72,
        acousticness: 0.75,
        instrumentalness: 0.4,
        tempo: 155,
        loudness: -8
    },

    // Classical / Instrumental
    classical: {
        energy: 0.28,
        valence: 0.4,
        danceability: 0.25,
        acousticness: 0.95,
        instrumentalness: 0.95,
        tempo: 95,
        loudness: -18
    },
    baroque: {
        energy: 0.35,
        valence: 0.5,
        danceability: 0.35,
        acousticness: 0.98,
        instrumentalness: 0.98,
        tempo: 110,
        loudness: -16
    },
    'contemporary classical': {
        energy: 0.3,
        valence: 0.4,
        danceability: 0.25,
        acousticness: 0.9,
        instrumentalness: 0.92,
        tempo: 90,
        loudness: -17
    },
    orchestral: {
        energy: 0.5,
        valence: 0.45,
        danceability: 0.3,
        acousticness: 0.92,
        instrumentalness: 0.95,
        tempo: 100,
        loudness: -14
    },
    'chamber music': {
        energy: 0.32,
        valence: 0.45,
        danceability: 0.28,
        acousticness: 0.96,
        instrumentalness: 0.97,
        tempo: 95,
        loudness: -17
    },
    opera: {
        energy: 0.55,
        valence: 0.48,
        danceability: 0.25,
        acousticness: 0.9,
        instrumentalness: 0.1,
        tempo: 90,
        loudness: -12
    },

    // Country / Folk
    country: {
        energy: 0.65,
        valence: 0.68,
        danceability: 0.65,
        acousticness: 0.45,
        instrumentalness: 0.05,
        tempo: 110,
        loudness: -7
    },
    folk: {
        energy: 0.4,
        valence: 0.55,
        danceability: 0.5,
        acousticness: 0.75,
        instrumentalness: 0.15,
        tempo: 100,
        loudness: -10
    },
    'indie folk': {
        energy: 0.42,
        valence: 0.55,
        danceability: 0.52,
        acousticness: 0.65,
        instrumentalness: 0.18,
        tempo: 102,
        loudness: -10
    },
    bluegrass: {
        energy: 0.68,
        valence: 0.7,
        danceability: 0.65,
        acousticness: 0.8,
        instrumentalness: 0.25,
        tempo: 130,
        loudness: -8
    },
    americana: {
        energy: 0.55,
        valence: 0.6,
        danceability: 0.58,
        acousticness: 0.55,
        instrumentalness: 0.12,
        tempo: 108,
        loudness: -8
    },
    'singer-songwriter': {
        energy: 0.4,
        valence: 0.52,
        danceability: 0.48,
        acousticness: 0.72,
        instrumentalness: 0.05,
        tempo: 100,
        loudness: -10
    },

    // Latin
    latin: {
        energy: 0.72,
        valence: 0.78,
        danceability: 0.85,
        acousticness: 0.25,
        instrumentalness: 0.1,
        tempo: 115,
        loudness: -6
    },
    reggaeton: {
        energy: 0.78,
        valence: 0.75,
        danceability: 0.87,
        acousticness: 0.1,
        instrumentalness: 0.1,
        tempo: 95,
        loudness: -5
    },
    salsa: {
        energy: 0.8,
        valence: 0.82,
        danceability: 0.88,
        acousticness: 0.35,
        instrumentalness: 0.2,
        tempo: 180,
        loudness: -5
    },
    'bossa nova': {
        energy: 0.38,
        valence: 0.68,
        danceability: 0.65,
        acousticness: 0.75,
        instrumentalness: 0.25,
        tempo: 118,
        loudness: -10
    },
    mpb: {
        energy: 0.48,
        valence: 0.65,
        danceability: 0.68,
        acousticness: 0.6,
        instrumentalness: 0.15,
        tempo: 112,
        loudness: -9
    },
    samba: {
        energy: 0.75,
        valence: 0.8,
        danceability: 0.88,
        acousticness: 0.4,
        instrumentalness: 0.15,
        tempo: 100,
        loudness: -6
    },
    cumbia: {
        energy: 0.72,
        valence: 0.75,
        danceability: 0.85,
        acousticness: 0.35,
        instrumentalness: 0.2,
        tempo: 110,
        loudness: -6
    },
    flamenco: {
        energy: 0.68,
        valence: 0.45,
        danceability: 0.65,
        acousticness: 0.8,
        instrumentalness: 0.25,
        tempo: 120,
        loudness: -8,
        mode: 0
    },

    // Reggae / Afrobeats
    reggae: {
        energy: 0.58,
        valence: 0.72,
        danceability: 0.78,
        acousticness: 0.35,
        instrumentalness: 0.1,
        tempo: 88,
        loudness: -8
    },
    dancehall: {
        energy: 0.78,
        valence: 0.72,
        danceability: 0.85,
        acousticness: 0.1,
        instrumentalness: 0.12,
        tempo: 95,
        loudness: -5
    },
    afrobeats: {
        energy: 0.78,
        valence: 0.8,
        danceability: 0.88,
        acousticness: 0.15,
        instrumentalness: 0.1,
        tempo: 98,
        loudness: -5
    },
    afropop: {
        energy: 0.72,
        valence: 0.78,
        danceability: 0.85,
        acousticness: 0.2,
        instrumentalness: 0.1,
        tempo: 100,
        loudness: -6
    },
    highlife: {
        energy: 0.65,
        valence: 0.78,
        danceability: 0.8,
        acousticness: 0.3,
        instrumentalness: 0.25,
        tempo: 105,
        loudness: -7
    },

    // World / Other
    'world music': {
        energy: 0.6,
        valence: 0.62,
        danceability: 0.65,
        acousticness: 0.55,
        instrumentalness: 0.3,
        tempo: 105,
        loudness: -9
    },
    'new age': {
        energy: 0.18,
        valence: 0.45,
        danceability: 0.28,
        acousticness: 0.65,
        instrumentalness: 0.8,
        tempo: 72,
        loudness: -16
    },
    gospel: {
        energy: 0.7,
        valence: 0.78,
        danceability: 0.65,
        acousticness: 0.45,
        instrumentalness: 0.05,
        tempo: 110,
        loudness: -7
    },
    spiritual: {
        energy: 0.42,
        valence: 0.62,
        danceability: 0.48,
        acousticness: 0.6,
        instrumentalness: 0.2,
        tempo: 95,
        loudness: -11
    },
    soundtrack: {
        energy: 0.5,
        valence: 0.48,
        danceability: 0.42,
        acousticness: 0.45,
        instrumentalness: 0.75,
        tempo: 100,
        loudness: -11
    },
    'film score': {
        energy: 0.55,
        valence: 0.45,
        danceability: 0.38,
        acousticness: 0.5,
        instrumentalness: 0.92,
        tempo: 98,
        loudness: -12
    },
    noise: {
        energy: 0.92,
        valence: 0.25,
        danceability: 0.3,
        acousticness: 0.05,
        instrumentalness: 0.85,
        tempo: 100,
        loudness: -3
    },
    experimental: {
        energy: 0.55,
        valence: 0.38,
        danceability: 0.4,
        acousticness: 0.3,
        instrumentalness: 0.55,
        tempo: 100,
        loudness: -10
    }
};

/** Normalize genre string to match GENRE_HEURISTICS keys */
function normalizeGenre(g: string): string {
    return g.toLowerCase().trim().replace(/[_]/g, ' ');
}

/**
 * Estimate audio features from a list of genre tags.
 * Averages over all matching genres. Returns null if no genres match.
 */
export function estimateAudioFeaturesFromGenres(
    genres: string[]
): Partial<AudioEstimate> | null {
    const matches: GenrePartial[] = [];

    for (const raw of genres) {
        const key = normalizeGenre(raw);
        if (GENRE_HEURISTICS[key]) matches.push(GENRE_HEURISTICS[key]);
    }

    if (matches.length === 0) return null;

    // Average numeric fields across all matching genres
    const fields = [
        'energy',
        'valence',
        'danceability',
        'acousticness',
        'instrumentalness',
        'liveness',
        'speechiness',
        'tempo',
        'key',
        'mode',
        'time_signature',
        'loudness'
    ] as const;

    const result: Partial<AudioEstimate> = {};
    for (const f of fields) {
        const values = matches
            .map(m => m[f])
            .filter((v): v is number => v !== undefined);
        if (values.length > 0) {
            result[f] = values.reduce((s, v) => s + v, 0) / values.length;
            // Round integer fields
            if (f === 'key' || f === 'mode' || f === 'time_signature') {
                result[f] = Math.round(result[f]!);
            }
        }
    }

    return result;
}

// ─── Enrichment Orchestrator ──────────────────────────────────────────────────

/** Enrich a single track: palette, lyrics, DNA estimation */
export async function enrichTrack(
    db: InstanceType<typeof Database>,
    trackId: number
): Promise<EnrichmentResult> {
    const result: EnrichmentResult = {
        trackId,
        palette: null,
        lyricsImported: false,
        dnaEstimated: false,
        mbTagsAdded: [],
        errors: []
    };

    const track = db
        .prepare('SELECT * FROM tracks WHERE id = ?')
        .get(trackId) as TrackRow | undefined;
    if (!track) {
        result.errors.push('Track not found');
        return result;
    }

    const dna = db
        .prepare('SELECT * FROM track_dna WHERE track_id = ?')
        .get(trackId) as DnaRow | undefined;
    const lore = db
        .prepare('SELECT * FROM track_lore WHERE track_id = ?')
        .get(trackId) as LoreRow | undefined;

    // Collect any MusicBrainz tags for DNA estimation
    const sourceIds = JSON.parse(track.source_ids || '{}') as Record<
        string,
        string
    >;
    const mbid = sourceIds.musicbrainz_id;

    let tags: string[] = [];
    if (lore?.themes) {
        try {
            tags = JSON.parse(lore.themes);
        } catch {
            /* ignore */
        }
    }

    // If we have an MBID but no tags yet, fetch enriched MB data
    if (mbid && tags.length === 0) {
        // Rate limit: wait 1.1s to respect MB
        await new Promise(r => setTimeout(r, 1100));
        const mbData = await fetchMBRecordingDetail(mbid);
        if (mbData?.tags && mbData.tags.length > 0) {
            tags = mbData.tags
                .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
                .slice(0, 15)
                .map(t => t.name);
            result.mbTagsAdded = tags;

            // Store as themes in lore
            if (lore) {
                db.prepare(
                    "UPDATE track_lore SET themes=?, updated_at=datetime('now') WHERE track_id=?"
                ).run(JSON.stringify(tags), trackId);
            } else {
                db.prepare(
                    'INSERT INTO track_lore (track_id, themes) VALUES (?, ?)'
                ).run(trackId, JSON.stringify(tags));
            }
        }
    }

    // 1. Extract palette from album art (always try to upgrade from algorithmic → real)
    if (track.cover_url) {
        try {
            const palette = await extractPaletteFromImage(track.cover_url);
            if (palette) {
                result.palette = palette;
                if (dna) {
                    db.prepare(
                        "UPDATE track_dna SET palette=?, updated_at=datetime('now') WHERE track_id=?"
                    ).run(JSON.stringify(palette), trackId);
                } else {
                    // Create DNA row with just the palette for now
                    db.prepare(
                        'INSERT INTO track_dna (track_id, palette) VALUES (?, ?)'
                    ).run(trackId, JSON.stringify(palette));
                }
            }
        } catch (e) {
            result.errors.push(`Palette extraction failed: ${e}`);
        }
    }

    // 2. Estimate DNA from genres if missing core features
    const needsDnaEstimate =
        !dna || dna.energy === null || dna.valence === null;
    if (needsDnaEstimate && tags.length > 0) {
        try {
            const estimated = estimateAudioFeaturesFromGenres(tags);
            if (estimated && Object.keys(estimated).length > 0) {
                const currentDna = db
                    .prepare('SELECT id FROM track_dna WHERE track_id = ?')
                    .get(trackId) as { id: number } | undefined;
                if (currentDna) {
                    db.prepare(`UPDATE track_dna SET
                        energy=COALESCE(energy,?), valence=COALESCE(valence,?),
                        danceability=COALESCE(danceability,?), acousticness=COALESCE(acousticness,?),
                        instrumentalness=COALESCE(instrumentalness,?), liveness=COALESCE(liveness,?),
                        speechiness=COALESCE(speechiness,?), tempo=COALESCE(tempo,?),
                        key=COALESCE(key,?), mode=COALESCE(mode,?),
                        time_signature=COALESCE(time_signature,?), loudness=COALESCE(loudness,?),
                        updated_at=datetime('now')
                        WHERE track_id=?`).run(
                        estimated.energy ?? null,
                        estimated.valence ?? null,
                        estimated.danceability ?? null,
                        estimated.acousticness ?? null,
                        estimated.instrumentalness ?? null,
                        estimated.liveness ?? null,
                        estimated.speechiness ?? null,
                        estimated.tempo ?? null,
                        estimated.key ?? null,
                        estimated.mode ?? null,
                        estimated.time_signature ?? null,
                        estimated.loudness ?? null,
                        trackId
                    );
                } else {
                    db.prepare(`INSERT INTO track_dna (track_id,
                        energy, valence, danceability, acousticness, instrumentalness,
                        liveness, speechiness, tempo, key, mode, time_signature, loudness)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
                        trackId,
                        estimated.energy ?? null,
                        estimated.valence ?? null,
                        estimated.danceability ?? null,
                        estimated.acousticness ?? null,
                        estimated.instrumentalness ?? null,
                        estimated.liveness ?? null,
                        estimated.speechiness ?? null,
                        estimated.tempo ?? null,
                        estimated.key ?? null,
                        estimated.mode ?? null,
                        estimated.time_signature ?? null,
                        estimated.loudness ?? null
                    );
                }
                result.dnaEstimated = true;
            }
        } catch (e) {
            result.errors.push(`DNA estimation failed: ${e}`);
        }
    }

    // 3. Fetch synced lyrics from LRCLIB (only if we don't have any)
    const existingLyrics = db
        .prepare(
            'SELECT COUNT(*) as c FROM track_lyrics_lrc WHERE track_id = ?'
        )
        .get(trackId) as { c: number };
    if (existingLyrics.c === 0) {
        try {
            const lyrics = await fetchLrclibLyrics(
                track.title,
                track.artist,
                track.duration_ms
            );
            if (lyrics && lyrics.length > 0) {
                const insert = db.prepare(
                    'INSERT INTO track_lyrics_lrc (track_id, time_seconds, text, line_index) VALUES (?, ?, ?, ?)'
                );
                const insertMany = db.transaction((lines: typeof lyrics) => {
                    lines.forEach((line, idx) =>
                        insert.run(trackId, line.time, line.text, idx)
                    );
                });
                insertMany(lyrics);
                result.lyricsImported = true;
            }
        } catch (e) {
            result.errors.push(`LRCLIB fetch failed: ${e}`);
        }
    }

    return result;
}

/** Enrich all tracks that are missing palette, DNA, or lyrics */
export async function enrichAllPending(
    db: InstanceType<typeof Database>,
    onProgress?: (result: EnrichmentResult) => void
): Promise<EnrichmentResult[]> {
    // Tracks missing palette OR energy OR lyrics
    const pendingTracks = db
        .prepare(`
        SELECT DISTINCT t.id FROM tracks t
        WHERE (
            NOT EXISTS (SELECT 1 FROM track_dna d WHERE d.track_id = t.id AND d.palette IS NOT NULL)
            OR NOT EXISTS (SELECT 1 FROM track_dna d WHERE d.track_id = t.id AND d.energy IS NOT NULL)
            OR NOT EXISTS (SELECT 1 FROM track_lyrics_lrc l WHERE l.track_id = t.id)
        )
        ORDER BY t.id
    `)
        .all() as Array<{ id: number }>;

    const results: EnrichmentResult[] = [];
    for (const { id } of pendingTracks) {
        const result = await enrichTrack(db, id);
        results.push(result);
        onProgress?.(result);
        // Brief pause between tracks to be kind to external APIs
        await new Promise(r => setTimeout(r, 500));
    }

    return results;
}
