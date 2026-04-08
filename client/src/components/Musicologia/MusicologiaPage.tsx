import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
    Music, Clock, Disc3, Search, X, Download, List, Loader2,
    CheckCircle2, AlertCircle, ExternalLink, RefreshCw, Sparkles
} from 'lucide-react';
import { AppLayout } from '@/components/ui/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Track {
    id: number;
    title: string;
    artist: string;
    artist_slug: string | null;
    track_slug: string | null;
    cover_url: string | null;
    duration_ms: number | null;
    tagline: string | null;
    energy: number | null;
    valence: number | null;
}

interface SearchResult {
    spotify_id: string;
    title: string;
    artist: string;
    album: string | null;
    cover_url: string | null;
    duration_ms: number;
    popularity: number;
    isrc: string | null;
}

interface ImportProgress {
    current: number;
    total: number;
    imported: number;
    errors: number;
    lastTrack?: string;
    done: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Search Modal ──────────────────────────────────────────────────────────────

function SearchImportModal({
    open,
    onClose,
    onImported,
}: {
    open: boolean;
    onClose: () => void;
    onImported: () => void;
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [importing, setImporting] = useState<string | null>(null); // spotifyId being imported
    const [imported, setImported] = useState<Set<string>>(new Set());
    const [searchError, setSearchError] = useState<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const doSearch = useCallback(async (q: string) => {
        if (!q.trim()) { setResults([]); return; }
        setSearching(true);
        setSearchError(null);
        try {
            const res = await fetch(`/app/api/musicologia/search?q=${encodeURIComponent(q)}`);
            if (!res.ok) {
                const d = await res.json().catch(() => ({})) as { error?: string };
                setSearchError(d.error ?? 'Search failed');
                setResults([]);
            } else {
                const d = await res.json() as { tracks: SearchResult[] };
                setResults(d.tracks ?? []);
            }
        } catch {
            setSearchError('Network error');
        } finally {
            setSearching(false);
        }
    }, []);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => doSearch(query), 400);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query, doSearch]);

    const handleImport = async (result: SearchResult) => {
        setImporting(result.spotify_id);
        try {
            const res = await fetch(`/app/api/musicologia/import/spotify/${result.spotify_id}`, { method: 'POST' });
            if (res.ok) {
                setImported(prev => new Set([...prev, result.spotify_id]));
                onImported();
            }
        } finally {
            setImporting(null);
        }
    };

    const handleClose = () => {
        setQuery('');
        setResults([]);
        setImported(new Set());
        setSearchError(null);
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={v => !v && handleClose()}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0">
                <DialogHeader className="p-4 pb-2 border-b">
                    <DialogTitle>Search & Import from Spotify</DialogTitle>
                    <DialogDescription>Find tracks on Spotify and import them with metadata and audio features.</DialogDescription>
                </DialogHeader>

                {/* Search bar */}
                <div className="px-4 py-3 border-b">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            className="pl-9 pr-8"
                            placeholder="Search tracks, artists, albums…"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            autoFocus
                        />
                        {query && (
                            <button
                                onClick={() => setQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Results */}
                <div className="flex-1 overflow-y-auto min-h-[200px]">
                    {searching && (
                        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Searching…
                        </div>
                    )}
                    {!searching && searchError && (
                        <div className="flex items-center justify-center h-32 gap-2 text-destructive text-sm">
                            <AlertCircle className="h-4 w-4" />
                            {searchError}
                        </div>
                    )}
                    {!searching && !searchError && results.length === 0 && query && (
                        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">No results found</div>
                    )}
                    {!searching && !searchError && results.length === 0 && !query && (
                        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Type to search</div>
                    )}
                    {!searching && results.length > 0 && (
                        <div className="divide-y divide-border/50">
                            {results.map(result => {
                                const isImported = imported.has(result.spotify_id);
                                const isImporting = importing === result.spotify_id;
                                return (
                                    <div key={result.spotify_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors">
                                        {/* Cover */}
                                        <div className="w-10 h-10 rounded shrink-0 overflow-hidden bg-muted">
                                            {result.cover_url
                                                ? <img src={result.cover_url} alt={result.title} className="w-full h-full object-cover" />
                                                : <div className="flex items-center justify-center h-full"><Music className="h-4 w-4 text-muted-foreground" /></div>
                                            }
                                        </div>
                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{result.title}</p>
                                            <p className="text-xs text-muted-foreground truncate">{result.artist}{result.album ? ` · ${result.album}` : ''}</p>
                                        </div>
                                        {/* Duration */}
                                        <span className="text-xs text-muted-foreground font-mono shrink-0 hidden sm:block">
                                            {formatDuration(result.duration_ms)}
                                        </span>
                                        {/* Import button */}
                                        <Button
                                            size="sm"
                                            variant={isImported ? 'secondary' : 'default'}
                                            className="shrink-0 h-7 px-2.5"
                                            disabled={isImporting || isImported}
                                            onClick={() => handleImport(result)}
                                        >
                                            {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                : isImported ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Imported</>
                                                : <><Download className="h-3.5 w-3.5 mr-1" />Import</>
                                            }
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="p-3 border-t flex justify-end">
                    <Button variant="outline" size="sm" onClick={handleClose}>
                        {imported.size > 0 ? `Done (${imported.size} imported)` : 'Close'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Playlist Import Modal ─────────────────────────────────────────────────────

function PlaylistImportModal({
    open,
    onClose,
    onImported,
}: {
    open: boolean;
    onClose: () => void;
    onImported: () => void;
}) {
    const [playlistInput, setPlaylistInput] = useState('');
    const [progress, setProgress] = useState<ImportProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const extractPlaylistId = (input: string): string => {
        const match = input.match(/playlist\/([A-Za-z0-9]+)/);
        return match ? match[1] : input.trim();
    };

    const handleImport = async () => {
        const id = extractPlaylistId(playlistInput);
        if (!id) return;
        setError(null);
        setProgress({ current: 0, total: 0, imported: 0, errors: 0, done: false });

        abortRef.current = new AbortController();
        try {
            const res = await fetch(`/app/api/musicologia/import/spotify/playlist/${encodeURIComponent(id)}`, {
                method: 'POST',
                signal: abortRef.current.signal,
            });

            if (!res.ok || !res.body) {
                const d = await res.json().catch(() => ({})) as { error?: string };
                setError(d.error ?? 'Failed to start import');
                setProgress(null);
                return;
            }

            // Read SSE stream
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                let eventType = '';
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (eventType === 'start') {
                                setProgress({ current: 0, total: data.total, imported: 0, errors: 0, done: false });
                            } else if (eventType === 'progress') {
                                setProgress({
                                    current: data.current,
                                    total: data.total,
                                    imported: data.imported,
                                    errors: data.errors,
                                    lastTrack: data.track ? `${data.track.artist} – ${data.track.title}` : undefined,
                                    done: false,
                                });
                            } else if (eventType === 'done') {
                                setProgress(prev => prev ? { ...prev, done: true, imported: data.imported, errors: data.errors } : null);
                                onImported();
                            } else if (eventType === 'error') {
                                setError(data.message ?? 'Unknown error');
                                setProgress(null);
                            }
                        } catch { /* malformed data */ }
                    }
                }
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setError(String(err));
                setProgress(null);
            }
        }
    };

    const handleClose = () => {
        abortRef.current?.abort();
        setPlaylistInput('');
        setProgress(null);
        setError(null);
        onClose();
    };

    const isDone = progress?.done === true;
    const isRunning = progress != null && !isDone;
    const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    return (
        <Dialog open={open} onOpenChange={v => !v && handleClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Import from Spotify Playlist</DialogTitle>
                    <DialogDescription>Paste a Spotify playlist URL or ID to bulk import all its tracks.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div>
                        <Input
                            placeholder="https://open.spotify.com/playlist/… or playlist ID"
                            value={playlistInput}
                            onChange={e => setPlaylistInput(e.target.value)}
                            disabled={isRunning}
                        />
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    {progress && (
                        <div className="space-y-2">
                            {/* Progress bar */}
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-purple-500 transition-all duration-300 rounded-full"
                                    style={{ width: `${isDone ? 100 : pct}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{isDone ? 'Complete!' : `${progress.current} / ${progress.total} tracks`}</span>
                                <span className="flex items-center gap-2">
                                    <span className="text-green-500">{progress.imported} imported</span>
                                    {progress.errors > 0 && <span className="text-destructive">{progress.errors} errors</span>}
                                </span>
                            </div>
                            {progress.lastTrack && !isDone && (
                                <p className="text-xs text-muted-foreground truncate">
                                    {isRunning && <Loader2 className="h-3 w-3 animate-spin inline mr-1" />}
                                    {progress.lastTrack}
                                </p>
                            )}
                            {isDone && (
                                <p className="text-xs text-green-500 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Done! {progress.imported} tracks imported.
                                </p>
                            )}
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={handleClose}>
                            {isDone ? 'Close' : 'Cancel'}
                        </Button>
                        {!isDone && (
                            <Button
                                size="sm"
                                onClick={handleImport}
                                disabled={!playlistInput.trim() || isRunning}
                            >
                                {isRunning
                                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Importing…</>
                                    : <><Download className="h-3.5 w-3.5 mr-1.5" />Import Playlist</>
                                }
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Connect Spotify Banner ────────────────────────────────────────────────────

function SpotifyConnectBanner({ onConnect }: { onConnect: () => void }) {
    return (
        <div className="flex items-center gap-3 px-4 py-2 bg-green-500/5 border border-green-500/20 rounded-lg text-sm">
            <div className="w-6 h-6 rounded-full bg-[#1DB954] flex items-center justify-center shrink-0">
                <Music className="h-3 w-3 text-black" />
            </div>
            <span className="text-muted-foreground flex-1">Connect Spotify to search and import tracks</span>
            <Button
                size="sm"
                variant="outline"
                className="h-7 border-green-500/40 text-green-400 hover:bg-green-500/10 cursor-pointer"
                onClick={onConnect}
            >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Connect
            </Button>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MusicologiaPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [tracks, setTracks] = useState<Track[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null);
    const [showSearch, setShowSearch] = useState(false);
    const [showPlaylist, setShowPlaylist] = useState(false);

    const loadTracks = useCallback(() => {
        let ignore = false;
        setLoading(true);
        fetch('/app/api/musicologia/tracks?limit=100')
            .then(r => r.json())
            .then(data => {
                if (!ignore) {
                    setTracks((data as { tracks: Track[] }).tracks ?? []);
                    setTotal((data as { total: number }).total ?? 0);
                    setLoading(false);
                }
            })
            .catch(() => { if (!ignore) setLoading(false); });
        return () => { ignore = true; };
    }, []);

    const checkSpotify = useCallback(() => {
        fetch('/app/api/musicologia/auth/spotify/status')
            .then(r => r.json())
            .then(d => setSpotifyConnected((d as { connected: boolean }).connected ?? false))
            .catch(() => setSpotifyConnected(false));
    }, []);

    useEffect(() => {
        checkSpotify();
        const cleanup = loadTracks();
        return cleanup;
    }, [checkSpotify, loadTracks]);

    // Handle ?spotify_connected=1 or ?spotify_error from OAuth callback
    useEffect(() => {
        if (searchParams.get('spotify_connected')) {
            setSpotifyConnected(true);
            setSearchParams({});
        } else if (searchParams.get('spotify_error')) {
            setSearchParams({});
        }
    }, [searchParams, setSearchParams]);

    const handleTrackClick = (track: Track) => {
        if (track.artist_slug && track.track_slug) {
            navigate(`/musicologia/tracks/${track.artist_slug}/${track.track_slug}`);
        }
    };

    const handleConnectSpotify = () => {
        window.location.href = '/app/api/musicologia/auth/spotify';
    };

    const handleDisconnectSpotify = async () => {
        await fetch('/app/api/musicologia/auth/spotify', { method: 'DELETE' });
        setSpotifyConnected(false);
    };

    const headerActions = (
        <div className="flex items-center gap-2">
            {spotifyConnected === true && (
                <>
                    <Button size="sm" variant="outline" onClick={() => setShowPlaylist(true)} className="cursor-pointer">
                        <List className="h-3.5 w-3.5 mr-1.5" />
                        Import Playlist
                    </Button>
                    <Button size="sm" onClick={() => setShowSearch(true)} className="cursor-pointer">
                        <Search className="h-3.5 w-3.5 mr-1.5" />
                        Search & Import
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        title="Refresh"
                        onClick={loadTracks}
                        className="cursor-pointer"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                </>
            )}
            <Button
                size="sm"
                variant="ghost"
                title="Batch Lore Generation"
                onClick={() => navigate('/musicologia/admin')}
                className="cursor-pointer text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
            >
                <Sparkles className="h-3.5 w-3.5" />
            </Button>
            {spotifyConnected === false && (
                <Button size="sm" variant="outline" onClick={handleConnectSpotify} className="cursor-pointer border-green-500/40 text-green-400 hover:bg-green-500/10">
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Connect Spotify
                </Button>
            )}
        </div>
    );

    return (
        <AppLayout
            icon={<Music size={20} />}
            iconClassName="bg-purple-500/10 text-purple-500"
            title="Musicologia"
            subtitle={loading ? 'Loading…' : `${total} track${total !== 1 ? 's' : ''}`}
            actions={headerActions}
        >
            <div className="h-full overflow-y-auto p-6 space-y-4">
                {/* Spotify connect banner (only when not connected and tracks > 0) */}
                {spotifyConnected === false && tracks.length > 0 && (
                    <SpotifyConnectBanner onConnect={handleConnectSpotify} />
                )}

                {/* Connected status chip */}
                {spotifyConnected === true && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        Spotify connected
                        <button
                            onClick={handleDisconnectSpotify}
                            className="text-muted-foreground/60 hover:text-muted-foreground underline cursor-pointer"
                        >
                            disconnect
                        </button>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="text-muted-foreground text-sm animate-pulse">Loading tracks…</div>
                    </div>
                ) : tracks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
                        <Disc3 className="h-12 w-12 opacity-20" />
                        <p className="text-sm">No tracks yet.</p>
                        {spotifyConnected === false && (
                            <Button size="sm" variant="outline" onClick={handleConnectSpotify} className="border-green-500/40 text-green-400 hover:bg-green-500/10 cursor-pointer">
                                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                Connect Spotify to import tracks
                            </Button>
                        )}
                        {spotifyConnected === true && (
                            <Button size="sm" onClick={() => setShowSearch(true)} className="cursor-pointer">
                                <Search className="h-3.5 w-3.5 mr-1.5" />
                                Search & Import
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {tracks.map(track => (
                            <TrackCard
                                key={track.id}
                                track={track}
                                onClick={() => handleTrackClick(track)}
                            />
                        ))}
                    </div>
                )}
            </div>

            <SearchImportModal
                open={showSearch}
                onClose={() => setShowSearch(false)}
                onImported={loadTracks}
            />
            <PlaylistImportModal
                open={showPlaylist}
                onClose={() => setShowPlaylist(false)}
                onImported={loadTracks}
            />
        </AppLayout>
    );
}

// ── Track Card ────────────────────────────────────────────────────────────────

function TrackCard({ track, onClick }: { track: Track; onClick: () => void }) {
    return (
        <div
            className="group flex flex-col gap-2 cursor-pointer"
            onClick={onClick}
        >
            {/* Cover */}
            <div className="relative aspect-square rounded-lg overflow-hidden bg-purple-500/5 border border-border/30 group-hover:border-purple-500/30 transition-colors">
                {track.cover_url ? (
                    <img
                        src={track.cover_url}
                        alt={track.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <Music className="h-8 w-8 text-purple-500/30" />
                    </div>
                )}
                {track.duration_ms != null && (
                    <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5 text-white/70" />
                        <span className="text-[10px] text-white/80 font-mono">{formatDuration(track.duration_ms)}</span>
                    </div>
                )}
                {track.energy != null && (
                    <div className="absolute top-1.5 left-1.5">
                        <Badge
                            variant="secondary"
                            className="text-[9px] px-1.5 py-0 bg-black/60 text-white/80 border-0"
                        >
                            {Math.round(track.energy * 100)}% energy
                        </Badge>
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="min-w-0">
                <p className="text-sm font-medium leading-tight truncate group-hover:text-purple-400 transition-colors">
                    {track.title}
                </p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{track.artist}</p>
                {track.tagline && (
                    <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5 italic">
                        {track.tagline}
                    </p>
                )}
            </div>
        </div>
    );
}
