import { useState, useEffect, useCallback } from "react";
import { Outlet, useNavigate, useLocation, useMatch } from "react-router";
import { Globe2, Plus, Settings, CloudDownload, Loader2 } from "lucide-react";

import { AppLayout } from "@/components/ui/app-layout";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAppTracking } from "@/components/Analytics/AnalyticsProvider";

// Types and hooks
import { MarbleWorld, ApiKeyStatus, MarbleStudioContext } from "./types";
import { useMarbleContext } from "./context";

export { useMarbleContext };
export type { MarbleStudioContext };

// Export individual routes for lazy loading
export { MarbleStudioIndexRoute } from "./routes/MarbleStudioIndexRoute";
export { MarbleStudioNewRoute } from "./routes/MarbleStudioNewRoute";
export { MarbleStudioSettingsRoute } from "./routes/MarbleStudioSettingsRoute";
export { MarbleStudioWorldRoute } from "./routes/MarbleStudioWorldRoute";

export default function MarbleStudioPage() {
  const { trackPageView, trackAction: track } = useAppTracking("marble-studio");
  const navigate = useNavigate();
  const location = useLocation();
  const worldMatch = useMatch("/marble-studio/worlds/:worldId");

  const [worlds, setWorlds] = useState<MarbleWorld[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({
    hasKey: false,
    keyHint: null,
  });

  // Derive active state from URL
  const isSettings = location.pathname === "/marble-studio/settings";
  const selectedWorldId = worldMatch ? parseInt(worldMatch.params.worldId!) : null;

  const loadApiKeyStatus = useCallback(async () => {
    const res = await fetch("/app/api/marble-studio/settings").catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as ApiKeyStatus;
      setApiKeyStatus(data);
    }
  }, []);

  const loadWorlds = useCallback(async () => {
    try {
      const res = await fetch("/app/api/marble-studio/worlds");
      if (res.ok) {
        const data = (await res.json()) as MarbleWorld[];
        setWorlds(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    trackPageView();
  }, [trackPageView]);

  useEffect(() => {
    loadWorlds();
  }, [loadWorlds]);

  useEffect(() => {
    loadApiKeyStatus();
  }, [loadApiKeyStatus]);

  const updateWorld = useCallback((updated: MarbleWorld) => {
    setWorlds((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  }, []);

  const handleGenerated = useCallback(
    (world: MarbleWorld) => {
      setWorlds((prev) => [world, ...prev]);
      navigate(`/marble-studio/worlds/${world.id}`);
      track("generate", {
        model: world.model,
        promptType: world.prompt_type,
      });
    },
    [navigate, track],
  );

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/app/api/marble-studio/worlds/sync", {
        method: "POST",
      });
      const data = (await res.json()) as {
        synced?: number;
        worlds?: MarbleWorld[];
        error?: string;
      };
      if (!res.ok) {
        setSyncMsg({
          text: data.error || `Sync failed (${res.status})`,
          ok: false,
        });
        setTimeout(() => setSyncMsg(null), 5000);
        return;
      }
      const synced = data.synced ?? 0;
      if (synced > 0 && data.worlds) {
        // Merge: update any existing records, prepend new ones
        setWorlds((prev) => {
          const updated = [...prev];
          for (const w of data.worlds!) {
            const idx = updated.findIndex((x) => x.id === w.id);
            if (idx >= 0) {
              updated[idx] = w;
            } else {
              updated.unshift(w);
            }
          }
          return updated;
        });
      }
      setSyncMsg({
        text:
          synced > 0 ? `Synced ${synced} world${synced !== 1 ? "s" : ""}` : "Already up to date",
        ok: true,
      });
      setTimeout(() => setSyncMsg(null), 3000);
    } catch (e) {
      setSyncMsg({
        text: e instanceof Error ? e.message : "Network error",
        ok: false,
      });
      setTimeout(() => setSyncMsg(null), 5000);
    } finally {
      setSyncing(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (id: number) => {
      await fetch(`/app/api/marble-studio/worlds/${id}`, {
        method: "DELETE",
      });
      setWorlds((prev) => {
        const remaining = prev.filter((w) => w.id !== id);
        if (selectedWorldId === id) {
          if (remaining.length > 0) {
            navigate(`/marble-studio/worlds/${remaining[0].id}`, {
              replace: true,
            });
          } else {
            navigate("/marble-studio", { replace: true });
          }
        }
        return remaining;
      });
    },
    [navigate, selectedWorldId],
  );

  const outletContext: MarbleStudioContext = {
    worlds,
    loading,
    apiKeyStatus,
    onGenerated: handleGenerated,
    onDelete: handleDelete,
    onApiKeySaved: loadApiKeyStatus,
    updateWorld,
    onSync: handleSync,
  };

  return (
    <AppLayout
      icon={<Globe2 size={18} />}
      iconClassName="bg-green-500/10 text-green-500"
      title="Marble Studio"
      subtitle="Generate immersive 3D worlds with World Labs Marble"
      actions={
        <div className="flex items-center gap-1.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 cursor-pointer"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CloudDownload className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sync from World Labs</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8 cursor-pointer relative", isSettings && "bg-muted")}
                  onClick={() => navigate("/marble-studio/settings")}
                >
                  <Settings className="h-4 w-4" />
                  {!apiKeyStatus.hasKey && (
                    <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {!apiKeyStatus.hasKey ? "Settings — API key not configured" : "Settings"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            size="sm"
            className="gap-1.5 cursor-pointer"
            onClick={() => navigate("/marble-studio/new")}
          >
            <Plus className="h-3.5 w-3.5" />
            New World
          </Button>
        </div>
      }
    >
      <div className="flex flex-col h-full overflow-hidden">
        {/* Sync status banner */}
        {syncMsg && (
          <div
            className={cn(
              "px-4 py-1.5 text-xs text-center shrink-0",
              syncMsg.ok ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-500",
            )}
          >
            {syncMsg.text}
          </div>
        )}
        {/* Main content — child routes render here */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Outlet context={outletContext} />
        </div>
      </div>
    </AppLayout>
  );
}
