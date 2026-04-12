import {
    Music,
    Clock,
    Disc3,
    Search,
    X,
    Download,
    List,
    Loader2,
    CheckCircle2,
    AlertCircle,
    ExternalLink,
    RefreshCw,
    Sparkles,
    Headphones,
    ChevronDown
} from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { ListeningTab, ScrobblerStatus } from './ListeningTab';

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
    onImported
}: {
    open: boolean;
    onClose: () => void;
    onImported: () => void;
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [importing, setImporting] = useState<string | null>(null);
    const [imported, setImported] = useState<Set<string>>(new Set());
    const [searchError, setSearchError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [total, setTotal] = useState(0);
    const offsetRef = useRef(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const fetchPage = useCallback(
        async (q: string, offset: number, _append: boolean) => {
            const url = `/app/api/musicologia/search?q=${encodeURIComponent(q)}&offset=${offset}`;
            const res = await fetch(url);
            if (!res.ok) {
                const d = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
                throw new Error(d.error ?? 'Search failed');
            }
            return res.json() as Promise<{
                tracks: SearchResult[];
                total: number;
                hasMore: boolean;
            }>;
        },
        []
    );

    const doSearch = useCallback(
        async (q: string) => {
            if (!q.trim()) {
                setResults([]);
                setHasMore(false);
                setTotal(0);
                return;
            }
            setSearching(true);
            setSearchError(null);
            offsetRef.current = 0;
            try {
                const d = await fetchPage(q, 0, false);
                setResults(d.tracks ?? []);
                setTotal(d.total ?? 0);
                setHasMore(d.hasMore ?? false);
                offsetRef.current = d.tracks?.length ?? 0;
            } catch (e) {
                setSearchError(
                    e instanceof Error ? e.message : 'Search failed'
                );
                setResults([]);
            } finally {
                setSearching(false);
            }
        },
        [fetchPage]
    );

    const loadMore = useCallback(async () => {
        if (loadingMore || !hasMore || !query.trim()) return;
        setLoadingMore(true);
        try {
            const d = await fetchPage(query, offsetRef.current, true);
            setResults(prev => [...prev, ...(d.tracks ?? [])]);
            setHasMore(d.hasMore ?? false);
            offsetRef.current += d.tracks?.length ?? 0;
        } catch {
            // silently ignore load-more errors
        } finally {
            setLoadingMore(false);
        }
    }, [loadingMore, hasMore, query, fetchPage]);

    // Debounce new searches
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => doSearch(query), 400);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, doSearch]);

    // IntersectionObserver for infinite scroll sentinel
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0]?.isIntersecting) loadMore();
            },
            { threshold: 0.1 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [loadMore]);

    const handleImport = async (result: SearchResult) => {
        setImporting(result.spotify_id);
        try {
            const res = await fetch(
                `/app/api/musicologia/import/spotify/${result.spotify_id}`,
                {
                    method: 'POST'
                }
            );
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
        setHasMore(false);
        setTotal(0);
        offsetRef.current = 0;
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={v => !v && handleClose()}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0">
                <DialogHeader className="p-4 pb-2 border-b">
                    <DialogTitle>Search & Import from Spotify</DialogTitle>
                    <DialogDescription>
                        Find tracks on Spotify and import them with metadata and
                        audio features.
                    </DialogDescription>
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
                    {total > 0 && !searching && (
                        <p className="text-xs text-muted-foreground mt-1.5 ml-1">
                            {total.toLocaleString()} results — showing{' '}
                            {results.length}
                        </p>
                    )}
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
                    {!searching &&
                        !searchError &&
                        results.length === 0 &&
                        query && (
                            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                                No results found
                            </div>
                        )}
                    {!searching &&
                        !searchError &&
                        results.length === 0 &&
                        !query && (
                            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                                Type to search
                            </div>
                        )}
                    {!searching && results.length > 0 && (
                        <div className="divide-y divide-border/50">
                            {results.map(result => {
                                const isImported = imported.has(
                                    result.spotify_id
                                );
                                const isImporting =
                                    importing === result.spotify_id;
                                return (
                                    <div
                                        key={result.spotify_id}
                                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors"
                                    >
                                        {/* Cover */}
                                        <div className="w-10 h-10 rounded shrink-0 overflow-hidden bg-muted">
                                            {result.cover_url ? (
                                                <img
                                                    src={result.cover_url}
                                                    alt={result.title}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="flex items-center justify-center h-full">
                                                    <Music className="h-4 w-4 text-muted-foreground" />
                                                </div>
                                            )}
                                        </div>
                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">
                                                {result.title}
                                            </p>
                                            <p className="text-xs text-muted-foreground truncate">
                                                {result.artist}
                                                {result.album
                                                    ? ` · ${result.album}`
                                                    : ''}
                                            </p>
                                        </div>
                                        {/* Duration */}
                                        <span className="text-xs text-muted-foreground font-mono shrink-0 hidden sm:block">
                                            {formatDuration(result.duration_ms)}
                                        </span>
                                        {/* Import button */}
                                        <Button
                                            size="sm"
                                            variant={
                                                isImported
                                                    ? 'secondary'
                                                    : 'default'
                                            }
                                            className="shrink-0 h-7 px-2.5"
                                            disabled={isImporting || isImported}
                                            onClick={() => handleImport(result)}
                                        >
                                            {isImporting ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : isImported ? (
                                                <>
                                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                                    Imported
                                                </>
                                            ) : (
                                                <>
                                                    <Download className="h-3.5 w-3.5 mr-1" />
                                                    Import
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                );
                            })}
                            {/* Infinite scroll sentinel */}
                            <div
                                ref={sentinelRef}
                                className="py-3 flex items-center justify-center"
                            >
                                {loadingMore && (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                                {!loadingMore &&
                                    !hasMore &&
                                    results.length > 0 && (
                                        <span className="text-xs text-muted-foreground">
                                            All {results.length} results loaded
                                        </span>
                                    )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-3 border-t flex justify-end">
                    <Button variant="outline" size="sm" onClick={handleClose}>
                        {imported.size > 0
                            ? `Done (${imported.size} imported)`
                            : 'Close'}
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
    onImported
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
        setProgress({
            current: 0,
            total: 0,
            imported: 0,
            errors: 0,
            done: false
        });

        abortRef.current = new AbortController();
        try {
            const res = await fetch(
                `/app/api/musicologia/import/spotify/playlist/${encodeURIComponent(id)}`,
                {
                    method: 'POST',
                    signal: abortRef.current.signal
                }
            );

            if (!res.ok || !res.body) {
                const d = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
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
                                setProgress({
                                    current: 0,
                                    total: data.total,
                                    imported: 0,
                                    errors: 0,
                                    done: false
                                });
                            } else if (eventType === 'progress') {
                                setProgress({
                                    current: data.current,
                                    total: data.total,
                                    imported: data.imported,
                                    errors: data.errors,
                                    lastTrack: data.track
                                        ? `${data.track.artist} – ${data.track.title}`
                                        : undefined,
                                    done: false
                                });
                            } else if (eventType === 'done') {
                                setProgress(prev =>
                                    prev
                                        ? {
                                              ...prev,
                                              done: true,
                                              imported: data.imported,
                                              errors: data.errors
                                          }
                                        : null
                                );
                                onImported();
                            } else if (eventType === 'error') {
                                setError(data.message ?? 'Unknown error');
                                setProgress(null);
                            }
                        } catch {
                            /* malformed data */
                        }
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
    const pct =
        progress && progress.total > 0
            ? Math.round((progress.current / progress.total) * 100)
            : 0;

    return (
        <Dialog open={open} onOpenChange={v => !v && handleClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Import from Spotify Playlist</DialogTitle>
                    <DialogDescription>
                        Paste a Spotify playlist URL or ID to bulk import all
                        its tracks.
                    </DialogDescription>
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
                                <span>
                                    {isDone
                                        ? 'Complete!'
                                        : `${progress.current} / ${progress.total} tracks`}
                                </span>
                                <span className="flex items-center gap-2">
                                    <span className="text-green-500">
                                        {progress.imported} imported
                                    </span>
                                    {progress.errors > 0 && (
                                        <span className="text-destructive">
                                            {progress.errors} errors
                                        </span>
                                    )}
                                </span>
                            </div>
                            {progress.lastTrack && !isDone && (
                                <p className="text-xs text-muted-foreground truncate">
                                    {isRunning && (
                                        <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
                                    )}
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
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleClose}
                        >
                            {isDone ? 'Close' : 'Cancel'}
                        </Button>
                        {!isDone && (
                            <Button
                                size="sm"
                                onClick={handleImport}
                                disabled={!playlistInput.trim() || isRunning}
                            >
                                {isRunning ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        Importing…
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-3.5 w-3.5 mr-1.5" />
                                        Import Playlist
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MusicologiaPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [tracks, setTracks] = useState<Track[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(
        null
    );
    const [showSearch, setShowSearch] = useState(false);
    const [showPlaylist, setShowPlaylist] = useState(false);
    const [activeTab, setActiveTab] = useState('library');
    const [queueCount, setQueueCount] = useState(0);

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
            .catch(() => {
                if (!ignore) setLoading(false);
            });
        return () => {
            ignore = true;
        };
    }, []);

    const checkSpotify = useCallback(() => {
        fetch('/app/api/musicologia/auth/spotify/status')
            .then(r => r.json())
            .then(d =>
                setSpotifyConnected(
                    (d as { connected: boolean }).connected ?? false
                )
            )
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

    // Poll queue count for badge
    useEffect(() => {
        const fetchQueueCount = () => {
            fetch('/app/api/musicologia/staging?status=pending')
                .then(r => r.json())
                .then((d: { staging?: unknown[] }) =>
                    setQueueCount(d.staging?.length ?? 0)
                )
                .catch(() => {});
        };
        fetchQueueCount();
        const t = setInterval(fetchQueueCount, 60_000);
        return () => clearInterval(t);
    }, []);

    const handleTrackClick = (track: Track) => {
        if (track.artist_slug && track.track_slug) {
            navigate(
                `/musicologia/tracks/${track.artist_slug}/${track.track_slug}`
            );
        }
    };

    const handleConnectSpotify = () => {
        window.location.href = '/app/api/musicologia/auth/spotify';
    };

    const handleDisconnectSpotify = async () => {
        await fetch('/app/api/musicologia/auth/spotify', { method: 'DELETE' });
        setSpotifyConnected(false);
    };

    if (activeTab === 'listening') {
        return (
            <div className="h-full flex flex-col bg-[#0a0a14] text-white overflow-hidden">
                {/* Minimal sticky header for non-library tabs */}
                <div className="flex items-center gap-4 px-6 py-4 border-b border-white/5 shrink-0">
                    <span className="text-white/30 text-xs uppercase tracking-widest font-semibold">
                        Musicologia
                    </span>
                    <div className="flex items-center gap-1.5 ml-auto">
                        <ScrobblerStatus spotifyConnected={spotifyConnected} />
                        <button
                            onClick={() => setActiveTab('library')}
                            className="px-3.5 py-1.5 rounded-full text-xs font-medium text-white/40 hover:text-white/70 border border-transparent hover:border-white/10 transition-all cursor-pointer"
                        >
                            <Disc3 className="w-3 h-3 inline mr-1 -mt-0.5" />
                            Library
                        </button>
                        <button
                            onClick={() => setActiveTab('listening')}
                            className="px-3.5 py-1.5 rounded-full text-xs font-medium bg-white/10 text-white border border-white/20 transition-all cursor-pointer flex items-center gap-1.5"
                        >
                            <Headphones className="w-3 h-3" />
                            Listening
                            {queueCount > 0 && (
                                <span className="w-4 h-4 rounded-full bg-emerald-500/80 text-white text-[9px] font-bold flex items-center justify-center">
                                    {queueCount}
                                </span>
                            )}
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-hidden">
                    <ListeningTab queueCount={queueCount} />
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
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto bg-[#0a0a14] text-white overflow-x-hidden">
            {/* ── Full-bleed Hero ──────────────────────────────────────────── */}
            <header className="relative flex flex-col items-center justify-center min-h-[70vh] px-6 text-center overflow-hidden">
                {/* Animated radial gradient backdrop */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background: `
                            radial-gradient(ellipse 80% 50% at 50% -10%, #7c3aed33 0%, transparent 60%),
                            radial-gradient(ellipse 60% 40% at 80% 80%, #ec489922 0%, transparent 50%),
                            radial-gradient(ellipse 40% 60% at 20% 70%, #d9770622 0%, transparent 50%)
                        `
                    }}
                />

                {/* Subtle grid overlay */}
                <div
                    className="absolute inset-0 pointer-events-none opacity-[0.03]"
                    style={{
                        backgroundImage: `
                            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
                        `,
                        backgroundSize: '60px 60px'
                    }}
                />

                {/* Top-right action bar */}
                <div className="absolute top-5 right-5 z-20 flex items-center gap-2 flex-wrap justify-end max-w-xs">
                    <ScrobblerStatus spotifyConnected={spotifyConnected} />
                    {spotifyConnected === true && activeTab === 'library' && (
                        <>
                            <button
                                onClick={() => setShowPlaylist(true)}
                                className="px-3 py-1.5 rounded-full text-xs font-medium border border-white/10 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer"
                            >
                                <List className="w-3 h-3" /> Playlist
                            </button>
                            <button
                                onClick={() => setShowSearch(true)}
                                className="px-3 py-1.5 rounded-full text-xs font-medium border border-white/10 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer"
                            >
                                <Search className="w-3 h-3" /> Import
                            </button>
                            <button
                                onClick={loadTracks}
                                className="w-7 h-7 flex items-center justify-center rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-all cursor-pointer"
                                title="Refresh"
                            >
                                <RefreshCw className="w-3 h-3" />
                            </button>
                        </>
                    )}
                    <button
                        onClick={() => navigate('/musicologia/admin')}
                        className="w-7 h-7 flex items-center justify-center rounded-full border border-purple-500/20 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 transition-all cursor-pointer"
                        title="Admin"
                    >
                        <Sparkles className="w-3 h-3" />
                    </button>
                    {spotifyConnected === false && (
                        <button
                            onClick={handleConnectSpotify}
                            className="px-3 py-1.5 rounded-full text-xs font-medium border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 text-green-400 hover:text-green-300 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <ExternalLink className="w-3 h-3" /> Connect Spotify
                        </button>
                    )}
                    {spotifyConnected === true && (
                        <button
                            onClick={handleDisconnectSpotify}
                            className="text-[10px] text-white/20 hover:text-white/40 transition-colors cursor-pointer"
                            title="Disconnect Spotify"
                        >
                            ✕ spotify
                        </button>
                    )}
                </div>

                {/* Hero content */}
                <div className="relative z-10 flex flex-col items-center gap-5 max-w-2xl">
                    {/* Title */}
                    <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter bg-gradient-to-r from-purple-400 via-fuchsia-300 to-amber-400 bg-clip-text text-transparent drop-shadow-lg leading-none pb-2">
                        Musicologia
                    </h1>

                    {/* Tagline */}
                    <p className="text-white/40 text-base md:text-lg max-w-md leading-relaxed font-light">
                        A living archive. Each track opens an immersive
                        experience — audio, visuals, lore, and composition.
                    </p>

                    {/* Stats */}
                    {!loading && total > 0 && (
                        <div className="flex items-center gap-4 text-sm text-white/30">
                            <span className="flex items-center gap-1.5">
                                <Music className="w-3.5 h-3.5" />
                                {total} track{total !== 1 ? 's' : ''}
                            </span>
                            <span className="w-px h-3 bg-white/10" />
                            <span className="flex items-center gap-1.5">
                                <Headphones className="w-3.5 h-3.5" />
                                Listening active
                            </span>
                        </div>
                    )}

                    {/* Tab switcher as inline pills */}
                    <div className="flex items-center gap-2 mt-2">
                        <button
                            onClick={() => setActiveTab('library')}
                            className={`px-5 py-2 rounded-full text-sm font-medium transition-all cursor-pointer ${
                                activeTab === 'library'
                                    ? 'bg-white/10 text-white border border-white/20'
                                    : 'text-white/40 hover:text-white/70 border border-transparent hover:border-white/10'
                            }`}
                        >
                            <Disc3 className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                            Library
                        </button>
                        <button
                            onClick={() => setActiveTab('listening')}
                            className={`px-5 py-2 rounded-full text-sm font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                                activeTab === 'listening'
                                    ? 'bg-white/10 text-white border border-white/20'
                                    : 'text-white/40 hover:text-white/70 border border-transparent hover:border-white/10'
                            }`}
                        >
                            <Headphones className="w-3.5 h-3.5" />
                            Listening
                            {queueCount > 0 && (
                                <span className="w-4 h-4 rounded-full bg-emerald-500/80 text-white text-[9px] font-bold flex items-center justify-center">
                                    {queueCount}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Bouncing scroll CTA */}
                <div className="absolute bottom-8 flex flex-col items-center gap-2 animate-bounce">
                    <span className="text-white/20 text-[10px] uppercase tracking-widest">
                        Scroll
                    </span>
                    <ChevronDown className="w-4 h-4 text-white/20" />
                </div>
            </header>

            {/* ── Library Content ──────────────────────────────────────── */}
            <main className="px-6 pb-24">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-white/30 text-sm animate-pulse">
                            Loading tracks…
                        </div>
                    </div>
                ) : tracks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-5 text-white/40">
                        <Disc3 className="h-16 w-16 opacity-20" />
                        <p className="text-sm">No tracks yet.</p>
                        {spotifyConnected === false && (
                            <button
                                onClick={handleConnectSpotify}
                                className="px-6 py-2.5 rounded-full text-sm font-medium border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 text-green-400 transition-all flex items-center gap-2 cursor-pointer"
                            >
                                <ExternalLink className="w-4 h-4" /> Connect
                                Spotify to import tracks
                            </button>
                        )}
                        {spotifyConnected === true && (
                            <button
                                onClick={() => setShowSearch(true)}
                                className="px-6 py-2.5 rounded-full text-sm font-medium bg-white/10 hover:bg-white/15 text-white border border-white/10 transition-all flex items-center gap-2 cursor-pointer"
                            >
                                <Search className="w-4 h-4" /> Search & Import
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="flex items-baseline justify-between mb-8">
                            <h2 className="text-white/40 text-xs uppercase tracking-widest font-semibold">
                                All Experiences
                            </h2>
                            <span className="text-white/20 text-xs">
                                {total} track{total !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
                            {tracks.map(track => (
                                <TrackCard
                                    key={track.id}
                                    track={track}
                                    onClick={() => handleTrackClick(track)}
                                />
                            ))}
                        </div>
                    </>
                )}
            </main>

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
        </div>
    );
}

// ── Track Card ────────────────────────────────────────────────────────────────

function trackAccentColor(
    energy: number | null,
    valence: number | null
): string {
    // Derive an accent color from energy + valence
    // energy: 0=low (blue/cool) → 1=high (orange/warm)
    // valence: 0=sad (desaturated) → 1=happy (saturated)
    const e = energy ?? 0.5;
    const v = valence ?? 0.5;
    const hue = Math.round(260 - e * 200); // 260 (purple) → 60 (yellow)
    const sat = Math.round(40 + v * 50); // 40% → 90%
    return `hsl(${hue}, ${sat}%, 62%)`;
}

function TrackCard({ track, onClick }: { track: Track; onClick: () => void }) {
    const accent = trackAccentColor(track.energy, track.valence);
    const accentDim = trackAccentColor(track.energy, track.valence).replace(
        '62%)',
        '30%)'
    );

    return (
        <button
            type="button"
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 hover:border-white/25 transition-all duration-500 hover:scale-[1.03] hover:shadow-2xl cursor-pointer w-full text-left"
            style={{ background: '#0e0e1a' }}
            onClick={onClick}
        >
            {/* Cover — square */}
            <div className="relative w-full aspect-square overflow-hidden">
                {track.cover_url ? (
                    <img
                        src={track.cover_url}
                        alt={track.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                ) : (
                    <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{
                            background: `radial-gradient(circle at 40% 40%, ${accentDim}, #0e0e1a)`
                        }}
                    >
                        <Music
                            className="w-12 h-12 opacity-20"
                            style={{ color: accent }}
                        />
                    </div>
                )}

                {/* Hover energy ripple */}
                <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700"
                    style={{
                        background: `radial-gradient(circle at 50% 50%, ${accentDim}, transparent 70%)`
                    }}
                />

                {/* Duration badge */}
                {track.duration_ms != null && (
                    <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[10px] font-medium border border-white/20 backdrop-blur-sm text-white/60 bg-black/60 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatDuration(track.duration_ms)}
                    </span>
                )}

                {/* Energy bar at bottom */}
                {track.energy != null && (
                    <div
                        className="absolute bottom-0 left-0 right-0 h-0.5 opacity-60"
                        style={{
                            background: `linear-gradient(to right, ${accent}, transparent ${Math.round(track.energy * 100)}%)`
                        }}
                    />
                )}
            </div>

            {/* Track info */}
            <div className="p-4 flex flex-col gap-1">
                <p className="text-sm font-bold text-white leading-tight truncate">
                    {track.title}
                </p>
                <p className="text-xs text-white/45 truncate">{track.artist}</p>
                {track.tagline && (
                    <p
                        className="text-[10px] italic mt-0.5 truncate opacity-40"
                        style={{ color: accent }}
                    >
                        {track.tagline}
                    </p>
                )}
            </div>

            {/* "Enter" CTA — slides in on hover */}
            <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                <span
                    className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest"
                    style={{ color: accent }}
                >
                    Enter
                    <svg
                        className="w-3 h-3"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            d="M8 5l8 7-8 7"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                        />
                    </svg>
                </span>
            </div>
        </button>
    );
}
