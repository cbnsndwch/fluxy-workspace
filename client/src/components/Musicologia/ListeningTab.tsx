import { useState, useEffect, useCallback } from "react";
import { Music, Loader2, Radio, WifiOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StagingItem {
  id: number;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  album_art: string | null;
  duration_ms: number | null;
  first_played_at: string;
  last_played_at: string;
  play_count: number;
  status: "pending" | "importing" | "imported" | "dismissed";
  musicologia_track_id: number | null;
}

interface Play {
  id: number;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  album_art: string | null;
  duration_ms: number | null;
  played_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Scrobbler Status ──────────────────────────────────────────────────────────

export function ScrobblerStatus({ spotifyConnected }: { spotifyConnected: boolean | null }) {
  if (spotifyConnected === null) return null;
  if (spotifyConnected) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-400">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        Scrobbling
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-red-400">
      <WifiOff className="h-3 w-3" />
      Not connected
    </div>
  );
}

// ── Staging Queue ─────────────────────────────────────────────────────────────

function QueueSection() {
  const [items, setItems] = useState<StagingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/app/api/musicologia/staging?status=pending");
      const data = (await res.json()) as { staging: StagingItem[] };
      // Also load importing ones
      const res2 = await fetch("/app/api/musicologia/staging?status=importing");
      const data2 = (await res2.json()) as { staging: StagingItem[] };
      setItems([...data2.staging, ...data.staging]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll every 30s for new items
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const handleImport = async (item: StagingItem) => {
    setImporting((prev) => new Set(prev).add(item.id));
    try {
      await fetch(`/app/api/musicologia/staging/${item.id}/import`, { method: "POST" });
      await load();
    } catch {
      // fallback: just reload
      await load();
    } finally {
      setImporting((prev) => {
        const s = new Set(prev);
        s.delete(item.id);
        return s;
      });
    }
  };

  const handleDismiss = async (item: StagingItem) => {
    try {
      await fetch(`/app/api/musicologia/staging/${item.id}/dismiss`, { method: "POST" });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
        <Radio className="h-10 w-10 opacity-20" />
        <p className="text-sm">Nothing in the queue yet — start listening on Spotify</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const isImporting = importing.has(item.id) || item.status === "importing";
        return (
          <div
            key={item.id}
            className="flex items-center gap-3 p-3 rounded-lg border border-border/40 hover:border-border/70 bg-card/50 transition-colors"
          >
            {/* Album art */}
            <div className="w-[60px] h-[60px] rounded-md overflow-hidden bg-purple-500/5 border border-border/30 shrink-0">
              {item.album_art ? (
                <img
                  src={item.album_art}
                  alt={item.album_name ?? ""}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <Music className="h-5 w-5 text-purple-500/30" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{item.track_name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {item.artist_name}
                {item.album_name ? ` · ${item.album_name}` : ""}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500/15 text-emerald-400 border-0 font-normal">
                  {item.play_count}×
                </Badge>
                <span className="text-[10px] text-muted-foreground/60">
                  first heard {relativeTime(item.first_played_at)}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                className="h-7 text-xs bg-purple-600 hover:bg-purple-700 cursor-pointer"
                onClick={() => handleImport(item)}
                disabled={isImporting}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Importing…
                  </>
                ) : (
                  "Import"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs cursor-pointer"
                onClick={() => handleDismiss(item)}
                disabled={isImporting}
              >
                Dismiss
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Listening History ─────────────────────────────────────────────────────────

function HistorySection() {
  const [plays, setPlays] = useState<Play[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const LIMIT = 50;

  const load = useCallback(async (off: number, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await fetch(`/app/api/musicologia/plays?limit=${LIMIT}&offset=${off}`);
      const data = (await res.json()) as { plays: Play[]; total: number };
      if (append) {
        setPlays((prev) => [...prev, ...(data.plays ?? [])]);
      } else {
        setPlays(data.plays ?? []);
      }
      setTotal(data.total ?? 0);
    } catch {
      /* ignore */
    }
    if (append) setLoadingMore(false);
    else setLoading(false);
  }, []);

  useEffect(() => {
    load(0);
  }, [load]);

  const handleLoadMore = async () => {
    const newOffset = offset + LIMIT;
    setOffset(newOffset);
    await load(newOffset, true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (plays.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
        <Music className="h-10 w-10 opacity-20" />
        <p className="text-sm">No listening history yet</p>
      </div>
    );
  }

  // Group by day
  const groups: { label: string; plays: Play[] }[] = [];
  let currentLabel = "";
  for (const play of plays) {
    const label = dayLabel(play.played_at);
    if (label !== currentLabel) {
      groups.push({ label, plays: [play] });
      currentLabel = label;
    } else {
      groups[groups.length - 1].plays.push(play);
    }
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider mb-2">
            {group.label}
          </p>
          <div className="space-y-1">
            {group.plays.map((play) => (
              <div
                key={play.id}
                className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/30 transition-colors"
              >
                <div className="w-10 h-10 rounded overflow-hidden bg-purple-500/5 border border-border/20 shrink-0">
                  {play.album_art ? (
                    <img src={play.album_art} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Music className="h-4 w-4 text-purple-500/30" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{play.track_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{play.artist_name}</p>
                </div>
                <span className="text-[11px] text-muted-foreground/50 shrink-0">
                  {relativeTime(play.played_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {plays.length < total && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="cursor-pointer"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Loading…
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Listening Tab ─────────────────────────────────────────────────────────────

export function ListeningTab({ queueCount }: { queueCount: number }) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <Tabs defaultValue="queue" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="queue" className="cursor-pointer">
            Queue
            {queueCount > 0 && (
              <Badge className="ml-2 h-4 text-[10px] px-1.5 bg-purple-500/20 text-purple-400 border-0">
                {queueCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="cursor-pointer">
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="queue">
          <QueueSection />
        </TabsContent>
        <TabsContent value="history">
          <HistorySection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
