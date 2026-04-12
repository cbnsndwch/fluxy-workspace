import { useState } from 'react';

import { useAuthStore } from '@/store/auth';

const EMOJIS = ['🔥', '❤️', '😭', '🎵', '✨', '🤯'];

interface ReactionBarProps {
    trackId: number;
    counts: Record<string, number>;
    myReaction: string | null;
    onUpdate: (
        counts: Record<string, number>,
        myReaction: string | null
    ) => void;
    dark?: boolean;
}

export function ReactionBar({
    trackId,
    counts,
    myReaction,
    onUpdate,
    dark = false
}: ReactionBarProps) {
    const user = useAuthStore(s => s.user);
    const [loading, setLoading] = useState(false);

    async function toggle(emoji: string) {
        if (!user || loading) return;
        setLoading(true);
        try {
            const res = await fetch(
                `/app/api/musicologia/tracks/${trackId}/reactions`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emoji })
                }
            );
            if (res.ok) {
                const data = (await res.json()) as {
                    counts: Record<string, number>;
                    myReaction: string | null;
                };
                onUpdate(data.counts, data.myReaction);
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex flex-wrap gap-2 justify-center">
            {EMOJIS.map(emoji => {
                const count = counts[emoji] ?? 0;
                const isActive = myReaction === emoji;
                return (
                    <button
                        key={emoji}
                        onClick={() => toggle(emoji)}
                        disabled={!user || loading}
                        className={[
                            'flex flex-col items-center gap-1 px-3 py-2 rounded-xl border transition-all cursor-pointer',
                            dark
                                ? isActive
                                    ? 'border-white/40 bg-white/15 scale-105'
                                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                                : isActive
                                  ? 'border-purple-400/60 bg-purple-500/10 scale-105'
                                  : 'border-border bg-muted/40 hover:bg-muted',
                            !user ? 'opacity-50 cursor-not-allowed' : ''
                        ].join(' ')}
                    >
                        <span className="text-xl leading-none">{emoji}</span>
                        <span
                            className={`text-xs tabular-nums ${dark ? 'text-white/60' : 'text-muted-foreground'}`}
                        >
                            {count > 0 ? count : ''}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
