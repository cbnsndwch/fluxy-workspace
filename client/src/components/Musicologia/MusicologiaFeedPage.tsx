import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { AppLayout } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { Rss, Globe, Users, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Actor {
    id: number | null;
    login: string | null;
    name: string | null;
    avatar_url: string | null;
}

interface Activity {
    id: number;
    verb: string;
    object_type: string;
    object_id: number;
    object_title: string | null;
    meta: Record<string, unknown> | null;
    created_at: string;
    actor: Actor;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VERB_LABELS: Record<string, string> = {
    listened: 'listened to',
    loved: 'reacted to',
    added_to_playlist: 'added',
    created_playlist: 'created playlist',
    commented: 'commented on',
    followed: 'followed',
};

function verbLabel(verb: string) {
    return VERB_LABELS[verb] ?? verb;
}

const VERB_COLORS: Record<string, string> = {
    loved: 'text-pink-400',
    commented: 'text-blue-400',
    followed: 'text-green-400',
    created_playlist: 'text-purple-400',
    added_to_playlist: 'text-violet-400',
    listened: 'text-white/40',
};

function Avatar({ src, name, size = 36 }: { src: string | null; name: string; size?: number }) {
    if (src) {
        return (
            <img
                src={src}
                alt={name}
                className="rounded-full object-cover flex-shrink-0 ring-1 ring-white/10"
                style={{ width: size, height: size }}
            />
        );
    }
    return (
        <div
            className="rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-white/50 font-semibold ring-1 ring-white/10"
            style={{ width: size, height: size, fontSize: size * 0.35 }}
        >
            {name.slice(0, 2).toUpperCase()}
        </div>
    );
}

function ActivityCard({ activity }: { activity: Activity }) {
    const actorName = activity.actor.name ?? activity.actor.login ?? 'Someone';
    const verbColor = VERB_COLORS[activity.verb] ?? 'text-white/40';
    const emoji = activity.meta?.emoji as string | undefined;

    const ts = (() => {
        try { return formatDistanceToNow(new Date(activity.created_at), { addSuffix: true }); }
        catch { return ''; }
    })();

    // Build object link
    let objectEl: React.ReactNode = null;
    if (activity.object_title) {
        if (activity.object_type === 'track' && activity.object_id) {
            objectEl = (
                <span className="text-white/70 font-medium">{activity.object_title}</span>
            );
        } else {
            objectEl = <span className="text-white/70 font-medium">{activity.object_title}</span>;
        }
    }

    return (
        <div className="flex gap-3 py-3 px-4 rounded-xl hover:bg-white/3 transition-colors group">
            <Avatar src={activity.actor.avatar_url} name={actorName} />
            <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-sm font-semibold text-white/80">{actorName}</span>
                    <span className={`text-sm ${verbColor}`}>{verbLabel(activity.verb)}</span>
                    {emoji && <span className="text-base">{emoji}</span>}
                    {objectEl && <span className="text-sm text-white/50 truncate max-w-[200px]">{objectEl}</span>}
                </div>
                <p className="text-xs text-white/25 mt-0.5">{ts}</p>
            </div>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MusicologiaFeedPage() {
    const [mode, setMode] = useState<'following' | 'global'>('global');
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(0);

    const LIMIT = 30;

    const loadFeed = useCallback(async (reset = false) => {
        setLoading(true);
        const off = reset ? 0 : offset;
        try {
            const endpoint = mode === 'global' ? '/app/api/musicologia/feed/global' : '/app/api/musicologia/feed';
            const res = await fetch(`${endpoint}?limit=${LIMIT}&offset=${off}`);
            if (!res.ok) return;
            const data = await res.json() as Activity[];
            if (reset) {
                setActivities(data);
                setOffset(data.length);
            } else {
                setActivities(prev => [...prev, ...data]);
                setOffset(prev => prev + data.length);
            }
            setHasMore(data.length === LIMIT);
        } finally {
            setLoading(false);
        }
    }, [mode, offset]);

    // Load on mode change
    useEffect(() => {
        setOffset(0);
        setHasMore(true);
        loadFeed(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    const handleRefresh = () => loadFeed(true);
    const handleLoadMore = () => loadFeed(false);

    return (
        <AppLayout
            icon={<Rss size={20} />}
            iconClassName="bg-purple-500/10 text-purple-500"
            title="Activity Feed"
            subtitle="See what the community is listening to and loving"
            actions={
                <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={loading} className="cursor-pointer">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </Button>
            }
        >
            <div className="flex flex-col h-full overflow-hidden">
                {/* Mode toggle */}
                <div className="flex gap-1 px-4 pt-4 pb-2">
                    <Button
                        variant={mode === 'following' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setMode('following')}
                        className="cursor-pointer"
                    >
                        <Users size={14} className="mr-1.5" />
                        Following
                    </Button>
                    <Button
                        variant={mode === 'global' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setMode('global')}
                        className="cursor-pointer"
                    >
                        <Globe size={14} className="mr-1.5" />
                        Global
                    </Button>
                </div>

                {/* Feed list */}
                <div className="flex-1 overflow-y-auto px-2">
                    {loading && activities.length === 0 && (
                        <div className="flex items-center justify-center py-16">
                            <div className="w-5 h-5 border-2 border-purple-500/40 border-t-purple-500 rounded-full animate-spin" />
                        </div>
                    )}

                    {!loading && activities.length === 0 && (
                        <div className="text-center py-16 text-white/30">
                            <Rss size={32} className="mx-auto mb-3 opacity-30" />
                            <p className="text-sm">
                                {mode === 'following'
                                    ? 'Follow people to see their activity here.'
                                    : 'No activity yet. Start listening and reacting!'}
                            </p>
                        </div>
                    )}

                    <div className="divide-y divide-white/4">
                        {activities.map(a => (
                            <ActivityCard key={a.id} activity={a} />
                        ))}
                    </div>

                    {hasMore && activities.length > 0 && (
                        <div className="py-4 flex justify-center">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleLoadMore}
                                disabled={loading}
                                className="cursor-pointer text-white/40"
                            >
                                {loading ? 'Loading…' : 'Load more'}
                            </Button>
                        </div>
                    )}
                </div>

                {/* Back to Musicologia link */}
                <div className="px-4 py-3 border-t border-white/5">
                    <Link to="/musicologia" className="text-xs text-white/30 hover:text-white/50 transition-colors">
                        ← Back to Musicologia
                    </Link>
                </div>
            </div>
        </AppLayout>
    );
}
