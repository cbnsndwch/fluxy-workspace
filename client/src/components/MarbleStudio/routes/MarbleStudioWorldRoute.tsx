import { useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import Viewer from "../WorldViewerExperimental";
import { useMarbleContext } from "../context";
import { GeneratingPanel } from "../components/GeneratingPanel";
import { WelcomePanel } from "../components/WelcomePanel";
import { MarbleWorld } from "../types";

export function MarbleStudioWorldRoute() {
  const { worldId } = useParams<{ worldId: string }>();
  const { worlds, onDelete, updateWorld } = useMarbleContext();
  const navigate = useNavigate();
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const id = parseInt(worldId ?? "0");
  const world = worlds.find((w) => w.id === id) ?? null;

  const doPoll = useCallback(async () => {
    if (!world) return;
    try {
      const res = await fetch(`/app/api/marble-studio/worlds/${world.id}/poll`);
      if (!res.ok) return;
      const updated = (await res.json()) as MarbleWorld;
      updateWorld(updated);
      if (updated.status === "done" || updated.status === "error") {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }
    } catch {
      /* ignore */
    }
  }, [world, updateWorld]);

  // Polling — runs while the selected world is still generating
  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (world && (world.status === "generating" || world.status === "pending")) {
      pollTimerRef.current = setInterval(doPoll, 5000);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [world?.id, world?.status, doPoll]);

  if (!world) {
    return <WelcomePanel onNew={() => navigate("/marble-studio/new")} />;
  }

  if (world.status === "generating" || world.status === "pending") {
    return <GeneratingPanel world={world} onCheckNow={doPoll} />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Viewer world={world} onDelete={() => onDelete(world.id)} />
    </div>
  );
}
