import {
    Music,
    Sparkles,
    Loader2,
    CheckCircle2,
    XCircle,
    ArrowLeft,
    Square,
    CheckSquare,
    ListMusic,
    RefreshCw,
    ClipboardList,
    Download,
    Upload,
    BarChart3,
    AlertCircle,
    ShieldAlert
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '@/store/auth';
// ── Types ──────────────────────────────────────────────────────────────────────

interface AdminStats {
    total: number;
    withoutLore: number;
    withoutLyrics: number;
}

interface TrackWithoutLore {
    id: number;
    title: string;
    artist: string;
    cover_url: string | null;
}

interface BatchLoreProgress {
    trackId: number | null;
    status: 'generating' | 'done' | 'error' | 'complete';
    done: number;
    total: number;
    title?: string;
    error?: string;
}

type TrackStatus = 'pending' | 'generating' | 'done' | 'failed';

interface AuditEntry {
    id: number;
    user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: number | null;
    meta: string;
    created_at: string;
}

// ── Stats Panel ────────────────────────────────────────────────────────────────

function StatsPanel() {
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [loading, setLoading] = useState(true);

    const load = () => {
        setLoading(true);
        fetch('/app/api/musicologia/admin/stats')
            .then(r => r.json())
            .then((d: AdminStats) => {
                setStats(d);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    const statCards = stats
        ? [
              {
                  label: 'Total Tracks',
                  value: stats.total,
                  icon: <ListMusic size={16} />,
                  color: 'text-purple-400'
              },
              {
                  label: 'Missing Lore',
                  value: stats.withoutLore,
                  icon: <Sparkles size={16} />,
                  color: 'text-amber-400'
              },
              {
                  label: 'Missing Lyrics',
                  value: stats.withoutLyrics,
                  icon: <Music size={16} />,
                  color: 'text-blue-400'
              }
          ]
        : [];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Library Overview
                </h3>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={load}
                    className="cursor-pointer h-7 px-2"
                >
                    <RefreshCw
                        size={14}
                        className={loading ? 'animate-spin' : ''}
                    />
                </Button>
            </div>
            {loading ? (
                <div className="grid grid-cols-3 gap-3">
                    {[0, 1, 2].map(i => (
                        <div
                            key={i}
                            className="rounded-xl border border-border/30 bg-card/50 p-4 animate-pulse h-20"
                        />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-3 gap-3">
                    {statCards.map(card => (
                        <div
                            key={card.label}
                            className="rounded-xl border border-border/30 bg-card/50 p-4 flex flex-col gap-2"
                        >
                            <div
                                className={`flex items-center gap-1.5 text-xs text-muted-foreground ${card.color}`}
                            >
                                {card.icon}
                                <span>{card.label}</span>
                            </div>
                            <p className="text-2xl font-bold tabular-nums">
                                {card.value.toLocaleString()}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Batch Lore Generation ──────────────────────────────────────────────────────

function BatchLoreTab() {
    const [tracks, setTracks] = useState<TrackWithoutLore[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [running, setRunning] = useState(false);
    const [trackStatuses, setTrackStatuses] = useState<
        Record<number, TrackStatus>
    >({});
    const [progress, setProgress] = useState<{
        done: number;
        total: number;
    } | null>(null);
    const [complete, setComplete] = useState(false);
    const [log, setLog] = useState<
        Array<{ title: string; status: 'done' | 'failed' }>
    >([]);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        fetch('/app/api/musicologia/admin/tracks-without-lore')
            .then(r => r.json())
            .then((d: { tracks: TrackWithoutLore[] }) => {
                setTracks(d.tracks ?? []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const toggleSelect = (id: number) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleBatchGenerate = async () => {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        setRunning(true);
        setComplete(false);
        setLog([]);
        setProgress({ done: 0, total: ids.length });
        const initStatuses: Record<number, TrackStatus> = {};
        ids.forEach(id => {
            initStatuses[id] = 'pending';
        });
        setTrackStatuses(initStatuses);

        abortRef.current = new AbortController();

        try {
            const res = await fetch(
                '/app/api/musicologia/admin/batch-lore-generate',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trackIds: ids }),
                    signal: abortRef.current.signal
                }
            );
            if (!res.ok || !res.body) {
                setRunning(false);
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const event = JSON.parse(
                            line.slice(6)
                        ) as BatchLoreProgress;
                        if (event.trackId != null) {
                            const st =
                                event.status === 'error'
                                    ? 'failed'
                                    : (event.status as TrackStatus);
                            setTrackStatuses(prev => ({
                                ...prev,
                                [event.trackId!]: st
                            }));
                            if (
                                event.status === 'done' ||
                                event.status === 'error'
                            ) {
                                setLog(prev => [
                                    ...prev,
                                    {
                                        title:
                                            event.title ??
                                            String(event.trackId),
                                        status:
                                            event.status === 'done'
                                                ? 'done'
                                                : 'failed'
                                    }
                                ]);
                            }
                        }
                        setProgress({ done: event.done, total: event.total });
                        if (event.status === 'complete') {
                            setComplete(true);
                            setRunning(false);
                        }
                    } catch {
                        /* malformed */
                    }
                }
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') setRunning(false);
        }
        setRunning(false);
    };

    const handleStop = () => {
        abortRef.current?.abort();
        setRunning(false);
    };

    const handleDone = () => {
        const doneIds = new Set(
            Object.entries(trackStatuses)
                .filter(([, s]) => s === 'done')
                .map(([id]) => parseInt(id))
        );
        setTracks(prev => prev.filter(t => !doneIds.has(t.id)));
        setSelected(prev => {
            const n = new Set(prev);
            doneIds.forEach(id => n.delete(id));
            return n;
        });
        setTrackStatuses({});
        setProgress(null);
        setComplete(false);
        setLog([]);
    };

    const pct =
        progress && progress.total > 0
            ? Math.round((progress.done / progress.total) * 100)
            : 0;

    return (
        <div className="flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold">
                        Tracks without lore
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {loading
                            ? 'Loading…'
                            : `${tracks.length} track${tracks.length !== 1 ? 's' : ''} need lore`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                            setSelected(new Set(tracks.map(t => t.id)))
                        }
                        disabled={running}
                        className="cursor-pointer text-xs"
                    >
                        Select all
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected(new Set())}
                        disabled={running}
                        className="cursor-pointer text-xs"
                    >
                        Clear
                    </Button>
                </div>
            </div>

            {/* Progress */}
            {progress && (
                <div className="rounded-xl border border-border/30 bg-card/50 p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">
                            {complete ? 'Batch complete!' : 'Generating lore…'}
                        </span>
                        <span className="text-muted-foreground font-mono text-xs">
                            {progress.done} / {progress.total}
                        </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                            className="h-full bg-purple-500 rounded-full transition-all duration-300"
                            style={{ width: `${complete ? 100 : pct}%` }}
                        />
                    </div>
                    {log.length > 0 && (
                        <div className="max-h-28 overflow-y-auto flex flex-col gap-0.5">
                            {log.slice(-8).map((entry, i) => (
                                <div
                                    key={i}
                                    className="flex items-center gap-1.5 text-xs"
                                >
                                    {entry.status === 'done' ? (
                                        <CheckCircle2
                                            size={11}
                                            className="text-green-500 shrink-0"
                                        />
                                    ) : (
                                        <XCircle
                                            size={11}
                                            className="text-destructive shrink-0"
                                        />
                                    )}
                                    <span className="truncate text-muted-foreground">
                                        {entry.title}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    {complete && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleDone}
                            className="self-end cursor-pointer"
                        >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-500" />{' '}
                            Done
                        </Button>
                    )}
                </div>
            )}

            {/* Action bar */}
            {!complete && (
                <div className="flex gap-2">
                    {running ? (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleStop}
                            className="cursor-pointer"
                        >
                            Stop
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            onClick={handleBatchGenerate}
                            disabled={selected.size === 0}
                            className="cursor-pointer bg-purple-500 hover:bg-purple-600"
                        >
                            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                            Generate lore for {selected.size} track
                            {selected.size !== 1 ? 's' : ''}
                        </Button>
                    )}
                </div>
            )}

            {/* Track list */}
            {loading ? (
                <div className="flex items-center justify-center h-40">
                    <div className="text-muted-foreground text-sm animate-pulse">
                        Loading tracks…
                    </div>
                </div>
            ) : tracks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/30 p-8 text-center">
                    <CheckCircle2 className="h-8 w-8 text-green-500/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                        All tracks have lore. You're good!
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {tracks.map(track => {
                        const status = trackStatuses[track.id];
                        const isSelected = selected.has(track.id);
                        return (
                            <button
                                type="button"
                                key={track.id}
                                onClick={() =>
                                    !running && toggleSelect(track.id)
                                }
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors w-full text-left ${isSelected ? 'border-purple-500/40 bg-purple-500/5' : 'border-border/30 bg-card/30'} ${!running ? 'cursor-pointer hover:border-purple-500/30' : 'cursor-default'}`}
                            >
                                <div className="shrink-0 w-5 h-5 flex items-center justify-center">
                                    {status === 'generating' && (
                                        <Loader2 className="h-4 w-4 text-purple-400 animate-spin" />
                                    )}
                                    {status === 'done' && (
                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                    )}
                                    {status === 'failed' && (
                                        <XCircle className="h-4 w-4 text-destructive" />
                                    )}
                                    {(!status || status === 'pending') &&
                                        (isSelected ? (
                                            <CheckSquare className="h-4 w-4 text-purple-400" />
                                        ) : (
                                            <Square className="h-4 w-4 text-muted-foreground/40" />
                                        ))}
                                </div>
                                <div className="w-9 h-9 rounded shrink-0 overflow-hidden bg-muted">
                                    {track.cover_url ? (
                                        <img
                                            src={track.cover_url}
                                            alt={track.title}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full">
                                            <Music className="h-3.5 w-3.5 text-muted-foreground" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">
                                        {track.title}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {track.artist}
                                    </p>
                                </div>
                                {status === 'done' && (
                                    <span className="text-xs text-green-500 shrink-0">
                                        Done
                                    </span>
                                )}
                                {status === 'failed' && (
                                    <span className="text-xs text-destructive shrink-0">
                                        Failed
                                    </span>
                                )}
                                {status === 'generating' && (
                                    <span className="text-xs text-purple-400 shrink-0">
                                        Generating…
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Playlist Import ────────────────────────────────────────────────────────────

function ImportTab() {
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<{
        imported: number;
        skipped: number;
        errors: number;
        total: number;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{
        synced: number;
        total?: number;
        message?: string;
    } | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);

    const handleImport = async () => {
        if (!playlistUrl.trim()) return;
        setImporting(true);
        setResult(null);
        setError(null);
        try {
            const res = await fetch(
                '/app/api/musicologia/admin/import-playlist',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playlistUrl: playlistUrl.trim() })
                }
            );
            const data = (await res.json()) as {
                imported?: number;
                skipped?: number;
                errors?: number;
                total?: number;
                error?: string;
            };
            if (!res.ok) {
                setError(data.error ?? 'Import failed');
            } else {
                setResult({
                    imported: data.imported ?? 0,
                    skipped: data.skipped ?? 0,
                    errors: data.errors ?? 0,
                    total: data.total ?? 0
                });
                setPlaylistUrl('');
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Import failed');
        }
        setImporting(false);
    };

    const handleSync = async () => {
        setSyncing(true);
        setSyncResult(null);
        setSyncError(null);
        try {
            const res = await fetch(
                '/app/api/musicologia/admin/sync-audio-features',
                { method: 'POST' }
            );
            const data = (await res.json()) as {
                synced?: number;
                total?: number;
                message?: string;
                error?: string;
            };
            if (!res.ok) {
                setSyncError(data.error ?? 'Sync failed');
            } else {
                setSyncResult({
                    synced: data.synced ?? 0,
                    total: data.total,
                    message: data.message
                });
            }
        } catch (e: unknown) {
            setSyncError(e instanceof Error ? e.message : 'Sync failed');
        }
        setSyncing(false);
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Playlist Import */}
            <div className="rounded-xl border border-border/30 bg-card/50 p-5 flex flex-col gap-4">
                <div className="flex items-center gap-2">
                    <Download size={16} className="text-purple-400" />
                    <h3 className="text-sm font-semibold">
                        Import Spotify Playlist
                    </h3>
                </div>
                <p className="text-xs text-muted-foreground">
                    Paste a Spotify playlist URL to import all tracks. Requires
                    Spotify connection.
                </p>
                <div className="flex gap-2">
                    <Input
                        value={playlistUrl}
                        onChange={e => setPlaylistUrl(e.target.value)}
                        placeholder="https://open.spotify.com/playlist/..."
                        className="flex-1 text-sm"
                        disabled={importing}
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleImport();
                        }}
                    />
                    <Button
                        size="sm"
                        onClick={handleImport}
                        disabled={importing || !playlistUrl.trim()}
                        className="cursor-pointer bg-purple-500 hover:bg-purple-600 shrink-0"
                    >
                        {importing ? (
                            <>
                                <Loader2
                                    size={14}
                                    className="mr-1.5 animate-spin"
                                />
                                Importing…
                            </>
                        ) : (
                            'Import'
                        )}
                    </Button>
                </div>
                {result && (
                    <div className="flex items-center gap-3 text-sm rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-3">
                        <CheckCircle2
                            size={15}
                            className="text-green-500 shrink-0"
                        />
                        <span>
                            <strong>{result.imported}</strong> imported ·{' '}
                            <strong>{result.skipped}</strong> skipped ·{' '}
                            <strong>{result.errors}</strong> errors
                            <span className="text-muted-foreground ml-1">
                                ({result.total} total)
                            </span>
                        </span>
                    </div>
                )}
                {error && (
                    <div className="flex items-center gap-2 text-sm rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-destructive">
                        <AlertCircle size={14} className="shrink-0" />
                        {error}
                    </div>
                )}
            </div>

            {/* Sync Audio Features */}
            <div className="rounded-xl border border-border/30 bg-card/50 p-5 flex flex-col gap-4">
                <div className="flex items-center gap-2">
                    <RefreshCw size={16} className="text-blue-400" />
                    <h3 className="text-sm font-semibold">
                        Sync Audio Features
                    </h3>
                </div>
                <p className="text-xs text-muted-foreground">
                    Re-fetch Spotify audio features (tempo, energy, valence,
                    etc.) for tracks that are missing DNA data.
                </p>
                <div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSync}
                        disabled={syncing}
                        className="cursor-pointer"
                    >
                        {syncing ? (
                            <>
                                <Loader2
                                    size={14}
                                    className="mr-1.5 animate-spin"
                                />
                                Syncing…
                            </>
                        ) : (
                            <>
                                <RefreshCw size={14} className="mr-1.5" />
                                Sync Missing Features
                            </>
                        )}
                    </Button>
                </div>
                {syncResult && (
                    <div className="flex items-center gap-3 text-sm rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-3">
                        <CheckCircle2
                            size={15}
                            className="text-blue-400 shrink-0"
                        />
                        {syncResult.message ? (
                            syncResult.message
                        ) : (
                            <span>
                                <strong>{syncResult.synced}</strong> tracks
                                synced
                                {syncResult.total
                                    ? ` of ${syncResult.total}`
                                    : ''}
                            </span>
                        )}
                    </div>
                )}
                {syncError && (
                    <div className="flex items-center gap-2 text-sm rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-destructive">
                        <AlertCircle size={14} className="shrink-0" />
                        {syncError}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── LRC Lyrics Editor ──────────────────────────────────────────────────────────

function LyricsTab() {
    const [trackId, setTrackId] = useState('');
    const [lrc, setLrc] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveResult, setSaveResult] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Preview parsed lines
    const parsedLines = lrc.trim()
        ? (() => {
              const lrcPattern = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/;
              const lines: { time: string; text: string }[] = [];
              for (const raw of lrc.split('\n')) {
                  const m = raw.trim().match(lrcPattern);
                  if (!m) continue;
                  const text = m[3].trim();
                  if (!text) continue;
                  lines.push({ time: `${m[1]}:${m[2]}`, text });
              }
              return lines;
          })()
        : [];

    const handleLoad = async () => {
        if (!trackId.trim()) return;
        setLoading(true);
        try {
            const res = await fetch(
                `/app/api/musicologia/tracks/${trackId.trim()}/lyrics`
            );
            const data = (await res.json()) as Array<{
                time_seconds: number;
                text: string;
            }>;
            if (Array.isArray(data) && data.length > 0) {
                const lrcText = data
                    .map(l => {
                        const totalSec = l.time_seconds;
                        const min = Math.floor(totalSec / 60);
                        const sec = (totalSec % 60).toFixed(2).padStart(5, '0');
                        return `[${String(min).padStart(2, '0')}:${sec}] ${l.text}`;
                    })
                    .join('\n');
                setLrc(lrcText);
                setSaveResult(null);
                setSaveError(null);
            } else {
                setLrc('');
                setSaveResult('No lyrics found for this track.');
            }
        } catch {
            setSaveError('Failed to load lyrics');
        }
        setLoading(false);
    };

    const handleSave = async () => {
        if (!trackId.trim() || !lrc.trim()) return;
        setSaving(true);
        setSaveResult(null);
        setSaveError(null);
        try {
            const res = await fetch(
                `/app/api/musicologia/tracks/${trackId.trim()}/lyrics`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lrc })
                }
            );
            const data = (await res.json()) as {
                imported?: number;
                error?: string;
            };
            if (!res.ok) {
                setSaveError(data.error ?? 'Save failed');
            } else {
                setSaveResult(`Saved ${data.imported} lines.`);
            }
        } catch (e: unknown) {
            setSaveError(e instanceof Error ? e.message : 'Save failed');
        }
        setSaving(false);
    };

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h3 className="text-sm font-semibold">LRC Lyrics Editor</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Edit time-synced lyrics in LRC format. Format:{' '}
                    <code className="font-mono text-xs bg-muted px-1 rounded">
                        [mm:ss.xx] Lyric line
                    </code>
                </p>
            </div>

            {/* Track ID input */}
            <div className="flex gap-2">
                <Input
                    value={trackId}
                    onChange={e => setTrackId(e.target.value)}
                    placeholder="Track ID (number)"
                    className="w-40 text-sm"
                    type="number"
                />
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoad}
                    disabled={loading || !trackId.trim()}
                    className="cursor-pointer"
                >
                    {loading ? (
                        <Loader2 size={14} className="animate-spin" />
                    ) : (
                        'Load'
                    )}
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
                {/* LRC input */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                        LRC Input
                    </label>
                    <Textarea
                        value={lrc}
                        onChange={e => setLrc(e.target.value)}
                        placeholder={
                            '[00:12.00] First line\n[00:17.20] Second line'
                        }
                        className="font-mono text-xs h-64 resize-none"
                    />
                </div>

                {/* Preview */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                        Preview ({parsedLines.length} lines)
                    </label>
                    <div className="h-64 overflow-y-auto rounded-md border border-border/30 bg-muted/30 p-3 flex flex-col gap-0.5">
                        {parsedLines.length === 0 ? (
                            <p className="text-xs text-muted-foreground/50 italic">
                                Start typing to preview…
                            </p>
                        ) : (
                            parsedLines.map((line, i) => (
                                <div key={i} className="flex gap-2 text-xs">
                                    <span className="font-mono text-muted-foreground/60 shrink-0">
                                        {line.time}
                                    </span>
                                    <span>{line.text}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || !trackId.trim() || !lrc.trim()}
                    className="cursor-pointer bg-purple-500 hover:bg-purple-600"
                >
                    {saving ? (
                        <>
                            <Loader2
                                size={14}
                                className="mr-1.5 animate-spin"
                            />
                            Saving…
                        </>
                    ) : (
                        <>
                            <Upload size={14} className="mr-1.5" />
                            Save Lyrics
                        </>
                    )}
                </Button>
                {saveResult && (
                    <span className="text-xs text-green-500">{saveResult}</span>
                )}
                {saveError && (
                    <span className="text-xs text-destructive">
                        {saveError}
                    </span>
                )}
            </div>
        </div>
    );
}

// ── Audit Log ──────────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
    'track.created': 'bg-green-500/15 text-green-400',
    'lore.generated': 'bg-purple-500/15 text-purple-400',
    'lyrics.imported': 'bg-blue-500/15 text-blue-400',
    'track.deleted': 'bg-red-500/15 text-red-400'
};

function AuditTab() {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionFilter, setActionFilter] = useState('');

    const load = (action?: string) => {
        setLoading(true);
        const params = new URLSearchParams({ limit: '50' });
        if (action) params.set('action', action);
        fetch(`/app/api/musicologia/admin/audit?${params}`)
            .then(r => r.json())
            .then((d: AuditEntry[]) => {
                setEntries(d);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    const handleFilterChange = (val: string) => {
        setActionFilter(val);
        load(val || undefined);
    };

    const uniqueActions = [
        '',
        'track.created',
        'lore.generated',
        'lyrics.imported',
        'track.deleted'
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Audit Log</h3>
                <div className="flex items-center gap-2">
                    <select
                        value={actionFilter}
                        onChange={e => handleFilterChange(e.target.value)}
                        className="text-xs rounded-md border border-border/40 bg-background px-2 py-1 cursor-pointer"
                    >
                        <option value="">All actions</option>
                        {uniqueActions.slice(1).map(a => (
                            <option key={a} value={a}>
                                {a}
                            </option>
                        ))}
                    </select>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => load(actionFilter || undefined)}
                        className="cursor-pointer h-7 px-2"
                    >
                        <RefreshCw
                            size={14}
                            className={loading ? 'animate-spin' : ''}
                        />
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col gap-2">
                    {[0, 1, 2, 3].map(i => (
                        <div
                            key={i}
                            className="h-12 rounded-lg bg-muted/30 animate-pulse"
                        />
                    ))}
                </div>
            ) : entries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/30 p-8 text-center">
                    <ClipboardList className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                        No audit entries yet.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {entries.map(entry => {
                        let meta: Record<string, unknown> = {};
                        try {
                            meta = JSON.parse(entry.meta ?? '{}') as Record<
                                string,
                                unknown
                            >;
                        } catch {
                            /* */
                        }
                        const colorClass =
                            ACTION_COLORS[entry.action] ??
                            'bg-muted/50 text-muted-foreground';
                        return (
                            <div
                                key={entry.id}
                                className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border/20 bg-card/30 text-xs"
                            >
                                <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${colorClass}`}
                                >
                                    {entry.action}
                                </span>
                                <span className="text-muted-foreground shrink-0">
                                    {entry.entity_type}{' '}
                                    {entry.entity_id
                                        ? `#${entry.entity_id}`
                                        : ''}
                                </span>
                                {meta.title ? (
                                    <span className="truncate text-foreground/80">
                                        {String(meta.title)}
                                    </span>
                                ) : null}
                                {meta.source ? (
                                    <span className="text-muted-foreground/60 shrink-0">
                                        {String(meta.source)}
                                    </span>
                                ) : null}
                                <span className="ml-auto text-muted-foreground/50 shrink-0 font-mono">
                                    {new Date(entry.created_at).toLocaleString(
                                        undefined,
                                        {
                                            month: 'short',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        }
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Main Admin Page ────────────────────────────────────────────────────────────

export default function MusicologiaAdminPage() {
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuthStore();

    // Admin gate — only user #1 (workspace owner / Diego)
    const isAdmin = user?.id === 1;

    if (!authLoading && !isAdmin) {
        return (
            <AppLayout
                icon={<ShieldAlert size={20} />}
                iconClassName="bg-red-500/10 text-red-500"
                title="Musicologia Admin"
                subtitle="Access restricted"
                actions={
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate('/musicologia')}
                        className="cursor-pointer"
                    >
                        <ArrowLeft className="h-4 w-4 mr-1" /> Gallery
                    </Button>
                }
            >
                <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                        <ShieldAlert className="h-12 w-12 text-red-500/20 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground">
                            Admin access required.
                        </p>
                    </div>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout
            icon={<Music size={20} />}
            iconClassName="bg-purple-500/10 text-purple-500"
            title="Musicologia"
            subtitle="Admin Dashboard"
            actions={
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/musicologia')}
                    className="cursor-pointer"
                >
                    <ArrowLeft className="h-4 w-4 mr-1" /> Gallery
                </Button>
            }
        >
            <div className="h-full overflow-y-auto p-6">
                <div className="max-w-4xl mx-auto flex flex-col gap-6">
                    {/* Stats */}
                    <StatsPanel />

                    {/* Tabs */}
                    <Tabs defaultValue="lore">
                        <TabsList className="grid grid-cols-4 w-full">
                            <TabsTrigger
                                value="lore"
                                className="cursor-pointer"
                            >
                                <Sparkles size={13} className="mr-1.5" /> Lore
                            </TabsTrigger>
                            <TabsTrigger
                                value="import"
                                className="cursor-pointer"
                            >
                                <Download size={13} className="mr-1.5" /> Import
                            </TabsTrigger>
                            <TabsTrigger
                                value="lyrics"
                                className="cursor-pointer"
                            >
                                <ListMusic size={13} className="mr-1.5" />{' '}
                                Lyrics
                            </TabsTrigger>
                            <TabsTrigger
                                value="audit"
                                className="cursor-pointer"
                            >
                                <BarChart3 size={13} className="mr-1.5" /> Audit
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="lore" className="mt-5">
                            <BatchLoreTab />
                        </TabsContent>

                        <TabsContent value="import" className="mt-5">
                            <ImportTab />
                        </TabsContent>

                        <TabsContent value="lyrics" className="mt-5">
                            <LyricsTab />
                        </TabsContent>

                        <TabsContent value="audit" className="mt-5">
                            <AuditTab />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </AppLayout>
    );
}
