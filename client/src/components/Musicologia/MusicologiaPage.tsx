import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Music, Clock, Disc3 } from 'lucide-react';
import { AppLayout } from '@/components/ui/app-layout';
import { Badge } from '@/components/ui/badge';

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

function formatDuration(ms: number) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function MusicologiaPage() {
    const navigate = useNavigate();
    const [tracks, setTracks] = useState<Track[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let ignore = false;
        setLoading(true);
        fetch('/app/api/musicologia/tracks?limit=100')
            .then(r => r.json())
            .then(data => {
                if (!ignore) {
                    setTracks(data.tracks ?? []);
                    setTotal(data.total ?? 0);
                    setLoading(false);
                }
            })
            .catch(() => { if (!ignore) setLoading(false); });
        return () => { ignore = true; };
    }, []);

    const handleTrackClick = (track: Track) => {
        if (track.artist_slug && track.track_slug) {
            navigate(`/musicologia/tracks/${track.artist_slug}/${track.track_slug}`);
        }
    };

    return (
        <AppLayout
            icon={<Music size={20} />}
            iconClassName="bg-purple-500/10 text-purple-500"
            title="Musicologia"
            subtitle={loading ? 'Loading…' : `${total} track${total !== 1 ? 's' : ''}`}
        >
            <div className="h-full overflow-y-auto p-6">
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="text-muted-foreground text-sm animate-pulse">Loading tracks…</div>
                    </div>
                ) : tracks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
                        <Disc3 className="h-12 w-12 opacity-20" />
                        <p className="text-sm">No tracks yet. Add some via the API.</p>
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
        </AppLayout>
    );
}

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
