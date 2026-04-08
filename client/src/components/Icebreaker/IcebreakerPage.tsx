import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, Shuffle, Check, ExternalLink,
  ChevronDown, ChevronUp, History, Zap, Brain,
  Sparkles, ArrowRight, Flame, MessageSquarePlus,
} from 'lucide-react';
import { AppLayout } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const GRADIENT = 'linear-gradient(to right, #FF8C35 10%, #E8193C 55%, #F4607A 100%)';
const GRAD_STYLE = { backgroundImage: GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' } as React.CSSProperties;
const GRAD_BG = { backgroundImage: GRADIENT } as React.CSSProperties;

// Steven Mode palette — Art Deco fire
const STEVEN_GRADIENT = 'linear-gradient(to right, #8B1A00 0%, #CC3A00 15%, #FF6B00 30%, #C9A84C 50%, #F0C040 65%, #C9A84C 80%, #FF6B00 92%, #8B1A00 100%)';
const STEVEN_GRAD_STYLE = { backgroundImage: STEVEN_GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' } as React.CSSProperties;
const STEVEN_GRAD_BG = { backgroundImage: 'linear-gradient(135deg, #8B1A00 0%, #CC3A00 20%, #FF6B00 40%, #C9A84C 60%, #F0C040 80%, #C9A84C 100%)' } as React.CSSProperties;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Headline {
  id: string;
  title: string;
  url: string;
  source: string;
  score?: number;
  publishedAt?: number;
}

interface HistoryEntry {
  id: number;
  question: string;
  used_at: string;
  session_label: string | null;
  source_headlines: string[];
}

interface TrendingArticle {
  title: string;
  url: string;
  source: string;
  publishedAt?: number;
}

interface TrendingCluster {
  id: string;
  topic: string;
  sourceCount: number;
  sources: string[];
  articles: TrendingArticle[];
}

// ── Source labels ─────────────────────────────────────────────────────────────

const SOURCE_META: Record<string, { label: string; color: string }> = {
  hn:         { label: 'HN',         color: 'bg-orange-500/20 text-orange-300' },
  techcrunch: { label: 'TechCrunch', color: 'bg-green-500/20 text-green-300' },
  verge:      { label: 'The Verge',  color: 'bg-purple-500/20 text-purple-300' },
  ars:        { label: 'Ars',        color: 'bg-blue-500/20 text-blue-300' },
};

function SourceBadge({ source }: { source: string }) {
  const meta = SOURCE_META[source] ?? { label: source, color: 'bg-white/10 text-white/40' };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.color}`}>
      {meta.label}
    </span>
  );
}

// ── Global animation styles ────────────────────────────────────────────────────
// Always rendered so ongoing Steven Mode classes work (steven-glow, etc.)

function IcebreakerStyles() {
  return (
    <style>{`
      @keyframes decoSunburst {
        0%   { transform: scaleX(0); opacity: 0.9; }
        60%  { opacity: 0.6; }
        100% { transform: scaleX(1); opacity: 0; }
      }
      @keyframes decoFlash {
        0%   { opacity: 0; }
        10%  { opacity: 0.55; }
        30%  { opacity: 0.15; }
        100% { opacity: 0; }
      }
      @keyframes decoDiamond {
        0%   { transform: translate(-50%, -50%) scale(0) rotate(45deg); opacity: 1; }
        60%  { opacity: 0.8; }
        100% { transform: translate(-50%, -50%) scale(1) rotate(45deg); opacity: 0; }
      }
      @keyframes stevenShake {
        0%, 100% { transform: translateX(0); }
        15%  { transform: translateX(-6px) rotate(-0.5deg); }
        30%  { transform: translateX(6px) rotate(0.5deg); }
        45%  { transform: translateX(-4px); }
        60%  { transform: translateX(4px); }
        75%  { transform: translateX(-2px); }
      }
      @keyframes decoGoldGlow {
        0%   { box-shadow: 0 0 16px 4px rgba(201,168,76,0.35), 0 0 40px 12px rgba(204,58,0,0.15); }
        33%  { box-shadow: 0 0 28px 8px rgba(255,107,0,0.5), 0 0 60px 20px rgba(204,58,0,0.3); }
        66%  { box-shadow: 0 0 24px 6px rgba(240,192,64,0.5), 0 0 50px 18px rgba(201,168,76,0.25); }
        100% { box-shadow: 0 0 16px 4px rgba(201,168,76,0.35), 0 0 40px 12px rgba(204,58,0,0.15); }
      }
      @keyframes decoBorderShimmer {
        0%   { border-color: rgba(201,168,76,0.7); }
        25%  { border-color: rgba(255,107,0,0.85); }
        50%  { border-color: rgba(240,192,64,0.95); }
        75%  { border-color: rgba(204,58,0,0.8); }
        100% { border-color: rgba(201,168,76,0.7); }
      }
      @keyframes decoTextShimmer {
        0%, 100% { text-shadow: 0 0 8px rgba(240,192,64,0.4); }
        50%       { text-shadow: 0 0 20px rgba(240,192,64,0.8), 0 0 40px rgba(201,168,76,0.4); }
      }
      @keyframes questionSlideIn {
        0%   { transform: translateY(16px); opacity: 0; }
        100% { transform: translateY(0); opacity: 1; }
      }
      @keyframes questionStevenIn {
        0%   { transform: translateX(-12px) scaleX(0.96); opacity: 0; filter: brightness(2); }
        40%  { filter: brightness(1.4); }
        100% { transform: translateX(0) scaleX(1); opacity: 1; filter: brightness(1); }
      }
      .question-enter       { animation: questionSlideIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
      .question-steven-enter { animation: questionStevenIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both; }
      .steven-shake         { animation: stevenShake 0.6s ease-in-out; }
      .steven-glow          { animation: decoGoldGlow 2.5s ease-in-out infinite; }
      .steven-border-dance  { animation: decoBorderShimmer 2s ease-in-out infinite; }
      .steven-text-glitch   { animation: decoTextShimmer 3s ease-in-out infinite; }
    `}</style>
  );
}

// ── Art Deco Fire Overlay Animation ───────────────────────────────────────────

const DECO_RAYS = Array.from({ length: 24 }, (_, i) => ({ angle: i * 15, delay: i * 0.04 }));

const DECO_DIAMONDS = [
  { x: 10, y: 20, size: 18, delay: 0.1, dur: 1.4 },
  { x: 25, y: 70, size: 12, delay: 0.2, dur: 1.2 },
  { x: 40, y: 15, size: 24, delay: 0.05, dur: 1.6 },
  { x: 55, y: 80, size: 16, delay: 0.3, dur: 1.3 },
  { x: 70, y: 30, size: 20, delay: 0.15, dur: 1.5 },
  { x: 85, y: 60, size: 14, delay: 0.25, dur: 1.4 },
  { x: 15, y: 50, size: 10, delay: 0.4, dur: 1.1 },
  { x: 90, y: 10, size: 22, delay: 0.08, dur: 1.7 },
  { x: 50, y: 45, size: 30, delay: 0, dur: 1.8 },
  { x: 33, y: 85, size: 15, delay: 0.35, dur: 1.3 },
  { x: 75, y: 55, size: 18, delay: 0.18, dur: 1.5 },
  { x: 60, y: 25, size: 12, delay: 0.45, dur: 1.2 },
];

function DecoOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-[200] pointer-events-none overflow-hidden">
      {/* Fire + gold radial flash */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 60%, rgba(255,107,0,0.45) 0%, rgba(204,58,0,0.25) 20%, rgba(240,192,64,0.3) 40%, transparent 65%)',
        animation: 'decoFlash 1.5s ease-out forwards',
      }} />

      {/* Sunburst rays */}
      {DECO_RAYS.map((ray, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '140vmax',
            height: '2px',
            transformOrigin: '0 50%',
            transform: `translate(-50%, -50%) rotate(${ray.angle}deg)`,
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              transformOrigin: '0 50%',
              background: i % 3 === 0
                ? 'linear-gradient(to right, transparent 0%, rgba(255,107,0,0.7) 20%, rgba(204,58,0,0.3) 60%, transparent 100%)'
                : i % 3 === 1
                ? 'linear-gradient(to right, transparent 0%, rgba(240,192,64,0.6) 20%, rgba(201,168,76,0.3) 60%, transparent 100%)'
                : 'linear-gradient(to right, transparent 0%, rgba(255,140,53,0.5) 20%, rgba(201,168,76,0.2) 60%, transparent 100%)',
              animation: `decoSunburst 1.2s ease-out ${ray.delay}s forwards`,
            }}
          />
        </div>
      ))}

      {/* Geometric diamonds */}
      {DECO_DIAMONDS.map((d, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: `${d.y}%`,
            left: `${d.x}%`,
            width: `${d.size}px`,
            height: `${d.size}px`,
            background: i % 3 === 0
              ? 'linear-gradient(135deg, #FF6B00, #CC3A00)'
              : i % 3 === 1
              ? 'linear-gradient(135deg, #F0C040, #C9A84C)'
              : 'linear-gradient(135deg, #FF8C35, #C9A84C)',
            transform: 'translate(-50%, -50%) scale(0) rotate(45deg)',
            opacity: 0,
            animation: `decoDiamond ${d.dur}s ease-out ${d.delay}s forwards`,
          }}
        />
      ))}

      {/* Art Deco corner ornaments */}
      {[
        { top: 0, left: 0, rotate: 0 },
        { top: 0, right: 0, rotate: 90 },
        { bottom: 0, right: 0, rotate: 180 },
        { bottom: 0, left: 0, rotate: 270 },
      ].map((pos, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            ...pos,
            width: '120px',
            height: '120px',
            animation: `decoFlash 2s ease-out ${i * 0.1}s forwards`,
          }}
        >
          <svg viewBox="0 0 100 100" style={{ transform: `rotate(${pos.rotate}deg)`, width: '100%', height: '100%' }}>
            <polyline points="5,5 5,40 15,40" fill="none" stroke="#FF6B00" strokeWidth="2" opacity="0.8" />
            <polyline points="5,5 40,5 40,15" fill="none" stroke="#FF6B00" strokeWidth="2" opacity="0.8" />
            <polyline points="12,12 12,35 22,35" fill="none" stroke="#C9A84C" strokeWidth="1" opacity="0.6" />
            <polyline points="12,12 35,12 35,22" fill="none" stroke="#C9A84C" strokeWidth="1" opacity="0.6" />
          </svg>
        </div>
      ))}
    </div>
  );
}

// ── Steven Mode Toggle ────────────────────────────────────────────────────────

function StevenToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      className={`relative overflow-hidden border cursor-pointer select-none transition-all duration-500 ${
        on ? 'steven-glow steven-border-dance' : 'border-white/[0.08] hover:border-white/20'
      }`}
      style={{
        borderRadius: on ? '0px' : '12px',
        background: on
          ? 'linear-gradient(160deg, #0D0A00 0%, #1A1400 40%, #120E00 100%)'
          : '#0f0f0f',
        transition: 'all 0.5s ease',
      }}
      onClick={onToggle}
    >
      {on && (
        <div style={{ height: '3px', background: 'linear-gradient(to right, transparent, #CC3A00 15%, #FF6B00 35%, #F0C040 50%, #FF6B00 65%, #CC3A00 85%, transparent)' }} />
      )}

      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <div className="flex items-center gap-3">
          <div className={`shrink-0 transition-all duration-300 ${on ? '' : 'opacity-40'}`}>
            {on ? (
              <svg width="20" height="20" viewBox="0 0 20 20">
                <polygon points="10,1 19,10 10,19 1,10" fill="none" stroke="#C9A84C" strokeWidth="1.5" />
                <polygon points="10,4 16,10 10,16 4,10" fill="rgba(201,168,76,0.15)" stroke="#F0C040" strokeWidth="0.8" />
                <circle cx="10" cy="10" r="2" fill="#F0C040" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20">
                <polygon points="10,1 19,10 10,19 1,10" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
              </svg>
            )}
          </div>
          <div>
            <div
              className={`text-sm font-bold leading-tight tracking-[0.15em] uppercase ${on ? 'steven-text-glitch' : 'text-white/50'}`}
              style={on ? STEVEN_GRAD_STYLE : {}}
            >
              Steven Mode
            </div>
            <div className="text-[10px] leading-tight mt-0.5 tracking-wide" style={{ color: on ? 'rgba(255,107,0,0.7)' : 'rgba(255,255,255,0.2)' }}>
              {on ? '✦ Art Deco · Unhinged · No Mercy ✦' : 'engage for maximum scandal'}
            </div>
          </div>
        </div>

        <div
          className="relative w-11 h-6 shrink-0 transition-all duration-300"
          style={{
            borderRadius: on ? '0px' : '999px',
            background: on
              ? 'linear-gradient(90deg, #7A5A10, #C9A84C, #F0C040, #C9A84C, #7A5A10)'
              : 'rgba(255,255,255,0.1)',
          }}
        >
          <div
            className="absolute top-0.5 h-5 w-5 shadow-md transition-all duration-300"
            style={{
              borderRadius: on ? '0px' : '999px',
              background: on ? '#0D0A00' : 'white',
              left: on ? '22px' : '2px',
              border: on ? '1px solid #C9A84C' : 'none',
            }}
          />
        </div>
      </div>

      {on && (
        <>
          <div className="px-4 pb-3 flex gap-1.5 flex-wrap">
            {['HOT TAKES', 'MAX SCANDAL', 'BASED'].map((tag) => (
              <span
                key={tag}
                className="text-[9px] font-bold px-2 py-0.5 tracking-widest"
                style={{
                  background: tag === 'BASED' ? 'rgba(255,107,0,0.10)' : 'rgba(201,168,76,0.12)',
                  border: tag === 'BASED' ? '1px solid rgba(255,107,0,0.45)' : '1px solid rgba(201,168,76,0.35)',
                  color: tag === 'BASED' ? '#FF8C35' : '#C9A84C',
                  borderRadius: '0px',
                  clipPath: 'polygon(4px 0%, 100% 0%, calc(100% - 4px) 100%, 0% 100%)',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
          <div style={{ height: '3px', background: 'linear-gradient(to right, transparent, #C9A84C 20%, #F0C040 50%, #C9A84C 80%, transparent)' }} />
        </>
      )}
    </div>
  );
}

// ── Slider ────────────────────────────────────────────────────────────────────

function Slider({
  value, onChange, label, leftLabel, rightLabel, icon, steven,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  leftLabel: string;
  rightLabel: string;
  icon: React.ReactNode;
  steven?: boolean;
}) {
  const accent = steven ? '#C9A84C' : '#E8193C';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-semibold text-white/70">{label}</span>
        <span className="ml-auto text-xs font-bold text-white/40">{value}/10</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-white/30 w-14 text-right shrink-0">{leftLabel}</span>
        <input
          type="range"
          min={0}
          max={10}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
          style={{ background: `linear-gradient(to right, ${accent} ${value * 10}%, #333 ${value * 10}%)`, accentColor: accent }}
        />
        <span className="text-[10px] text-white/30 w-14 shrink-0">{rightLabel}</span>
      </div>
    </div>
  );
}

// ── Trending Cluster Card ─────────────────────────────────────────────────────

function TrendingClusterCard({
  cluster,
  onSelectAll,
}: {
  cluster: TrendingCluster;
  onSelectAll: (titles: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const timeAgo = (unix: number) => {
    const diff = Math.floor(Date.now() / 1000 - unix);
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div className="rounded-xl border border-orange-500/30 bg-orange-500/[0.04] overflow-hidden">
      <div
        className="flex items-start gap-3 p-3 cursor-pointer hover:bg-orange-500/[0.06] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5 mt-0.5 shrink-0">
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">
            {cluster.sourceCount} sources
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/90 leading-snug line-clamp-2 font-medium">
            {cluster.topic}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {cluster.sources.map((src) => {
              const meta = SOURCE_META[src] ?? { label: src, color: 'bg-white/10 text-white/40' };
              return (
                <span key={src} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.color}`}>
                  {meta.label}
                </span>
              );
            })}
          </div>
        </div>
        <div className="shrink-0 text-white/30 mt-0.5">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-orange-500/20">
          {cluster.articles.map((article, i) => {
            const meta = SOURCE_META[article.source] ?? { label: article.source, color: 'bg-white/10 text-white/40' };
            return (
              <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 border-b border-white/[0.04] last:border-0">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${meta.color}`}>
                  {meta.label}
                </span>
                <p className="flex-1 text-xs text-white/60 leading-snug line-clamp-2">{article.title}</p>
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                  {article.publishedAt && (
                    <span className="text-[10px] text-white/20">{timeAgo(article.publishedAt)}</span>
                  )}
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-white/25 hover:text-orange-400 transition-colors"
                    title="Open article"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            );
          })}
          <div className="px-3 py-2.5 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSelectAll(cluster.articles.map((a) => a.title))}
              className="text-[11px] text-orange-400 hover:text-orange-300 h-auto py-1"
            >
              <Check className="h-3 w-3 mr-1" />
              Use as context for questions
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Trending Section ──────────────────────────────────────────────────────────

function TrendingSection({ onAddHeadlines }: { onAddHeadlines: (titles: string[]) => void }) {
  const [clusters, setClusters] = useState<TrendingCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch('/app/api/icebreaker/trending')
      .then((r) => r.json())
      .then((d) => { setClusters(d.clusters ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (!loading && clusters.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 mb-3 w-full text-left group cursor-pointer"
      >
        <Flame className="h-4 w-4 text-orange-400 shrink-0" />
        <span className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">
          Trending Now
        </span>
        <span className="text-[11px] text-white/30 ml-1">
          {loading ? '' : `${clusters.length} hot topic${clusters.length !== 1 ? 's' : ''} covered by multiple outlets`}
        </span>
        <span className="ml-auto text-white/30 group-hover:text-white/60 transition-colors">
          {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-2">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-orange-500/[0.04] border border-orange-500/20 animate-pulse" />
            ))
          ) : (
            clusters.map((cluster) => (
              <TrendingClusterCard key={cluster.id} cluster={cluster} onSelectAll={onAddHeadlines} />
            ))
          )}
        </div>
      )}

      <div className="mt-4 mb-2 border-b border-white/[0.06]" />
    </div>
  );
}

// ── History Dialog ────────────────────────────────────────────────────────────

function HistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/app/api/icebreaker/history')
      .then((r) => r.json())
      .then((d) => { setHistory(d.history ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg flex flex-col max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-red-500" />
            Question History
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {loading ? (
            <p className="text-sm text-muted-foreground animate-pulse text-center py-8">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No questions used yet.</p>
          ) : (
            history.map((entry) => (
              <div key={entry.id} className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3">
                <p className="text-sm text-white/90 leading-snug mb-1.5">"{entry.question}"</p>
                <p className="text-[11px] text-white/30">
                  {new Date(entry.used_at + 'Z').toLocaleDateString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                  })}
                  {entry.session_label && ` · ${entry.session_label}`}
                </p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Headline Card ─────────────────────────────────────────────────────────────

function HeadlineCard({
  headline, selected, onToggle, steven,
}: {
  headline: Headline;
  selected: boolean;
  onToggle: () => void;
  steven: boolean;
}) {
  const timeAgo = (unix: number) => {
    const diff = Math.floor(Date.now() / 1000 - unix);
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  };

  const selectedColor = steven ? '#C9A84C' : '#E8193C';

  return (
    <div
      onClick={onToggle}
      className={`group relative rounded-xl border cursor-pointer transition-all duration-150 select-none ${
        selected
          ? 'bg-[#E8193C]/[0.07]'
          : 'border-white/[0.06] bg-[#141414] hover:border-white/20 hover:bg-white/[0.03]'
      }`}
      style={selected ? { borderColor: `${selectedColor}99` } : {}}
    >
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <div
            className="mt-0.5 h-4 w-4 rounded shrink-0 border transition-all flex items-center justify-center"
            style={selected
              ? { borderColor: selectedColor, backgroundColor: selectedColor }
              : { borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'transparent' }}
          >
            {selected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <SourceBadge source={headline.source} />
              {headline.score && (
                <span className="text-[10px] text-orange-400/70 font-semibold">▲ {headline.score}</span>
              )}
              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                {headline.publishedAt && (
                  <span className="text-[10px] text-white/20">{timeAgo(headline.publishedAt)}</span>
                )}
                <a
                  href={headline.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-white/25 hover:text-white/70 transition-colors"
                  title="Open article"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <p className="text-sm text-white/80 leading-snug group-hover:text-white/95 transition-colors line-clamp-2">
              {headline.title}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Question Card ─────────────────────────────────────────────────────────────

function QuestionCard({
  question, index, onUse, used, steven,
}: {
  question: string;
  index: number;
  onUse: () => void;
  used: boolean;
  steven: boolean;
}) {
  const normalColors = ['#FF8C35', '#E8193C', '#F4607A', '#c0392b', '#e67e22'];
  const stevenColors = ['#C9A84C', '#F0C040', '#D4A843', '#B8960C', '#E6C35A'];
  const colors = steven ? stevenColors : normalColors;
  const accent = colors[index % colors.length];
  const gradBg = steven ? STEVEN_GRAD_BG : GRAD_BG;

  return (
    <div
      className={`relative overflow-hidden transition-all ${
        used
          ? steven ? 'bg-[#0F0C00]' : 'border-emerald-500/50 bg-emerald-500/[0.06]'
          : steven ? 'bg-[#0D0A00]' : 'border-white/[0.08] bg-[#141414]'
      } ${steven && !used ? 'steven-border-dance' : ''}`}
      style={{
        borderRadius: steven ? '0px' : '16px',
        border: used && steven
          ? '1px solid rgba(201,168,76,0.6)'
          : used
          ? '1px solid rgba(16,185,129,0.5)'
          : steven
          ? '1px solid rgba(201,168,76,0.3)'
          : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {steven && (
        <div style={{ height: '2px', background: `linear-gradient(to right, transparent, #CC3A00 15%, ${accent} 40%, ${accent} 60%, #CC3A00 85%, transparent)` }} />
      )}
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{
        backgroundColor: used ? (steven ? '#C9A84C' : '#10b981') : accent,
        display: steven ? 'none' : 'block',
      }} />
      <div className="pl-4 pr-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <p className={`text-base font-medium leading-snug flex-1 ${used ? 'text-emerald-300' : 'text-white/90'}`}>
            {question}
          </p>
          {used ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold shrink-0 mt-0.5">
              <Check className="h-3.5 w-3.5" />
              Selected
            </span>
          ) : (
            <Button
              onClick={onUse}
              size="sm"
              className="shrink-0 mt-0.5 text-white hover:text-white h-auto py-1.5 px-3"
              style={gradBg}
            >
              <Check className="h-3 w-3 mr-1" />
              Use this
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Phase = 'browse' | 'results';

export default function IcebreakerPage() {
  // Headlines
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [loadingHeadlines, setLoadingHeadlines] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [activeSource, setActiveSource] = useState<string>('all');
  const [showAll, setShowAll] = useState(false);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraContext, setExtraContext] = useState<string[]>([]);

  // Sliders
  const [wildness, setWildness] = useState(5);
  const [existential, setExistential] = useState(4);

  // Steven Mode
  const [stevenMode, setStevenMode] = useState(false);
  const [fireAnimating, setFireAnimating] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  const toggleSteven = () => {
    const next = !stevenMode;
    setStevenMode(next);
    if (next) {
      setFireAnimating(true);
      if (pageRef.current) {
        pageRef.current.classList.add('steven-shake');
        setTimeout(() => pageRef.current?.classList.remove('steven-shake'), 600);
      }
      setTimeout(() => setFireAnimating(false), 2800);
    }
  };

  // Generation
  const [generating, setGenerating] = useState(false);
  const [questions, setQuestions] = useState<string[]>([]);
  const [questionsKey, setQuestionsKey] = useState(0);
  const [genError, setGenError] = useState('');
  const [phase, setPhase] = useState<Phase>('browse');
  const [usedIndex, setUsedIndex] = useState<number | null>(null);
  const [sessionLabel, setSessionLabel] = useState('');

  // History
  const [showHistory, setShowHistory] = useState(false);

  const resultsRef = useRef<HTMLDivElement>(null);

  const activeGradStyle = stevenMode ? STEVEN_GRAD_STYLE : GRAD_STYLE;
  const activeGradBg = stevenMode ? STEVEN_GRAD_BG : GRAD_BG;

  // ── Load headlines ─────────────────────────────────────────────────────────

  const loadHeadlines = useCallback(async (bust = false) => {
    if (bust) { setRefreshing(true); }
    else { setLoadingHeadlines(true); }

    try {
      if (bust) await fetch('/app/api/icebreaker/refresh', { method: 'POST' });
      const r = await fetch('/app/api/icebreaker/headlines');
      const data = await r.json();
      setHeadlines(data.headlines ?? []);
      setFetchedAt(data.fetchedAt);
    } catch {
      // silent
    } finally {
      setLoadingHeadlines(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadHeadlines(); }, [loadHeadlines]);

  // ── Toggle selection ───────────────────────────────────────────────────────

  const toggleHeadline = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addTrendingContext = (titles: string[]) => {
    setExtraContext((prev) => [...new Set([...prev, ...titles])]);
  };

  // ── Generate ───────────────────────────────────────────────────────────────

  const generate = useCallback(async () => {
    setGenerating(true);
    setGenError('');
    setUsedIndex(null);

    const selectedTitles = [
      ...headlines.filter((h) => selected.has(h.id)).map((h) => h.title),
      ...extraContext,
    ];

    try {
      const r = await fetch('/app/api/icebreaker/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headlines: selectedTitles, wildness, existential, stevenMode }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Generation failed');
      setQuestions(data.questions ?? []);
      setQuestionsKey((k) => k + 1);
      setPhase('results');
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err) {
      setGenError(String(err));
    } finally {
      setGenerating(false);
    }
  }, [headlines, selected, wildness, existential, extraContext, stevenMode]);

  // ── Use question ───────────────────────────────────────────────────────────

  const useQuestion = async (index: number) => {
    setUsedIndex(index);
    const selectedTitles = [
      ...headlines.filter((h) => selected.has(h.id)).map((h) => h.title),
      ...extraContext,
    ];

    await fetch('/app/api/icebreaker/use', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: questions[index],
        sessionLabel: sessionLabel || null,
        sourceHeadlines: selectedTitles,
      }),
    }).catch(() => {});
  };

  // ── Filtered headlines ─────────────────────────────────────────────────────

  const filtered = headlines.filter((h) => activeSource === 'all' ? true : h.source === activeSource);
  const visible = showAll ? filtered : filtered.slice(0, 12);
  const sources = ['all', ...Array.from(new Set(headlines.map((h) => h.source)))];

  // ── Time formatting ────────────────────────────────────────────────────────

  const timeAgo = (ms: number) => {
    const diff = Date.now() - ms;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <IcebreakerStyles />
      <DecoOverlay active={fireAnimating} />
      <HistoryDialog open={showHistory} onClose={() => setShowHistory(false)} />

      <AppLayout
        icon={<MessageSquarePlus size={20} />}
        iconClassName="bg-red-500/10 text-red-500"
        title={
          stevenMode
            ? <span style={STEVEN_GRAD_STYLE} className="steven-text-glitch">✦ STEVEN SPEAKS ✦</span>
            : 'Hack Night Icebreakers'
        }
        subtitle={fetchedAt ? `Updated ${timeAgo(fetchedAt)}` : 'Tech headlines for your team'}
        actions={
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(true)}>
              <History className="h-4 w-4 mr-1.5" />
              History
            </Button>
            <Button variant="ghost" size="sm" onClick={() => loadHeadlines(true)} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        }
      >
        <div
          ref={pageRef}
          className="h-full overflow-y-auto transition-all duration-700 pb-12"
          style={stevenMode ? {
            background: `
              radial-gradient(ellipse at 50% 0%, rgba(255,107,0,0.06) 0%, transparent 45%),
              radial-gradient(ellipse at 100% 100%, rgba(240,192,64,0.04) 0%, transparent 50%),
              radial-gradient(ellipse at 0% 60%, rgba(204,58,0,0.04) 0%, transparent 50%)
            `,
          } : {}}
        >
          <div className="max-w-5xl mx-auto px-6 py-6 lg:grid lg:grid-cols-[1fr_340px] lg:gap-8 lg:items-start">

            {/* ── Left: Headlines ─────────────────────────────────────────── */}
            <div>
              <TrendingSection onAddHeadlines={addTrendingContext} />

              <div className="mb-4">
                <h2 className="text-sm font-semibold text-white/70 mb-1">All headlines</h2>
                <p className="text-xs text-white/30">
                  {stevenMode
                    ? '✦ Select your ammo. Steven will make it hurt.'
                    : 'Select 1–5 that feel relevant. Or skip ahead and get pure random questions.'}
                </p>
              </div>

              {/* Source tabs */}
              <div className="flex gap-1.5 flex-wrap mb-4">
                {sources.map((src) => (
                  <button
                    key={src}
                    onClick={() => setActiveSource(src)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all cursor-pointer ${
                      activeSource === src
                        ? 'text-white'
                        : 'bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10'
                    }`}
                    style={activeSource === src ? activeGradBg : {}}
                  >
                    {src === 'all' ? 'All' : (SOURCE_META[src]?.label ?? src)}
                  </button>
                ))}
              </div>

              {/* Headline list */}
              {loadingHeadlines ? (
                <div className="space-y-2">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="h-14 rounded-xl bg-white/[0.03] animate-pulse" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-white/30 text-center py-12">No headlines from this source.</p>
              ) : (
                <>
                  <div className="space-y-2">
                    {visible.map((h) => (
                      <HeadlineCard
                        key={h.id}
                        headline={h}
                        selected={selected.has(h.id)}
                        onToggle={() => toggleHeadline(h.id)}
                        steven={stevenMode}
                      />
                    ))}
                  </div>
                  {filtered.length > 12 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAll(!showAll)}
                      className="mt-3 mx-auto flex text-white/30 hover:text-white/60"
                    >
                      {showAll ? (
                        <><ChevronUp className="h-3.5 w-3.5 mr-1" /> Show less</>
                      ) : (
                        <><ChevronDown className="h-3.5 w-3.5 mr-1" /> Show {filtered.length - 12} more</>
                      )}
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* ── Right: Controls + Results ────────────────────────────────── */}
            <div className="mt-8 lg:mt-0">
              <div className="lg:sticky lg:top-6 space-y-4">

                {/* Controls card */}
                <div
                  className={`rounded-2xl border p-5 space-y-5 transition-all duration-500 ${stevenMode ? 'steven-glow steven-border-dance' : 'border-white/[0.08]'}`}
                  style={{ background: stevenMode ? 'linear-gradient(160deg, #0D0A00 0%, #1A1400 50%, #100D00 100%)' : '#111' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {stevenMode
                      ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" className="steven-text-glitch">
                          <polygon points="8,1 15,8 8,15 1,8" fill="rgba(201,168,76,0.2)" stroke="#C9A84C" strokeWidth="1.2" />
                          <polygon points="8,4 12,8 8,12 4,8" fill="rgba(240,192,64,0.3)" stroke="#F0C040" strokeWidth="0.7" />
                          <circle cx="8" cy="8" r="1.5" fill="#F0C040" />
                        </svg>
                      )
                      : <Sparkles className="h-4 w-4 text-orange-400" />}
                    <span
                      className={`text-sm font-semibold ${stevenMode ? 'steven-text-glitch' : 'text-white/80'}`}
                      style={stevenMode ? STEVEN_GRAD_STYLE : {}}
                    >
                      {stevenMode ? 'UNLEASH THE QUESTIONS' : 'Generate Questions'}
                    </span>
                  </div>

                  {/* Selected count */}
                  {(() => {
                    const total = selected.size + extraContext.length;
                    const activeBg = stevenMode ? 'rgba(201,168,76,0.08)' : 'rgba(232,25,60,0.1)';
                    const activeBorder = stevenMode ? 'rgba(201,168,76,0.35)' : 'rgba(232,25,60,0.3)';
                    const activeText = stevenMode ? '#C9A84C' : '#F4607A';
                    return (
                      <div
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all"
                        style={total > 0
                          ? { background: activeBg, border: `1px solid ${activeBorder}`, color: activeText }
                          : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' }}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {total > 0 ? (
                          <span>
                            {selected.size > 0 && `${selected.size} headline${selected.size > 1 ? 's' : ''}`}
                            {selected.size > 0 && extraContext.length > 0 && ' + '}
                            {extraContext.length > 0 && `${extraContext.length} trending topic${extraContext.length > 1 ? 's' : ''}`}
                            {' selected'}
                            {extraContext.length > 0 && (
                              <button
                                onClick={() => setExtraContext([])}
                                className="ml-2 text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ) : stevenMode ? '✦ No context — pure chaos mode ✦' : 'No context selected — pure random mode'}
                      </div>
                    );
                  })()}

                  {/* Session label */}
                  <div>
                    <label className="text-xs text-white/40 mb-1.5 block">Session label (optional)</label>
                    <Input
                      value={sessionLabel}
                      onChange={(e) => setSessionLabel(e.target.value)}
                      placeholder="e.g. Monday Apr 7"
                      className="bg-white/[0.04] border-white/[0.08] text-white/70 placeholder:text-white/20 focus:border-white/20 h-8 text-xs"
                    />
                  </div>

                  {/* Sliders */}
                  {!stevenMode && (
                    <>
                      <Slider
                        value={wildness}
                        onChange={setWildness}
                        label="Spice Level"
                        leftLabel="Chill"
                        rightLabel="Wild"
                        icon={<Zap className="h-4 w-4 text-orange-400" />}
                        steven={stevenMode}
                      />
                      <Slider
                        value={existential}
                        onChange={setExistential}
                        label="Depth"
                        leftLabel="Quick"
                        rightLabel="Existential"
                        icon={<Brain className="h-4 w-4 text-purple-400" />}
                        steven={stevenMode}
                      />
                    </>
                  )}

                  {stevenMode && (
                    <div className="px-3 py-2.5 text-xs space-y-1" style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: '0px' }}>
                      <div style={{ height: '1px', background: 'linear-gradient(to right, transparent, rgba(255,107,0,0.6), rgba(201,168,76,0.5), rgba(255,107,0,0.6), transparent)', marginBottom: '8px' }} />
                      <p className="font-bold tracking-widest uppercase text-[10px]" style={{ color: '#FF8C35' }}>✦ Spice Locked at MAX · Depth Set to CHAOS ✦</p>
                      <p style={{ color: 'rgba(255,107,0,0.5)' }}>Sliders are irrelevant. Steven doesn't do mild. Adjust nothing.</p>
                      <div style={{ height: '1px', background: 'linear-gradient(to right, transparent, rgba(255,107,0,0.6), rgba(201,168,76,0.5), rgba(255,107,0,0.6), transparent)', marginTop: '8px' }} />
                    </div>
                  )}

                  {/* Steven Mode Toggle */}
                  <StevenToggle on={stevenMode} onToggle={toggleSteven} />

                  {/* Generate button */}
                  <Button
                    onClick={generate}
                    disabled={generating}
                    className="w-full py-3 font-bold text-white text-sm h-auto"
                    style={activeGradBg}
                  >
                    {generating ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> {stevenMode ? 'Unleashing…' : 'Generating…'}</>
                    ) : (
                      <>
                        {stevenMode ? (
                          <svg width="14" height="14" viewBox="0 0 14 14" className="mr-2"><polygon points="7,1 13,7 7,13 1,7" fill="none" stroke="white" strokeWidth="1.2"/><circle cx="7" cy="7" r="2" fill="white"/></svg>
                        ) : (
                          <ArrowRight className="h-4 w-4 mr-2" />
                        )}
                        {stevenMode ? 'UNLEASH THE QUESTIONS' : 'Generate Questions'}
                      </>
                    )}
                  </Button>

                  {genError && (
                    <p className="text-xs text-red-400/80 text-center">{genError}</p>
                  )}
                </div>

                {/* ── Results ──────────────────────────────────────────────── */}
                {phase === 'results' && questions.length > 0 && (
                  <div ref={resultsRef} className="space-y-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-white/50 uppercase tracking-widest" style={stevenMode ? STEVEN_GRAD_STYLE : {}}>
                        {stevenMode ? '✦ Choose Your Scandal ✦' : 'Pick one'}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={generate}
                        disabled={generating}
                        className="text-white/40 hover:text-white/70 h-auto py-1"
                      >
                        <Shuffle className="h-3.5 w-3.5 mr-1.5" />
                        Regenerate
                      </Button>
                    </div>

                    {questions.map((q, i) => (
                      <div
                        key={`${questionsKey}-${i}`}
                        className={stevenMode ? 'question-steven-enter' : 'question-enter'}
                        style={{ animationDelay: `${i * 0.07}s` }}
                      >
                        <QuestionCard
                          question={q}
                          index={i}
                          onUse={() => useQuestion(i)}
                          used={usedIndex === i}
                          steven={stevenMode}
                        />
                      </div>
                    ))}

                    {usedIndex !== null && (
                      <div
                        className="p-3 text-center"
                        style={stevenMode ? {
                          background: 'linear-gradient(135deg, rgba(204,58,0,0.08) 0%, rgba(201,168,76,0.06) 100%)',
                          border: '1px solid rgba(255,107,0,0.45)',
                          borderRadius: '0px',
                        } : {
                          background: 'rgba(16,185,129,0.1)',
                          border: '1px solid rgba(16,185,129,0.3)',
                          borderRadius: '12px',
                        }}
                      >
                        <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: stevenMode ? '#FF8C35' : '#34d399' }}>
                          {stevenMode ? '✦ Locked In. Good luck. ✦' : '✓ Saved to history'}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: stevenMode ? 'rgba(255,107,0,0.6)' : 'rgba(52,211,153,0.6)' }}>
                          "{questions[usedIndex]}"
                        </p>
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    </>
  );
}
