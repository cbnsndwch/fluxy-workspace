import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import {
  ArrowLeft,
  Music,
  Clock,
  Zap,
  Heart,
  Activity,
  Mic2,
  Guitar,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { AppLayout } from "@/components/ui/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  palette: string | null;
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

const KEY_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function DnaStat({
  label,
  value,
  icon: Icon,
  percent = false,
}: {
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
        <span className="text-xs font-mono font-medium">{percent ? `${pct}%` : value}</span>
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

function StorySection({ story }: { story: string }) {
  const paragraphs = story.split(/\n+/).filter((p) => p.trim().length > 0);
  const [expanded, setExpanded] = useState(false);
  const showToggle = paragraphs.length > 2;
  const visible = showToggle && !expanded ? paragraphs.slice(0, 2) : paragraphs;

  return (
    <div className="flex flex-col gap-3">
      {visible.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-foreground/80">
          {p}
        </p>
      ))}
      {showToggle && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 cursor-pointer self-start transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Read more ({paragraphs.length - 2} more paragraphs)
            </>
          )}
        </button>
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
  const [generatingLore, setGeneratingLore] = useState(false);
  const [loreError, setLoreError] = useState<string | null>(null);

  useEffect(() => {
    if (!artistSlug || !trackSlug) return;
    let ignore = false;
    setLoading(true);
    fetch(`/app/api/musicologia/tracks/${artistSlug}/${trackSlug}`)
      .then((r) => {
        if (r.status === 404) {
          if (!ignore) {
            setNotFound(true);
            setLoading(false);
          }
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!ignore && data) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [artistSlug, trackSlug]);

  const handleGenerateLore = async () => {
    if (!detail) return;
    setGeneratingLore(true);
    setLoreError(null);
    try {
      const res = await fetch(`/app/api/musicologia/tracks/${detail.track.id}/generate-lore`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setLoreError(d.error ?? "Lore generation failed");
      } else {
        const lore = (await res.json()) as TrackLore;
        setDetail((prev) => (prev ? { ...prev, lore } : prev));
      }
    } catch {
      setLoreError("Network error");
    } finally {
      setGeneratingLore(false);
    }
  };

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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/musicologia")}
            className="cursor-pointer"
          >
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
  const credits: Array<{ role: string; name: string }> = lore?.credits
    ? JSON.parse(lore.credits)
    : [];
  const palette: string[] = dna?.palette ? JSON.parse(dna.palette) : [];
  const hasLore = !!(lore?.tagline || lore?.story || trivia.length > 0 || themes.length > 0);

  return (
    <AppLayout
      icon={<Music size={20} />}
      iconClassName="bg-purple-500/10 text-purple-500"
      title="Musicologia"
      subtitle={`${track.artist} · ${track.title}`}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateLore}
            disabled={generatingLore}
            className="cursor-pointer border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
          >
            {generatingLore ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                {hasLore ? "Regenerate Lore" : "Generate Lore"}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/musicologia")}
            className="cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Gallery
          </Button>
        </div>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 flex flex-col gap-6">
          {/* Error */}
          {loreError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
              {loreError}
            </div>
          )}

          {/* Hero */}
          <div className="flex gap-6">
            <div className="shrink-0 w-40 h-40 rounded-xl overflow-hidden bg-purple-500/5 border border-border/30 flex items-center justify-center">
              {track.cover_url ? (
                <img
                  src={track.cover_url}
                  alt={track.title}
                  className="w-full h-full object-cover"
                />
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
                    {KEY_NAMES[dna.key]}
                    {dna.mode === 0 ? "m" : ""}{" "}
                    {dna.time_signature ? `· ${dna.time_signature}/4` : ""}
                  </Badge>
                )}
              </div>
              {/* Palette swatches */}
              {palette.length > 0 && (
                <div className="flex gap-1.5 mt-2">
                  {palette.map((color, i) => (
                    <div
                      key={i}
                      className="w-6 h-6 rounded-full border border-border/30"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* DNA Stats */}
          {dna && (
            <div className="rounded-xl border border-border/30 bg-card/50 p-5">
              <h2 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
                Audio DNA
              </h2>
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
                    <span className="text-xs font-mono font-medium">
                      {dna.loudness.toFixed(1)} dB
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Lore */}
          {hasLore && (
            <div className="rounded-xl border border-border/30 bg-card/50 p-5 flex flex-col gap-5">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Lore
              </h2>

              {/* Story */}
              {lore?.story && <StorySection story={lore.story} />}

              {/* Themes */}
              {themes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {themes.map((t: string) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="text-xs text-purple-400 border-purple-500/30"
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Trivia */}
              {trivia.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Trivia
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {trivia.map((item: string, i: number) => (
                      <div
                        key={i}
                        className="rounded-lg bg-purple-500/5 border border-purple-500/15 px-3.5 py-2.5"
                      >
                        <p className="text-xs text-foreground/75 leading-relaxed">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Credits */}
              {credits.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Credits
                  </p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    {credits.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{c.role}</span>
                        <span className="font-medium text-foreground/80">{c.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty lore state */}
          {!hasLore && !generatingLore && (
            <div className="rounded-xl border border-dashed border-purple-500/20 p-6 flex flex-col items-center gap-3 text-center">
              <Sparkles className="h-8 w-8 text-purple-500/30" />
              <p className="text-sm text-muted-foreground">
                No lore yet. Generate AI-powered narrative content for this track.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateLore}
                className="cursor-pointer border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Generate Lore
              </Button>
            </div>
          )}

          {/* Lyrics */}
          {lyrics.length > 0 ? (
            <div className="rounded-xl border border-border/30 bg-card/50 p-5">
              <h2 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
                Lyrics
              </h2>
              <div className="space-y-1.5">
                {lyrics.map((line) => (
                  <p
                    key={line.id}
                    className={`text-sm leading-relaxed ${line.emphasis ? "text-purple-400 font-medium" : "text-foreground/70"}`}
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
