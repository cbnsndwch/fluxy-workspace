import { useState, useEffect, useCallback } from 'react';
import { Send, Trash2, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// ── Types ─────────────────────────────────────────────────────────────────────

const REACTION_EMOJIS = ['🔥', '❤️', '😭', '🎵', '✨', '🤯'] as const;

interface ReactionCount {
    emoji: string;
    count: number;
}

interface Comment {
    id: number;
    user_id: number | null;
    user_name: string | null;
    user_login: string | null;
    user_avatar: string | null;
    user_avatar_url: string | null;
    body: string;
    parent_id: number | null;
    created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function Avatar({ url, name, size = 32 }: { url?: string | null; name?: string | null; size?: number }) {
    if (url) {
        return (
            <img
                src={url}
                alt={name ?? 'User'}
                className="rounded-full object-cover shrink-0"
                style={{ width: size, height: size }}
            />
        );
    }
    return (
        <div
            className="rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 text-purple-300 font-medium"
            style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
            {(name ?? '?')[0]?.toUpperCase()}
        </div>
    );
}

// ── Reaction Bar ──────────────────────────────────────────────────────────────

export function ReactionBar({
    trackId,
    dark = false,
}: {
    trackId: number;
    dark?: boolean;
}) {
    const [counts, setCounts] = useState<ReactionCount[]>([]);
    const [userReaction, setUserReaction] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(() => {
        let ignore = false;
        fetch(`/app/api/musicologia/tracks/${trackId}/reactions`)
            .then(r => r.json())
            .then((d: Record<string, { count: number; reacted: boolean }>) => {
                if (!ignore) {
                    const newCounts: ReactionCount[] = [];
                    let myReaction: string | null = null;
                    for (const [emoji, info] of Object.entries(d)) {
                        if (info.count > 0) newCounts.push({ emoji, count: info.count });
                        if (info.reacted) myReaction = emoji;
                    }
                    setCounts(newCounts);
                    setUserReaction(myReaction);
                    setLoading(false);
                }
            })
            .catch(() => { if (!ignore) setLoading(false); });
        return () => { ignore = true; };
    }, [trackId]);

    useEffect(() => { return load(); }, [load]);

    const handleReact = async (emoji: string) => {
        const res = await fetch(`/app/api/musicologia/tracks/${trackId}/reactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji }),
        });
        if (res.ok) {
            const d = await res.json() as { toggled: 'on' | 'off'; emoji: string };
            const newReaction = d.toggled === 'on' ? d.emoji : null;
            setUserReaction(newReaction);
            // Optimistically update counts
            setCounts(prev => {
                const map = new Map(prev.map(c => [c.emoji, c.count]));
                // Remove old reaction
                if (userReaction && userReaction !== emoji) {
                    const old = map.get(userReaction) ?? 0;
                    if (old <= 1) map.delete(userReaction);
                    else map.set(userReaction, old - 1);
                }
                // Toggle new reaction
                if (newReaction) {
                    map.set(emoji, (map.get(emoji) ?? 0) + 1);
                } else {
                    const cur = map.get(emoji) ?? 0;
                    if (cur <= 1) map.delete(emoji);
                    else map.set(emoji, cur - 1);
                }
                return Array.from(map.entries()).map(([e, c]) => ({ emoji: e, count: c }));
            });
        }
    };

    const countMap = new Map(counts.map(c => [c.emoji, c.count]));

    const textClass = dark ? 'text-white/70' : 'text-foreground';
    const borderBase = dark ? 'border-white/10' : 'border-border';
    const bgBase = dark ? 'rgba(255,255,255,0.04)' : undefined;
    const bgActive = dark ? 'rgba(168,85,247,0.2)' : undefined;
    const borderActive = dark ? 'border-purple-400/50' : 'border-purple-500';

    if (loading) {
        return <div className="flex gap-2 animate-pulse">{REACTION_EMOJIS.map(e => <div key={e} className="w-14 h-10 rounded-xl bg-muted/30" />)}</div>;
    }

    return (
        <div className="flex flex-wrap gap-2">
            {REACTION_EMOJIS.map(emoji => {
                const count = countMap.get(emoji) ?? 0;
                const active = userReaction === emoji;
                return (
                    <button
                        key={emoji}
                        onClick={() => handleReact(emoji)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${active ? borderActive : borderBase}`}
                        style={{
                            background: active ? bgActive : bgBase,
                        }}
                    >
                        <span className="text-lg leading-none">{emoji}</span>
                        {count > 0 && (
                            <span className={`text-xs font-mono ${active ? (dark ? 'text-purple-300' : 'text-purple-600') : textClass}`}>
                                {count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

// ── Comment Thread ────────────────────────────────────────────────────────────

function CommentItem({
    comment,
    replies,
    allComments,
    currentUserId,
    dark,
    depth,
    onReply,
    onDelete,
}: {
    comment: Comment;
    replies: Comment[];
    allComments: Comment[];
    currentUserId: number | null;
    dark: boolean;
    depth: number;
    onReply: (parentId: number, parentName: string) => void;
    onDelete: (id: number) => void;
}) {
    const [showReplies, setShowReplies] = useState(true);
    const name = comment.user_name ?? comment.user_login ?? 'Anonymous';
    const avatar = comment.user_avatar ?? comment.user_avatar_url;

    const bgColor = dark ? 'rgba(255,255,255,0.03)' : undefined;
    const borderColor = dark ? 'rgba(255,255,255,0.06)' : undefined;
    const textMain = dark ? 'text-white/90' : 'text-foreground';
    const textMuted = dark ? 'text-white/40' : 'text-muted-foreground';
    const replyBtnClass = dark ? 'text-white/30 hover:text-white/60' : 'text-muted-foreground hover:text-foreground';

    return (
        <div className={depth > 0 ? 'ml-8 border-l pl-4' : ''} style={depth > 0 ? { borderColor: dark ? 'rgba(255,255,255,0.08)' : undefined } : {}}>
            <div className="flex gap-3 group">
                <Avatar url={avatar} name={name} size={28} />
                <div className="flex-1 min-w-0">
                    <div
                        className="rounded-xl px-3 py-2.5 border"
                        style={{ background: bgColor, borderColor }}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-semibold ${textMain}`}>{name}</span>
                            <span className={`text-[10px] ${textMuted}`}>{timeAgo(comment.created_at)}</span>
                        </div>
                        <p className={`text-sm leading-relaxed ${textMain} opacity-80`}>{comment.body}</p>
                    </div>
                    <div className="flex items-center gap-3 mt-1 px-1">
                        {depth === 0 && (
                            <button
                                onClick={() => onReply(comment.id, name)}
                                className={`text-xs ${replyBtnClass} transition-colors cursor-pointer`}
                            >
                                Reply
                            </button>
                        )}
                        {replies.length > 0 && (
                            <button
                                onClick={() => setShowReplies(v => !v)}
                                className={`flex items-center gap-1 text-xs ${replyBtnClass} transition-colors cursor-pointer`}
                            >
                                {showReplies
                                    ? <><ChevronDown className="h-3 w-3" />{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</>
                                    : <><ChevronRight className="h-3 w-3" />Show {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</>
                                }
                            </button>
                        )}
                        {currentUserId === comment.user_id && (
                            <button
                                onClick={() => onDelete(comment.id)}
                                className={`text-xs ${replyBtnClass} transition-colors opacity-0 group-hover:opacity-100 cursor-pointer`}
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {showReplies && replies.length > 0 && (
                <div className="mt-3 space-y-3">
                    {replies.map(reply => {
                        const subReplies = allComments.filter(c => c.parent_id === reply.id);
                        return (
                            <CommentItem
                                key={reply.id}
                                comment={reply}
                                replies={subReplies}
                                allComments={allComments}
                                currentUserId={currentUserId}
                                dark={dark}
                                depth={depth + 1}
                                onReply={onReply}
                                onDelete={onDelete}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function CommentThread({
    targetType,
    targetId,
    currentUserId,
    currentUserName,
    currentUserAvatar,
    dark = false,
}: {
    targetType: string;
    targetId: number;
    currentUserId: number | null;
    currentUserName: string | null;
    currentUserAvatar: string | null;
    dark?: boolean;
}) {
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(true);
    const [body, setBody] = useState('');
    const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(() => {
        let ignore = false;
        fetch(`/app/api/musicologia/comments?target_type=${targetType}&target_id=${targetId}`)
            .then(r => r.json())
            .then((d: Comment[] | { comments: Comment[] }) => {
                if (!ignore) {
                    const list = Array.isArray(d) ? d : (d.comments ?? []);
                    setComments(list);
                    setLoading(false);
                }
            })
            .catch(() => { if (!ignore) setLoading(false); });
        return () => { ignore = true; };
    }, [targetType, targetId]);

    useEffect(() => { return load(); }, [load]);

    const handleSubmit = async () => {
        if (!body.trim()) return;
        setSubmitting(true);
        try {
            const res = await fetch('/app/api/musicologia/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_type: targetType,
                    target_id: targetId,
                    body: body.trim(),
                    parent_id: replyTo?.id ?? null,
                }),
            });
            if (res.ok) {
                const newComment = await res.json() as Comment;
                setComments(prev => [...prev, newComment]);
                setBody('');
                setReplyTo(null);
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: number) => {
        const res = await fetch(`/app/api/musicologia/comments/${id}`, { method: 'DELETE' });
        if (res.ok) setComments(prev => prev.filter(c => c.id !== id));
    };

    const topLevel = comments.filter(c => !c.parent_id);
    const textMuted = dark ? 'text-white/40' : 'text-muted-foreground';
    const borderColor = dark ? 'rgba(255,255,255,0.08)' : undefined;
    const inputBg = dark ? 'rgba(255,255,255,0.05)' : undefined;
    const textMain = dark ? 'text-white/90' : 'text-foreground';

    return (
        <div className="space-y-5">
            {/* Comment count */}
            <div className={`flex items-center gap-2 text-xs ${textMuted}`}>
                <MessageSquare className="h-3.5 w-3.5" />
                {loading ? 'Loading…' : `${comments.length} comment${comments.length !== 1 ? 's' : ''}`}
            </div>

            {/* Thread */}
            {!loading && (
                <div className="space-y-4">
                    {topLevel.length === 0 ? (
                        <p className={`text-sm ${textMuted} text-center py-4`}>No comments yet. Be the first!</p>
                    ) : (
                        topLevel.map(comment => {
                            const replies = comments.filter(c => c.parent_id === comment.id);
                            return (
                                <CommentItem
                                    key={comment.id}
                                    comment={comment}
                                    replies={replies}
                                    allComments={comments}
                                    currentUserId={currentUserId}
                                    dark={dark}
                                    depth={0}
                                    onReply={(id, name) => setReplyTo({ id, name })}
                                    onDelete={handleDelete}
                                />
                            );
                        })
                    )}
                </div>
            )}

            {/* Compose */}
            {currentUserId ? (
                <div className="flex gap-3">
                    <Avatar url={currentUserAvatar} name={currentUserName} size={28} />
                    <div className="flex-1 space-y-2">
                        {replyTo && (
                            <div className={`flex items-center justify-between text-xs ${textMuted} px-2`}>
                                <span>Replying to <span className="font-medium">{replyTo.name}</span></span>
                                <button onClick={() => setReplyTo(null)} className="hover:opacity-80 cursor-pointer">✕</button>
                            </div>
                        )}
                        <Textarea
                            placeholder={replyTo ? `Reply to ${replyTo.name}…` : 'Add a comment…'}
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            rows={2}
                            className={`resize-none text-sm ${dark ? 'bg-transparent border-white/10 text-white/90 placeholder:text-white/30 focus-visible:ring-purple-500/30' : ''}`}
                            style={dark ? { background: inputBg, borderColor } : {}}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
                            }}
                        />
                        <div className="flex justify-end">
                            <Button
                                size="sm"
                                onClick={handleSubmit}
                                disabled={!body.trim() || submitting}
                                className={`h-7 cursor-pointer ${dark ? 'bg-purple-600 hover:bg-purple-500 text-white border-0' : ''}`}
                            >
                                <Send className="h-3.5 w-3.5 mr-1.5" />
                                {submitting ? 'Posting…' : 'Post'}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                <p className={`text-xs ${textMuted} text-center`}>Sign in to comment</p>
            )}

            {/* Invisible type annotation */}
            <span style={{ display: 'none' }}>{textMain}</span>
        </div>
    );
}
