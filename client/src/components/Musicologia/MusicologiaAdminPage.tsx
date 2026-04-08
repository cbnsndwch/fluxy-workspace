import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Music, Sparkles, Loader2, CheckCircle2, XCircle, ArrowLeft, Square, CheckSquare } from 'lucide-react';
import { AppLayout } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';

interface TrackWithoutLore {
    id: number;
    title: string;
    artist: string;
    cover_url: string | null;
    artist_slug: string | null;
    track_slug: string | null;
    energy: number | null;
    valence: number | null;
    tempo: number | null;
}

interface BatchProgress {
    trackId: number | null;
    status: 'generating' | 'done' | 'failed' | 'skipped' | 'complete';
    done: number;
    total: number;
    error?: string;
}

type TrackStatus = 'pending' | 'generating' | 'done' | 'failed' | 'skipped';

export default function MusicologiaAdminPage() {
    const navigate = useNavigate();
    const [tracks, setTracks] = useState<TrackWithoutLore[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [running, setRunning] = useState(false);
    const [trackStatuses, setTrackStatuses] = useState<Record<number, TrackStatus>>({});
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [complete, setComplete] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        fetch('/app/api/musicologia/admin/tracks-without-lore')
            .then(r => r.json())
            .then(d => {
                setTracks((d as { tracks: TrackWithoutLore[] }).tracks ?? []);
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

    const selectAll = () => setSelected(new Set(tracks.map(t => t.id)));
    const selectNone = () => setSelected(new Set());

    const handleBatchGenerate = async () => {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        setRunning(true);
        setComplete(false);
        setProgress({ done: 0, total: ids.length });

        // Set all selected to pending
        const initStatuses: Record<number, TrackStatus> = {};
        ids.forEach(id => { initStatuses[id] = 'pending'; });
        setTrackStatuses(initStatuses);

        abortRef.current = new AbortController();

        try {
            const res = await fetch('/app/api/musicologia/admin/batch-generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackIds: ids }),
                signal: abortRef.current.signal,
            });

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
                        const event = JSON.parse(line.slice(6)) as BatchProgress;
                        if (event.trackId != null) {
                            setTrackStatuses(prev => ({ ...prev, [event.trackId!]: event.status as TrackStatus }));
                        }
                        setProgress({ done: event.done, total: event.total });
                        if (event.status === 'complete') {
                            setComplete(true);
                            setRunning(false);
                        }
                    } catch { /* malformed */ }
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
        // Remove tracks that were successfully generated from the list
        const doneIds = new Set(
            Object.entries(trackStatuses)
                .filter(([, s]) => s === 'done')
                .map(([id]) => parseInt(id))
        );
        setTracks(prev => prev.filter(t => !doneIds.has(t.id)));
        setSelected(prev => { const n = new Set(prev); doneIds.forEach(id => n.delete(id)); return n; });
        setTrackStatuses({});
        setProgress(null);
        setComplete(false);
    };

    const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

    return (
        <AppLayout
            icon={<Music size={20} />}
            iconClassName="bg-purple-500/10 text-purple-500"
            title="Musicologia"
            subtitle="Batch Lore Generation"
            actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('/musicologia')} className="cursor-pointer">
                    <ArrowLeft className="h-4 w-4 mr-1" /> Gallery
                </Button>
            }
        >
            <div className="h-full overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto flex flex-col gap-5">

                    {/* Header row */}
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                            <h2 className="text-base font-semibold">Tracks without lore</h2>
                            <p className="text-xs text-muted-foreground">
                                {loading ? 'Loading…' : `${tracks.length} track${tracks.length !== 1 ? 's' : ''} need lore`}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={selectAll} className="cursor-pointer text-xs" disabled={running}>
                                Select all
                            </Button>
                            <Button variant="ghost" size="sm" onClick={selectNone} className="cursor-pointer text-xs" disabled={running}>
                                Clear
                            </Button>
                        </div>
                    </div>

                    {/* Progress bar */}
                    {progress && (
                        <div className="rounded-xl border border-border/30 bg-card/50 p-4 flex flex-col gap-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">
                                    {complete ? 'Batch complete!' : 'Generating lore…'}
                                </span>
                                <span className="text-muted-foreground font-mono text-xs">{progress.done} / {progress.total}</span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                <div
                                    className="h-full bg-purple-500 rounded-full transition-all duration-300"
                                    style={{ width: `${complete ? 100 : pct}%` }}
                                />
                            </div>
                            {complete && (
                                <Button size="sm" variant="outline" onClick={handleDone} className="self-end cursor-pointer">
                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                                    Done
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Action bar */}
                    {!complete && (
                        <div className="flex items-center gap-2">
                            {running ? (
                                <Button variant="destructive" size="sm" onClick={handleStop} className="cursor-pointer">
                                    Stop
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    onClick={handleBatchGenerate}
                                    disabled={selected.size === 0 || running}
                                    className="cursor-pointer bg-purple-500 hover:bg-purple-600"
                                >
                                    {running
                                        ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating…</>
                                        : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate Lore for {selected.size} track{selected.size !== 1 ? 's' : ''}</>
                                    }
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Track list */}
                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <div className="text-muted-foreground text-sm animate-pulse">Loading tracks…</div>
                        </div>
                    ) : tracks.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/30 p-8 text-center">
                            <CheckCircle2 className="h-8 w-8 text-green-500/40 mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">All tracks have lore. You're good!</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {tracks.map(track => {
                                const status = trackStatuses[track.id];
                                const isSelected = selected.has(track.id);
                                return (
                                    <div
                                        key={track.id}
                                        onClick={() => !running && toggleSelect(track.id)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                                            isSelected
                                                ? 'border-purple-500/40 bg-purple-500/5'
                                                : 'border-border/30 bg-card/30'
                                        } ${!running ? 'cursor-pointer hover:border-purple-500/30' : 'cursor-default'}`}
                                    >
                                        {/* Checkbox / status */}
                                        <div className="shrink-0 w-5 h-5 flex items-center justify-center">
                                            {status === 'generating' && <Loader2 className="h-4 w-4 text-purple-400 animate-spin" />}
                                            {status === 'done' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                                            {status === 'failed' && <XCircle className="h-4 w-4 text-destructive" />}
                                            {(status === 'pending' || !status) && (
                                                isSelected
                                                    ? <CheckSquare className="h-4 w-4 text-purple-400" />
                                                    : <Square className="h-4 w-4 text-muted-foreground/40" />
                                            )}
                                        </div>

                                        {/* Cover */}
                                        <div className="w-9 h-9 rounded shrink-0 overflow-hidden bg-muted">
                                            {track.cover_url
                                                ? <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
                                                : <div className="flex items-center justify-center h-full"><Music className="h-3.5 w-3.5 text-muted-foreground" /></div>
                                            }
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{track.title}</p>
                                            <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
                                        </div>

                                        {/* Status label */}
                                        {status === 'done' && <span className="text-xs text-green-500 shrink-0">Done</span>}
                                        {status === 'failed' && <span className="text-xs text-destructive shrink-0">Failed</span>}
                                        {status === 'generating' && <span className="text-xs text-purple-400 shrink-0">Generating…</span>}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
