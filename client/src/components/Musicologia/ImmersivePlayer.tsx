// oxlint-disable no-console
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

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

export default function ImmersivePlayer() {
    const { artistSlug, trackSlug } = useParams<{ artistSlug: string; trackSlug: string }>();
    const navigate = useNavigate();

    const [detail, setDetail] = useState<TrackDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [lyrics, setLyrics] = useState<LyricLine[]>([]);

    // Refs for GSAP
    const containerRef = useRef<HTMLDivElement>(null);
    const coverRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const subtitleRef = useRef<HTMLParagraphElement>(null);
    const taglineRef = useRef<HTMLParagraphElement>(null);
    const dnaBarRefs = useRef<(HTMLDivElement | null)[]>([]);
    const storyRef = useRef<HTMLDivElement>(null);
    const loreContainerRef = useRef<HTMLDivElement>(null);

    // 3D tilt state
    const [tilt, setTilt] = useState({ rotX: 0, rotY: 0 });

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

    // GSAP entrance animations
    useEffect(() => {
        if (!detail) return;
        const ctx = gsap.context(() => {
            // Cover art scale-in
            if (coverRef.current) {
                gsap.fromTo(coverRef.current,
                    { scale: 0.8, opacity: 0 },
                    { scale: 1, opacity: 1, duration: 1, ease: 'power3.out', delay: 0.1 }
                );
            }
            // Title slides up
            if (titleRef.current) {
                gsap.fromTo(titleRef.current,
                    { y: 20, opacity: 0 },
                    { y: 0, opacity: 1, duration: 0.8, ease: 'power2.out', delay: 0.3 }
                );
            }
            if (subtitleRef.current) {
                gsap.fromTo(subtitleRef.current,
                    { y: 16, opacity: 0 },
                    { y: 0, opacity: 1, duration: 0.7, ease: 'power2.out', delay: 0.5 }
                );
            }
            if (taglineRef.current) {
                gsap.fromTo(taglineRef.current,
                    { y: 12, opacity: 0 },
                    { y: 0, opacity: 1, duration: 0.6, ease: 'power2.out', delay: 0.7 }
                );
            }

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

    // Cover art 3D tilt on mouse move
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (e.clientX - cx) / (rect.width / 2);
        const dy = (e.clientY - cy) / (rect.height / 2);
        setTilt({ rotX: -dy * 12, rotY: dx * 12 });
    }, []);

    const handleMouseLeave = useCallback(() => {
        setTilt({ rotX: 0, rotY: 0 });
    }, []);

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

    // Background gradient from palette
    const bgGradient = palette.length >= 2
        ? `linear-gradient(135deg, ${palette[0]}22 0%, ${palette[1]}18 30%, #050508 60%, #050508 100%)`
        : 'linear-gradient(135deg, #1a0a2e22 0%, #0a0a1e18 30%, #050508 60%)';

    const keyLabel = dna?.key != null
        ? `${KEY_NAMES[dna.key]}${dna.mode === 0 ? 'm' : ''} ${dna.mode === 0 ? 'Minor' : 'Major'}`
        : null;

    return (
        <div
            ref={containerRef}
            className="min-h-screen relative overflow-x-hidden"
            style={{ background: bgGradient, backgroundColor: '#050508', color: '#fff' }}
        >
            {/* Fixed back button */}
            <button
                onClick={() => navigate('/musicologia')}
                className="fixed top-5 left-5 z-50 flex items-center gap-2 px-3 py-2 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-black/60 text-sm transition-all cursor-pointer"
            >
                ← <span className="hidden sm:inline">Back</span>
            </button>

            {/* Ambient particles */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
                {[...Array(12)].map((_, i) => (
                    <div
                        key={i}
                        className="absolute rounded-full"
                        style={{
                            width: `${2 + (i % 4)}px`,
                            height: `${2 + (i % 4)}px`,
                            left: `${(i * 83) % 100}%`,
                            top: `${(i * 67 + 10) % 100}%`,
                            backgroundColor: palette[i % palette.length] ?? '#a855f7',
                            opacity: 0.15 + (i % 3) * 0.08,
                            animation: `float-particle ${6 + (i % 5) * 2}s ease-in-out infinite`,
                            animationDelay: `${i * 0.7}s`,
                        }}
                    />
                ))}
            </div>
            <style>{`
                @keyframes float-particle {
                    0%, 100% { transform: translateY(0px) translateX(0px); }
                    33% { transform: translateY(-20px) translateX(8px); }
                    66% { transform: translateY(-8px) translateX(-12px); }
                }
            `}</style>

            {/* ── HERO ─────────────────────────────────────────────────────────── */}
            <section className="relative z-10 pt-24 pb-20 px-6">
                <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-10">

                    {/* Cover art with 3D tilt */}
                    <div
                        className="shrink-0"
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                        style={{ perspective: '1000px' }}
                    >
                        <div
                            ref={coverRef}
                            className="w-56 h-56 md:w-72 md:h-72 rounded-2xl overflow-hidden shadow-2xl"
                            style={{
                                transform: `rotateX(${tilt.rotX}deg) rotateY(${tilt.rotY}deg)`,
                                transition: 'transform 0.1s ease-out',
                                boxShadow: palette[0]
                                    ? `0 32px 80px ${palette[0]}55, 0 0 120px ${palette[0]}22`
                                    : '0 32px 80px rgba(168, 85, 247, 0.3)',
                            }}
                        >
                            {track.cover_url ? (
                                <img
                                    src={track.cover_url}
                                    alt={track.title}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full bg-gradient-to-br from-purple-900 to-black flex items-center justify-center">
                                    <span className="text-5xl opacity-30">♪</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Track info */}
                    <div className="flex flex-col gap-3 text-center md:text-left">
                        <p className="text-xs text-white/40 uppercase tracking-[0.2em]">Now Playing</p>
                        <h1
                            ref={titleRef}
                            className="text-4xl md:text-5xl lg:text-6xl font-black leading-none tracking-tight"
                            style={{ textShadow: palette[0] ? `0 0 60px ${palette[0]}66` : undefined }}
                        >
                            {track.title}
                        </h1>
                        <p ref={subtitleRef} className="text-xl text-white/60 font-light">
                            {track.artist}
                        </p>
                        {lore?.tagline && (
                            <p ref={taglineRef} className="text-sm italic text-white/40 max-w-md">
                                "{lore.tagline}"
                            </p>
                        )}

                        {/* Meta badges */}
                        <div className="flex flex-wrap gap-2 mt-2 justify-center md:justify-start">
                            {dna?.tempo != null && (
                                <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
                                    {Math.round(dna.tempo)} BPM
                                </span>
                            )}
                            {keyLabel && (
                                <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
                                    {keyLabel}
                                </span>
                            )}
                            {track.duration_ms && (
                                <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
                                    {formatTime(track.duration_ms / 1000)}
                                </span>
                            )}
                        </div>

                        {/* Palette swatches */}
                        {palette.length > 0 && (
                            <div className="flex gap-2 mt-1 justify-center md:justify-start">
                                {palette.map((color, i) => (
                                    <div
                                        key={i}
                                        className="w-5 h-5 rounded-full border border-white/20 shadow-lg"
                                        style={{ backgroundColor: color }}
                                        title={color}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
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

            {/* ── COMMUNITY (Phase 5 placeholder) ──────────────────────────────── */}
            <section className="relative z-10 py-16 px-6 pb-32">
                <div className="max-w-4xl mx-auto">
                    <SectionTitle>Community</SectionTitle>
                    <div
                        className="mt-8 rounded-2xl p-8 border text-center"
                        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)', borderStyle: 'dashed' }}
                    >
                        <p className="text-white/40 text-sm mb-6">Reactions & discussion coming in Phase 5</p>
                        {/* Reactions bar mockup */}
                        <div className="flex justify-center gap-4">
                            {[
                                { emoji: '🔥', count: 0 },
                                { emoji: '❤️', count: 0 },
                                { emoji: '🎵', count: 0 },
                                { emoji: '✨', count: 0 },
                            ].map(({ emoji, count }) => (
                                <button
                                    key={emoji}
                                    disabled
                                    className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl border border-white/10 bg-white/3 opacity-40 cursor-not-allowed"
                                    style={{ background: 'rgba(255,255,255,0.03)' }}
                                >
                                    <span className="text-2xl">{emoji}</span>
                                    <span className="text-xs text-white/50">{count}</span>
                                </button>
                            ))}
                        </div>
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
