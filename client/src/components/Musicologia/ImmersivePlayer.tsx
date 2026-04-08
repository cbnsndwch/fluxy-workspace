// oxlint-disable no-console
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useAuthStore } from '@/store/auth';
import { CommentThread } from './CommentThread';

gsap.registerPlugin(ScrollTrigger);

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrackDNA {
    energy: number | null;
    valence: number | null;
    danceability: number | null;
    acousticness: number | null;
    instrumentalness: number | null;
    liveness: number | null;
    tempo: number | null;
    key: number | null;
    mode: number | null;
    palette: string | null; // JSON string
}

interface TrackLore {
    tagline: string | null;
    story: string | null;
    trivia: string; // JSON string
    themes: string; // JSON string
    credits: string; // JSON string
}

interface Track {
    id: number;
    title: string;
    artist: string;
    artist_slug: string | null;
    track_slug: string | null;
    cover_url: string | null;
    duration_ms: number | null;
}

interface LyricLine {
    id: number;
    time_seconds: number;
    text: string;
    line_index: number;
}

interface TrackDetail {
    track: Track;
    dna: TrackDNA | null;
    lore: TrackLore | null;
    lrcLyrics: LyricLine[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const KEY_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

const DNA_FEATURES: Array<{ key: keyof TrackDNA; label: string; color: string }> = [
    { key: 'energy', label: 'Energy', color: '#f97316' },
    { key: 'valence', label: 'Valence', color: '#ec4899' },
    { key: 'danceability', label: 'Danceability', color: '#a855f7' },
    { key: 'acousticness', label: 'Acousticness', color: '#22c55e' },
    { key: 'instrumentalness', label: 'Instrumentalness', color: '#3b82f6' },
    { key: 'liveness', label: 'Liveness', color: '#eab308' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function parsePalette(raw: string | null): string[] {
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ── DNA Bar ───────────────────────────────────────────────────────────────────

function DnaBar({ label, value, color, barRef }: {
    label: string;
    value: number | null;
    color: string;
    barRef: (el: HTMLDivElement | null) => void;
}) {
    const pct = value != null ? Math.round(value * 100) : 0;
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
                <span className="text-xs text-white/50 uppercase tracking-widest">{label}</span>
                <span className="text-xs font-mono text-white/70">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                    ref={barRef}
                    className="h-full rounded-full"
                    style={{ width: 0, backgroundColor: color }}
                />
            </div>
        </div>
    );
}

// ── BPM Pulse ─────────────────────────────────────────────────────────────────

function BpmPulse({ tempo }: { tempo: number | null }) {
    const bpm = tempo ?? 120;
    const beatMs = Math.round(60000 / bpm);
    return (
        <div className="relative flex items-center justify-center w-24 h-24 mx-auto">
            {/* Outer ring */}
            <div
                className="absolute inset-0 rounded-full border-2 border-white/20"
                style={{
                    animation: `bpm-pulse ${beatMs}ms ease-in-out infinite`,
                }}
            />
            {/* Inner circle */}
            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-white">{Math.round(bpm)}</span>
                <span className="text-[9px] text-white/40 uppercase tracking-widest">BPM</span>
            </div>
            <style>{`
                @keyframes bpm-pulse {
                    0%, 100% { transform: scale(1); opacity: 0.3; }
                    50% { transform: scale(1.3); opacity: 0.7; }
                }
            `}</style>
        </div>
    );
}

// ── Trivia Card ───────────────────────────────────────────────────────────────

function TriviaCard({ text, index }: { text: string; index: number }) {
    const [flipped, setFlipped] = useState(false);
    const colors = ['from-purple-900/60', 'from-blue-900/60', 'from-rose-900/60', 'from-amber-900/60', 'from-emerald-900/60'];
    const c = colors[index % colors.length];
    return (
        <div
            className="cursor-pointer"
            style={{ perspective: '600px' }}
            onClick={() => setFlipped(f => !f)}
        >
            <div
                style={{
                    transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1)',
                    transformStyle: 'preserve-3d',
                    transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                    position: 'relative',
                    minHeight: '100px',
                }}
            >
                {/* Front */}
                <div
                    className={`absolute inset-0 rounded-xl p-4 bg-gradient-to-br ${c} to-black/40 border border-white/10 flex items-center justify-center`}
                    style={{ backfaceVisibility: 'hidden' }}
                >
                    <span className="text-2xl">✦</span>
                </div>
                {/* Back */}
                <div
                    className="rounded-xl p-4 bg-white/5 border border-white/10 flex items-center min-h-[100px]"
                    style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                >
                    <p className="text-xs text-white/80 leading-relaxed">{text}</p>
                </div>
            </div>
        </div>
    );
}

// ── Lyrics Player ─────────────────────────────────────────────────────────────

function LyricsPlayer({
    lines,
    trackId,
    durationMs,
    onLyricsUpdate,
}: {
    lines: LyricLine[];
    trackId: number;
    durationMs: number | null;
    onLyricsUpdate: (lines: LyricLine[]) => void;
}) {
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [showLrcAdmin, setShowLrcAdmin] = useState(false);
    const [lrcText, setLrcText] = useState('');
    const [lrcPreview, setLrcPreview] = useState<LyricLine[]>([]);
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState('');
    const durationSec = durationMs ? Math.floor(durationMs / 1000) : 200;
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const activeLineRef = useRef<HTMLDivElement | null>(null);
    const lyricsContainerRef = useRef<HTMLDivElement | null>(null);

    // Find active line
    const activeIdx = lines.reduce((best, line, i) => {
        if (line.time_seconds <= currentTime) return i;
        return best;
    }, -1);

    // Scroll active line into view
    useEffect(() => {
        if (activeLineRef.current && lyricsContainerRef.current) {
            activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeIdx]);

    // Playback timer
    useEffect(() => {
        if (playing) {
            intervalRef.current = setInterval(() => {
                setCurrentTime(t => {
                    if (t >= durationSec) { setPlaying(false); return durationSec; }
                    return t + 1;
                });
            }, 1000);
        } else {
            if (intervalRef.current) clearInterval(intervalRef.current);
        }
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [playing, durationSec]);

    const parseLrc = useCallback((text: string): LyricLine[] => {
        const pattern = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/;
        const result: LyricLine[] = [];
        let idx = 0;
        for (const raw of text.split('\n')) {
            const m = raw.trim().match(pattern);
            if (!m || !m[3].trim()) continue;
            result.push({
                id: idx,
                time_seconds: parseInt(m[1], 10) * 60 + parseFloat(m[2]),
                text: m[3].trim(),
                line_index: idx++,
            });
        }
        return result;
    }, []);

    const handlePreview = () => {
        setLrcPreview(parseLrc(lrcText));
    };

    const handleSaveLrc = async () => {
        setSaving(true);
        setSaveMsg('');
        try {
            const res = await fetch(`/app/api/musicologia/tracks/${trackId}/lyrics`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lrc: lrcText }),
            });
            const data = await res.json() as { count?: number; error?: string };
            if (res.ok) {
                setSaveMsg(`Saved ${data.count} lines`);
                onLyricsUpdate(parseLrc(lrcText));
                setShowLrcAdmin(false);
            } else {
                setSaveMsg(data.error ?? 'Save failed');
            }
        } catch {
            setSaveMsg('Network error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Controls */}
            <div className="flex items-center gap-4">
                <button
                    onClick={() => setPlaying(p => !p)}
                    className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-colors text-xl cursor-pointer"
                >
                    {playing ? '⏸' : '▶'}
                </button>
                <div className="flex-1 flex flex-col gap-1.5">
                    <input
                        type="range"
                        min={0}
                        max={durationSec}
                        value={currentTime}
                        onChange={e => setCurrentTime(Number(e.target.value))}
                        className="w-full accent-purple-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-white/40 font-mono">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(durationSec)}</span>
                    </div>
                </div>
            </div>

            {/* Lyric lines */}
            {lines.length > 0 ? (
                <div
                    ref={lyricsContainerRef}
                    className="max-h-80 overflow-y-auto pr-2 flex flex-col gap-2"
                    style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
                >
                    {lines.map((line, i) => {
                        const isActive = i === activeIdx;
                        const isPast = i < activeIdx;
                        return (
                            <div
                                key={line.id}
                                ref={isActive ? activeLineRef : null}
                                className="transition-all duration-300 cursor-pointer"
                                style={{
                                    opacity: isActive ? 1 : isPast ? 0.35 : 0.6,
                                    fontSize: isActive ? '1.125rem' : '0.875rem',
                                    fontWeight: isActive ? '700' : '400',
                                    color: isActive ? '#ffffff' : 'rgba(255,255,255,0.7)',
                                    lineHeight: 1.5,
                                }}
                                onClick={() => setCurrentTime(line.time_seconds)}
                            >
                                {line.text}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="text-center py-8 text-white/30 text-sm">
                    No lyrics yet. Upload LRC below.
                </div>
            )}

            {/* LRC Admin */}
            <div className="border-t border-white/10 pt-4">
                <button
                    className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1.5 cursor-pointer transition-colors"
                    onClick={() => setShowLrcAdmin(v => !v)}
                >
                    <span>{showLrcAdmin ? '▾' : '▸'}</span>
                    <span>Admin: Upload LRC lyrics</span>
                </button>
                {showLrcAdmin && (
                    <div className="mt-4 flex flex-col gap-3">
                        <textarea
                            value={lrcText}
                            onChange={e => setLrcText(e.target.value)}
                            placeholder={'[00:12.34] First lyric line\n[00:18.00] Second line\n...'}
                            rows={8}
                            className="w-full rounded-lg bg-white/5 border border-white/10 text-xs text-white/80 p-3 font-mono resize-y focus:outline-none focus:border-purple-500/50"
                        />
                        {lrcPreview.length > 0 && (
                            <div className="rounded-lg bg-white/5 border border-white/10 p-3 max-h-40 overflow-y-auto">
                                <p className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Preview ({lrcPreview.length} lines)</p>
                                {lrcPreview.slice(0, 10).map((l, i) => (
                                    <p key={i} className="text-xs text-white/60 font-mono">[{formatTime(l.time_seconds)}] {l.text}</p>
                                ))}
                                {lrcPreview.length > 10 && <p className="text-xs text-white/30 mt-1">+{lrcPreview.length - 10} more…</p>}
                            </div>
                        )}
                        <div className="flex gap-2">
                            <button
                                onClick={handlePreview}
                                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white/70 cursor-pointer transition-colors"
                            >
                                Parse Preview
                            </button>
                            <button
                                onClick={handleSaveLrc}
                                disabled={saving || !lrcText.trim()}
                                className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-xs text-white cursor-pointer transition-colors"
                            >
                                {saving ? 'Saving…' : 'Save Lyrics'}
                            </button>
                        </div>
                        {saveMsg && <p className="text-xs text-white/50">{saveMsg}</p>}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────

// ── Reaction types ────────────────────────────────────────────────────────────

interface ReactionEntry { count: number; reacted: boolean; }
type Reactions = Record<string, ReactionEntry>;
const REACTION_EMOJIS = ['🔥', '❤️', '😭', '🎵', '✨', '🤯'];

interface Comment {
    id: number;
    user_id: number | null;
    user_name: string;
    user_avatar: string | null;
    body: string;
    parent_id: number | null;
    created_at: string;
    replies: Comment[];
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ImmersivePlayer() {
    const { artistSlug, trackSlug } = useParams<{ artistSlug: string; trackSlug: string }>();
    const navigate = useNavigate();
    const { user } = useAuthStore();

    const [detail, setDetail] = useState<TrackDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [lyrics, setLyrics] = useState<LyricLine[]>([]);

    // Community state
    const [reactions, setReactions] = useState<Reactions>({});
    const [comments, setComments] = useState<Comment[]>([]);

    // Refs for GSAP
    const containerRef = useRef<HTMLDivElement>(null);
    const heroRef = useRef<HTMLElement>(null);
    const glowRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const subtitleRef = useRef<HTMLDivElement>(null);
    const taglineRef = useRef<HTMLDivElement>(null);
    const scrollHintRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const dnaBarRefs = useRef<(HTMLDivElement | null)[]>([]);
    const storyRef = useRef<HTMLDivElement>(null);
    const loreContainerRef = useRef<HTMLDivElement>(null);

    // Fetch track data
    useEffect(() => {
        if (!artistSlug || !trackSlug) return;
        let ignore = false;
        setLoading(true);
        fetch(`/app/api/musicologia/tracks/${artistSlug}/${trackSlug}`)
            .then(r => {
                if (r.status === 404) {
                    if (!ignore) { setNotFound(true); setLoading(false); }
                    return null;
                }
                return r.json() as Promise<TrackDetail & { lrcLyrics: LyricLine[] }>;
            })
            .then(data => {
                if (!ignore && data) {
                    setDetail(data);
                    setLyrics(data.lrcLyrics ?? []);
                    setLoading(false);
                }
            })
            .catch(() => { if (!ignore) setLoading(false); });
        return () => { ignore = true; };
    }, [artistSlug, trackSlug]);

    // Fetch reactions & comments when track detail is available
    useEffect(() => {
        if (!detail?.track.id) return;
        const trackId = detail.track.id;
        let ignore = false;

        fetch(`/app/api/musicologia/tracks/${trackId}/reactions`)
            .then(r => r.ok ? r.json() as Promise<Reactions> : null)
            .then(data => { if (!ignore && data) setReactions(data); })
            .catch(() => {});

        fetch(`/app/api/musicologia/comments?target_type=track&target_id=${trackId}`)
            .then(r => r.ok ? r.json() as Promise<Comment[]> : null)
            .then(data => { if (!ignore && data) setComments(data); })
            .catch(() => {});

        return () => { ignore = true; };
    }, [detail?.track.id]);

    const handleReaction = useCallback(async (emoji: string) => {
        if (!detail?.track.id || !user) return;
        const trackId = detail.track.id;

        // Optimistic update
        setReactions(prev => {
            const entry = prev[emoji] ?? { count: 0, reacted: false };
            const toggling_off = entry.reacted;
            const updated: Reactions = {};
            for (const e of REACTION_EMOJIS) {
                const cur = prev[e] ?? { count: 0, reacted: false };
                if (e === emoji) {
                    updated[e] = { count: cur.count + (toggling_off ? -1 : 1), reacted: !cur.reacted };
                } else if (cur.reacted) {
                    // Remove previously selected reaction (only one allowed at a time)
                    updated[e] = { count: Math.max(0, cur.count - 1), reacted: false };
                } else {
                    updated[e] = cur;
                }
            }
            return updated;
        });

        try {
            const res = await fetch(`/app/api/musicologia/tracks/${trackId}/reactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emoji }),
            });
            if (res.ok) {
                // Refresh from server
                const fresh = await fetch(`/app/api/musicologia/tracks/${trackId}/reactions`);
                if (fresh.ok) setReactions(await fresh.json() as Reactions);
            }
        } catch { /* optimistic state stays */ }
    }, [detail?.track.id, user]);

    // GSAP entrance animations
    useEffect(() => {
        if (!detail || !heroRef.current) return;
        const ctx = gsap.context(() => {
            const words = titleRef.current?.querySelectorAll('.hero-word') ?? [];

            // ── Phase 1: Entrance ───────────────────────────────────────
            const entranceTl = gsap.timeline({ delay: 0.2 });

            if (glowRef.current) {
                gsap.set(glowRef.current, { scale: 0.6, opacity: 0 });
                entranceTl.to(glowRef.current, { scale: 1, opacity: 1, duration: 1.2, ease: 'power2.out' }, 0);
            }

            if (words.length > 0) {
                gsap.set(words, { y: 80, opacity: 0, scale: 0.8, rotateX: 15 });
                entranceTl.to(words, {
                    y: 0, opacity: 1, scale: 1, rotateX: 0,
                    stagger: 0.12, duration: 0.8, ease: 'power3.out'
                }, 0.3);
            }

            if (subtitleRef.current) {
                gsap.set(subtitleRef.current, { y: 30, opacity: 0 });
                entranceTl.to(subtitleRef.current, { y: 0, opacity: 1, duration: 0.6, ease: 'power2.out' }, 0.8);
            }

            if (taglineRef.current) {
                const rule = taglineRef.current.querySelector('.hero-rule');
                const text = taglineRef.current.querySelector('.hero-tagline-text');
                if (rule) {
                    gsap.set(rule, { scaleX: 0 });
                    entranceTl.to(rule, { scaleX: 1, duration: 0.8, ease: 'power2.inOut' }, 1.0);
                }
                if (text) {
                    gsap.set(text, { y: 10, opacity: 0 });
                    entranceTl.to(text, { y: 0, opacity: 0.6, duration: 0.5, ease: 'power2.out' }, 1.3);
                }
            }

            if (scrollHintRef.current) {
                gsap.set(scrollHintRef.current, { opacity: 0 });
                entranceTl.to(scrollHintRef.current, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 1.5);
            }

            // ── Phase 2: Scroll-driven exit (desktop only) ──────────────
            const isDesktop = window.matchMedia('(min-width: 1280px)').matches;
            const exitTl = gsap.timeline({
                scrollTrigger: {
                    trigger: heroRef.current,
                    start: 'top top',
                    end: '+=120%',
                    pin: isDesktop,
                    scrub: 1,
                }
            });

            if (titleRef.current) exitTl.to(titleRef.current, { y: -60, opacity: 0.3, duration: 1 }, 0);
            if (subtitleRef.current) exitTl.to(subtitleRef.current, { y: -40, opacity: 0, duration: 1 }, 0.15);
            if (taglineRef.current) exitTl.to(taglineRef.current, { y: -20, opacity: 0, duration: 0.6 }, 0.4);
            if (scrollHintRef.current) exitTl.to(scrollHintRef.current, { opacity: 0, duration: 0.3 }, 0);
            if (glowRef.current) exitTl.to(glowRef.current, { scale: 1.3, opacity: 0.3, duration: 1 }, 0);
            if (overlayRef.current) exitTl.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 0.7, duration: 0.4 }, 0.6);

            // DNA bars scroll trigger
            dnaBarRefs.current.forEach((bar, i) => {
                if (!bar) return;
                const dna = detail.dna;
                const featureKeys: Array<keyof TrackDNA> = ['energy', 'valence', 'danceability', 'acousticness', 'instrumentalness', 'liveness'];
                const val = dna ? (dna[featureKeys[i]] as number | null) : null;
                const targetWidth = val != null ? `${Math.round(val * 100)}%` : '0%';
                gsap.fromTo(bar,
                    { width: 0 },
                    {
                        width: targetWidth,
                        duration: 1.2,
                        ease: 'power2.out',
                        delay: i * 0.08,
                        scrollTrigger: {
                            trigger: bar,
                            start: 'top 85%',
                            toggleActions: 'play none none reset',
                        },
                    }
                );
            });

            // Story reveal
            if (storyRef.current) {
                gsap.fromTo(storyRef.current,
                    { opacity: 0, y: 30 },
                    {
                        opacity: 1,
                        y: 0,
                        duration: 1,
                        ease: 'power2.out',
                        scrollTrigger: {
                            trigger: storyRef.current,
                            start: 'top 80%',
                            toggleActions: 'play none none reset',
                        },
                    }
                );
            }
        }, containerRef);

        return () => ctx.revert();
    }, [detail]);


    if (loading) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-black z-50">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
                    <p className="text-white/50 text-sm animate-pulse">Loading experience…</p>
                </div>
            </div>
        );
    }

    if (notFound || !detail) {
        return (
            <div className="fixed inset-0 flex flex-col items-center justify-center bg-black z-50 gap-4">
                <p className="text-white/50 text-lg">Track not found</p>
                <button
                    onClick={() => navigate('/musicologia')}
                    className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-sm cursor-pointer transition-colors"
                >
                    ← Back to Musicologia
                </button>
            </div>
        );
    }

    const { track, dna, lore } = detail;
    const palette = parsePalette(dna?.palette ?? null);
    const trivia = parseJSON<string[]>(lore?.trivia, []);
    const themes = parseJSON<string[]>(lore?.themes, []);
    const credits = parseJSON<Array<{ role: string; name: string }>>(lore?.credits, []);

    const keyLabel = dna?.key != null
        ? `${KEY_NAMES[dna.key]}${dna.mode === 0 ? 'm' : ''} ${dna.mode === 0 ? 'Minor' : 'Major'}`
        : null;

    return (
        <div
            ref={containerRef}
            className="min-h-screen relative overflow-x-hidden"
            style={{ backgroundColor: '#050508', color: '#fff' }}
        >
            <style>{`
                @keyframes gn-glow-breathe {
                    0%, 100% { filter: blur(20px) brightness(1); }
                    50% { filter: blur(30px) brightness(1.3); }
                }
            `}</style>

            {/* Back button */}
            <button
                onClick={() => navigate('/musicologia')}
                className="absolute top-5 left-5 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white text-sm transition-all cursor-pointer"
            >
                ← <span className="hidden sm:inline text-white/60">{track.artist}</span>
            </button>

            {/* ── HERO ─────────────────────────────────────────────────────────── */}
            <section
                ref={heroRef}
                className="relative h-screen flex flex-col items-center justify-center overflow-hidden"
            >
                {/* Radial glow layers */}
                <div
                    ref={glowRef}
                    className="absolute inset-0 pointer-events-none"
                    style={{ animation: 'gn-glow-breathe 8s ease-in-out infinite' }}
                >
                    <div
                        className="absolute inset-0"
                        style={{
                            background: palette.length >= 2
                                ? `
                                    radial-gradient(ellipse 70% 50% at 50% 45%, ${palette[0]}55 0%, transparent 70%),
                                    radial-gradient(ellipse 50% 70% at 30% 60%, ${palette[1]}33 0%, transparent 60%),
                                    radial-gradient(ellipse 40% 40% at 75% 35%, ${palette[2] ?? palette[0]}22 0%, transparent 50%)
                                `
                                : `radial-gradient(ellipse 70% 50% at 50% 45%, #1a0a2e55 0%, transparent 70%)`,
                        }}
                    />
                </div>

                {/* Main content */}
                <div className="relative z-10 flex flex-col items-center px-6 max-w-5xl w-full">
                    {/* Title — dramatic word-by-word */}
                    <h1
                        ref={titleRef}
                        className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-center leading-[0.9] tracking-tighter"
                        style={{ perspective: '1000px' }}
                    >
                        {track.title.split(/\s+/).map((word, i) => (
                            <span
                                key={i}
                                className="hero-word inline-block mx-[0.08em]"
                                style={{
                                    textShadow: palette.length >= 2
                                        ? `0 0 40px ${palette[1] ?? palette[0]}66, 0 0 80px ${palette[0]}33, 0 4px 20px rgba(0,0,0,0.5)`
                                        : `0 0 40px #a855f766, 0 4px 20px rgba(0,0,0,0.5)`,
                                }}
                            >
                                {word}
                            </span>
                        ))}
                    </h1>

                    {/* Artist */}
                    <div
                        ref={subtitleRef}
                        className="mt-6 flex flex-col items-center gap-2"
                    >
                        <p
                            className="text-xl md:text-2xl text-center font-semibold tracking-wide"
                            style={{ color: palette[1] ?? palette[0] ?? 'rgba(255,255,255,0.7)' }}
                        >
                            {track.artist}
                        </p>
                    </div>

                    {/* Decorative rule + tagline */}
                    {lore?.tagline && (
                        <div
                            ref={taglineRef}
                            className="mt-8 flex flex-col items-center gap-4 w-full max-w-lg"
                        >
                            <div
                                className="hero-rule w-full h-px origin-center"
                                style={{
                                    background: `linear-gradient(90deg, transparent, ${palette[1] ?? palette[0] ?? 'rgba(255,255,255,0.3)'}66, transparent)`
                                }}
                            />
                            <p className="hero-tagline-text text-sm md:text-base tracking-widest uppercase text-center"
                                style={{ color: palette[1] ?? palette[0] ?? 'white' }}
                            >
                                {lore.tagline}
                            </p>
                        </div>
                    )}
                </div>

                {/* Scroll CTA */}
                <div
                    ref={scrollHintRef}
                    className="absolute bottom-8 flex flex-col items-center gap-2 animate-bounce"
                >
                    <span className="text-white/20 text-xs uppercase tracking-widest">Scroll</span>
                    <svg className="w-5 h-5 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7" />
                    </svg>
                </div>

                {/* Exit darkening overlay */}
                <div
                    ref={overlayRef}
                    className="absolute inset-0 bg-black pointer-events-none z-20"
                    style={{ opacity: 0 }}
                />
            </section>

            {/* ── AUDIO DNA ────────────────────────────────────────────────────── */}
            {dna && (
                <section className="relative z-10 py-16 px-6">
                    <div className="max-w-4xl mx-auto">
                        <SectionTitle>Audio DNA</SectionTitle>
                        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-10">

                            {/* Feature bars */}
                            <div className="flex flex-col gap-4">
                                {DNA_FEATURES.map((f, i) => (
                                    <DnaBar
                                        key={f.key}
                                        label={f.label}
                                        value={dna[f.key] as number | null}
                                        color={f.color}
                                        barRef={el => { dnaBarRefs.current[i] = el; }}
                                    />
                                ))}
                            </div>

                            {/* BPM + Key + Palette */}
                            <div className="flex flex-col items-center gap-6">
                                <BpmPulse tempo={dna.tempo} />

                                {keyLabel && (
                                    <div className="px-5 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-white/70">
                                        {keyLabel}
                                    </div>
                                )}

                                {palette.length > 0 && (
                                    <div className="flex gap-3">
                                        {palette.map((color, i) => (
                                            <div
                                                key={i}
                                                className="w-8 h-8 rounded-full border-2 border-white/10 shadow-lg"
                                                style={{ backgroundColor: color, boxShadow: `0 4px 16px ${color}44` }}
                                                title={color}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* ── LORE ─────────────────────────────────────────────────────────── */}
            {lore && (lore.story || trivia.length > 0 || themes.length > 0) && (
                <section ref={loreContainerRef} className="relative z-10 py-16 px-6">
                    <div className="max-w-4xl mx-auto">
                        <SectionTitle>The Story</SectionTitle>

                        {/* Story */}
                        {lore.story && (
                            <div ref={storyRef} className="mt-8 max-w-2xl">
                                {lore.story.split(/\n+/).filter(p => p.trim()).map((p, i) => (
                                    <p key={i} className="text-white/60 leading-relaxed text-base mb-4 last:mb-0">
                                        {p}
                                    </p>
                                ))}
                            </div>
                        )}

                        {/* Themes */}
                        {themes.length > 0 && (
                            <div className="mt-8 flex flex-wrap gap-2">
                                {themes.map((t, i) => (
                                    <span
                                        key={i}
                                        className="px-4 py-1.5 rounded-full text-xs font-medium border transition-transform hover:scale-105 cursor-default"
                                        style={{
                                            borderColor: (palette[i % palette.length] ?? '#a855f7') + '44',
                                            color: palette[i % palette.length] ?? '#a855f7',
                                            backgroundColor: (palette[i % palette.length] ?? '#a855f7') + '11',
                                        }}
                                    >
                                        {t}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Trivia flip cards */}
                        {trivia.length > 0 && (
                            <div className="mt-10">
                                <p className="text-xs text-white/30 uppercase tracking-widest mb-4">Click to reveal trivia</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {trivia.map((t, i) => (
                                        <TriviaCard key={i} text={t} index={i} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {/* ── LYRICS ───────────────────────────────────────────────────────── */}
            <section className="relative z-10 py-16 px-6">
                <div className="max-w-4xl mx-auto">
                    <SectionTitle>Lyrics</SectionTitle>
                    <div className="mt-8 rounded-2xl bg-white/3 border border-white/8 p-6" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
                        <LyricsPlayer
                            lines={lyrics}
                            trackId={track.id}
                            durationMs={track.duration_ms}
                            onLyricsUpdate={setLyrics}
                        />
                    </div>
                </div>
            </section>

            {/* ── CREDITS ──────────────────────────────────────────────────────── */}
            <section className="relative z-10 py-16 px-6">
                <div className="max-w-4xl mx-auto">
                    <SectionTitle>Credits</SectionTitle>
                    <div className="mt-8">
                        {credits.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {credits.map((c, i) => (
                                    <div
                                        key={i}
                                        className="rounded-xl p-4 border"
                                        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}
                                    >
                                        <p className="text-xs text-white/30 uppercase tracking-wider mb-1">{c.role}</p>
                                        <p className="text-sm text-white/80 font-medium">{c.name}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-white/30 text-sm">Credits not available</p>
                        )}
                    </div>
                </div>
            </section>

            {/* ── COMMUNITY ─────────────────────────────────────────────────────── */}
            <section className="relative z-10 py-16 px-6 pb-32">
                <div className="max-w-4xl mx-auto">
                    <SectionTitle>Community</SectionTitle>

                    {/* Reactions bar */}
                    <div className="mt-8">
                        <div className="flex flex-wrap gap-3 justify-center">
                            {REACTION_EMOJIS.map(emoji => {
                                const entry = reactions[emoji] ?? { count: 0, reacted: false };
                                return (
                                    <button
                                        key={emoji}
                                        onClick={() => handleReaction(emoji)}
                                        disabled={!user}
                                        className={[
                                            'flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl border transition-all',
                                            entry.reacted
                                                ? 'border-white/30 scale-105'
                                                : 'border-white/10 hover:border-white/20 hover:scale-105',
                                            user ? 'cursor-pointer' : 'cursor-default opacity-60',
                                        ].join(' ')}
                                        style={{
                                            background: entry.reacted ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                                        }}
                                    >
                                        <span className="text-2xl">{emoji}</span>
                                        <span className={`text-xs font-mono tabular-nums ${entry.reacted ? 'text-white/80' : 'text-white/40'}`}>
                                            {entry.count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        {!user && (
                            <p className="text-center text-xs text-white/20 mt-3">Sign in to react</p>
                        )}
                    </div>

                    {/* Comments */}
                    <div
                        className="mt-10 rounded-2xl border p-6"
                        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}
                    >
                        {detail && (
                            <CommentThread
                                targetType="track"
                                targetId={detail.track.id}
                                comments={comments}
                                onCommentsChange={setComments}
                            />
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}

// ── Section Title ─────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h2 className="text-xs font-semibold text-white/30 uppercase tracking-[0.25em] flex items-center gap-3">
            <span className="flex-1 h-px bg-white/8" style={{ maxWidth: '2rem', background: 'rgba(255,255,255,0.08)' }} />
            {children}
            <span className="flex-1 h-px" style={{ maxWidth: '100%', background: 'rgba(255,255,255,0.08)' }} />
        </h2>
    );
}
