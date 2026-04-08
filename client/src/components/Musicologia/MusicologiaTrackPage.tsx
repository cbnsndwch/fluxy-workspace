import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Music, Clock, Zap, Heart, Activity, Mic2, Guitar } from 'lucide-react';
import { AppLayout } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Track {
    id: number;
    title: string;
    artist: string;
    cover_url: string | null;
    duration_ms: number | null;
    source_ids: string;
}

interface TrackDna {
    tempo: number | null;
    key: number | null;
    mode: number | null;
    energy: number | null;
    valence: number | null;
    danceability: number | null;
    loudness: number | null;
    acousticness: number | null;
    instrumentalness: number | null;
    liveness: number | null;
    speechiness: number | null;
    time_signature: number | null;
}

interface TrackLore {
    tagline: string | null;
    story: string | null;
    trivia: string;
    themes: string;
    credits: string;
}

interface TrackDetail {
    track: Track;
    dna: TrackDna | null;
    lore: TrackLore | null;
    lyrics: Array<{ id: number; start_ms: number; end_ms: number; text: string; emphasis: number }>;
}

const KEY_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function formatDuration(ms: number) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function DnaStat({ label, value, icon: Icon, percent = false }: {
    label: string;
    value: number | null;
    icon?: React.ComponentType<{ className?: string }>;
    percent?: boolean;
}) {
    if (value == null) return null;
    const pct = percent ? Math.round(value * 100) : null;
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {label}
                </div>
                <span className="text-xs font-mono font-medium">
                    {percent ? `${pct}%` : value}
                </span>
            </div>
            {percent && (
                <div className="h-1 rounded-full bg-border/40 overflow-hidden">
                    <div
                        className="h-full rounded-full bg-purple-500/70 transition-all"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}
        </div>
    );
}

