import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { Radio, Users, Globe, RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/ui/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Activity {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  actor_login: string | null;
  actor_avatar: string | null;
  actor_avatar_url: string | null;
  verb: string;
  object_type: string;
  object_id: number;
  object_title: string | null;
  meta: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function Avatar({
  url,
  name,
  size = 36,
}: {
  url?: string | null;
  name?: string | null;
  size?: number;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? "User"}
        className="rounded-full object-cover shrink-0 ring-1 ring-border"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 text-purple-300 font-medium ring-1 ring-purple-500/20"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {(name ?? "?")[0]?.toUpperCase()}
    </div>
  );
}

const VERB_LABELS: Record<string, string> = {
  listened: "listened to",
  loved: "reacted to",
  added_to_playlist: "added to playlist",
  created_playlist: "created playlist",
  commented: "commented on",
  followed: "followed",
};

const VERB_COLORS: Record<string, string> = {
  listened: "bg-blue-500/10 text-blue-400",
  loved: "bg-pink-500/10 text-pink-400",
  added_to_playlist: "bg-green-500/10 text-green-400",
  created_playlist: "bg-emerald-500/10 text-emerald-400",
  commented: "bg-purple-500/10 text-purple-400",
  followed: "bg-amber-500/10 text-amber-400",
};

// ── Activity Card ─────────────────────────────────────────────────────────────

function ActivityCard({
  activity,
  onNavigate,
}: {
  activity: Activity;
  onNavigate: (id: number) => void;
}) {
  const name = activity.actor_name ?? activity.actor_login ?? "Someone";
  const avatar = activity.actor_avatar ?? activity.actor_avatar_url;
  const verbLabel = VERB_LABELS[activity.verb] ?? activity.verb;
  const verbColor = VERB_COLORS[activity.verb] ?? "bg-muted text-muted-foreground";
  let meta: Record<string, unknown> = {};
  if (activity.meta) {
    try {
      meta = JSON.parse(activity.meta) as Record<string, unknown>;
    } catch {
      /* noop */
    }
  }

  return (
    <div className="flex gap-3 p-4 rounded-xl border border-border hover:bg-muted/30 transition-colors">
      <Avatar url={avatar} name={name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold">{name}</span>{" "}
            <span className="text-sm text-muted-foreground">{verbLabel}</span>{" "}
            {activity.object_title && (
              <button
                className="text-sm font-medium text-purple-400 hover:text-purple-300 transition-colors cursor-pointer"
                onClick={() => activity.object_type === "track" && onNavigate(activity.object_id)}
              >
                {activity.object_title}
              </button>
            )}
            {meta.emoji && <span className="ml-1 text-base">{meta.emoji as string}</span>}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {timeAgo(activity.created_at)}
          </span>
        </div>
        <div className="mt-1.5">
          <Badge variant="secondary" className={`text-[10px] px-2 py-0 ${verbColor} border-0`}>
            {activity.verb}
          </Badge>
        </div>
      </div>
    </div>
  );
}

// ── Feed Page ─────────────────────────────────────────────────────────────────

export default function FeedPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"following" | "global">("global");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);

  const load = useCallback((m: typeof mode) => {
    let ignore = false;
    setLoading(true);
    const url =
      m === "following" ? "/app/api/musicologia/feed" : "/app/api/musicologia/feed/global";
    fetch(url)
      .then(async (r) => {
        if (r.status === 401) {
          setAuthed(false);
          return;
        }
        const d = (await r.json()) as { activities: Activity[] };
        if (!ignore) setActivities(d.activities ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    return load(mode);
  }, [load, mode]);

  const handleTrackNavigate = (trackId: number) => {
    // Look up track slug to navigate properly
    fetch(`/app/api/musicologia/tracks?limit=1&id=${trackId}`)
      .then((r) => r.json())
      .then((d: { tracks?: Array<{ artist_slug?: string; track_slug?: string }> }) => {
        const t = d.tracks?.[0];
        if (t?.artist_slug && t?.track_slug) {
          navigate(`/musicologia/tracks/${t.artist_slug}/${t.track_slug}`);
        }
      })
      .catch(() => {});
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg border border-border p-0.5 gap-0.5">
        <button
          onClick={() => setMode("following")}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${
            mode === "following"
              ? "bg-purple-500/20 text-purple-300"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          Following
        </button>
        <button
          onClick={() => setMode("global")}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${
            mode === "global"
              ? "bg-purple-500/20 text-purple-300"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Globe className="h-3.5 w-3.5" />
          Global
        </button>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => load(mode)}
        className="cursor-pointer h-7 w-7 p-0"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  return (
    <AppLayout
      icon={<Radio size={20} />}
      iconClassName="bg-purple-500/10 text-purple-500"
      title="Activity Feed"
      subtitle={loading ? "Loading…" : `${activities.length} activities`}
      actions={headerActions}
    >
      <div className="h-full overflow-y-auto p-6">
        {!authed && mode === "following" ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <Radio className="h-10 w-10 opacity-20" />
            <p className="text-sm">Sign in to see your following feed</p>
            <Button size="sm" variant="outline" onClick={() => setMode("global")}>
              Switch to Global
            </Button>
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-3 p-4 rounded-xl border border-border animate-pulse">
                <div className="w-9 h-9 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <Radio className="h-10 w-10 opacity-20" />
            <p className="text-sm">
              {mode === "following"
                ? "Nothing yet from people you follow"
                : "No activity yet — start reacting and commenting!"}
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-w-2xl">
            {activities.map((a) => (
              <ActivityCard key={a.id} activity={a} onNavigate={handleTrackNavigate} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