export default function MusicologiaTrackPage() {
    const { artistSlug, trackSlug } = useParams<{ artistSlug: string; trackSlug: string }>();
    const navigate = useNavigate();
    const [detail, setDetail] = useState<TrackDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        if (!artistSlug || !trackSlug) return;
        let ignore = false;
        setLoading(true);
        fetch(`/app/api/musicologia/tracks/${artistSlug}/${trackSlug}`)
            .then(r => {
                if (r.status === 404) { if (!ignore) { setNotFound(true); setLoading(false); } return null; }
                return r.json();
            })
            .then(data => {
                if (!ignore && data) {
                    setDetail(data);
                    setLoading(false);
                }
            })
            .catch(() => { if (!ignore) setLoading(false); });
        return () => { ignore = true; };
    }, [artistSlug, trackSlug]);

    if (loading) {
        return (
            <AppLayout
                icon={<Music size={20} />}
                iconClassName="bg-purple-500/10 text-purple-500"
                title="Musicologia"
            >
                <div className="flex items-center justify-center h-full">
                    <div className="text-muted-foreground text-sm animate-pulse">Loading track…</div>
                </div>
            </AppLayout>
        );
    }

    if (notFound || !detail) {
        return (
            <AppLayout
                icon={<Music size={20} />}
                iconClassName="bg-purple-500/10 text-purple-500"
                title="Musicologia"
                actions={
                    <Button variant="ghost" size="sm" onClick={() => navigate('/musicologia')} className="cursor-pointer">
                        <ArrowLeft className="h-4 w-4 mr-1" /> Back
                    </Button>
                }
            >
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    Track not found.
                </div>
            </AppLayout>
        );
    }

    const { track, dna, lore, lyrics } = detail;
    const trivia: string[] = lore?.trivia ? JSON.parse(lore.trivia) : [];
    const themes: string[] = lore?.themes ? JSON.parse(lore.themes) : [];

    return (
        <AppLayout
            icon={<Music size={20} />}
            iconClassName="bg-purple-500/10 text-purple-500"
            title="Musicologia"
            subtitle={`${track.artist} · ${track.title}`}
            actions={
                <Button variant="ghost" size="sm" onClick={() => navigate('/musicologia')} className="cursor-pointer">
                    <ArrowLeft className="h-4 w-4 mr-1" /> Gallery
                </Button>
            }
        >
            <div className="h-full overflow-y-auto">
                <div className="max-w-4xl mx-auto p-6 flex flex-col gap-6">
                    {/* Hero */}
                    <div className="flex gap-6">
                        <div className="shrink-0 w-40 h-40 rounded-xl overflow-hidden bg-purple-500/5 border border-border/30 flex items-center justify-center">
                            {track.cover_url ? (
                                <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
                            ) : (
                                <Music className="h-12 w-12 text-purple-500/30" />
                            )}
                        </div>
                        <div className="flex flex-col justify-end gap-1.5 min-w-0">
                            <p className="text-xs text-muted-foreground uppercase tracking-widest">Track</p>
                            <h1 className="text-3xl font-bold leading-tight">{track.title}</h1>
                            <p className="text-lg text-muted-foreground">{track.artist}</p>
                            {lore?.tagline && (
                                <p className="text-sm text-purple-400 italic mt-1">{lore.tagline}</p>
                            )}
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {track.duration_ms != null && (
                                    <Badge variant="secondary" className="gap-1">
                                        <Clock className="h-3 w-3" />
                                        {formatDuration(track.duration_ms)}
                                    </Badge>
                                )}
                                {dna?.tempo != null && (
                                    <Badge variant="secondary" className="gap-1">
                                        <Activity className="h-3 w-3" />
                                        {Math.round(dna.tempo)} BPM
                                    </Badge>
                                )}
                                {dna?.key != null && (
                                    <Badge variant="secondary">
                                        {KEY_NAMES[dna.key]}{dna.mode === 0 ? 'm' : ''} {dna.time_signature ? `· ${dna.time_signature}/4` : ''}
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* DNA Stats */}
                    {dna && (
                        <div className="rounded-xl border border-border/30 bg-card/50 p-5">
                            <h2 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Audio DNA</h2>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                                <DnaStat label="Energy" value={dna.energy} icon={Zap} percent />
                                <DnaStat label="Valence" value={dna.valence} icon={Heart} percent />
                                <DnaStat label="Danceability" value={dna.danceability} percent />
                                <DnaStat label="Acousticness" value={dna.acousticness} icon={Guitar} percent />
                                <DnaStat label="Instrumentalness" value={dna.instrumentalness} percent />
                                <DnaStat label="Liveness" value={dna.liveness} percent />
                                <DnaStat label="Speechiness" value={dna.speechiness} icon={Mic2} percent />
                                {dna.loudness != null && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">Loudness</span>
                                        <span className="text-xs font-mono font-medium">{dna.loudness.toFixed(1)} dB</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Lore */}
                    {(lore?.story || trivia.length > 0 || themes.length > 0) && (
                        <div className="rounded-xl border border-border/30 bg-card/50 p-5 flex flex-col gap-4">
                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Lore</h2>
                            {lore?.story && (
                                <p className="text-sm leading-relaxed text-foreground/80">{lore.story}</p>
                            )}
                            {themes.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {themes.map((t: string) => (
                                        <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                                    ))}
                                </div>
                            )}
                            {trivia.length > 0 && (
                                <ul className="list-disc list-inside space-y-1">
                                    {trivia.map((item: string, i: number) => (
                                        <li key={i} className="text-xs text-muted-foreground">{item}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    {/* Lyrics placeholder */}
                    {lyrics.length > 0 ? (
                        <div className="rounded-xl border border-border/30 bg-card/50 p-5">
                            <h2 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Lyrics</h2>
                            <div className="space-y-1.5">
                                {lyrics.map(line => (
                                    <p
                                        key={line.id}
                                        className={`text-sm leading-relaxed ${line.emphasis ? 'text-purple-400 font-medium' : 'text-foreground/70'}`}
                                    >
                                        {line.text}
                                    </p>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-dashed border-border/30 p-5 text-center">
                            <p className="text-xs text-muted-foreground/50">Lyrics coming soon</p>
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
