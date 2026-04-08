import { Globe2, Trash2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarbleWorld } from "../types";
import { StatusBadge } from "./StatusBadge";
import { timeAgo } from "../utils";

interface GalleryCardProps {
  world: MarbleWorld;
  onSelect: () => void;
  onDelete: () => void;
}

export function GalleryCard({ world, onSelect, onDelete }: GalleryCardProps) {
  const spzUrls = (() => {
    try {
      return JSON.parse(world.assets_json || "{}")?.splats?.spz_urls || {};
    } catch {
      return {};
    }
  })();
  const hasFullRes = !!spzUrls["full_res"];

  return (
    <>
      <style>{`
                @keyframes gallery-shimmer {
                    0% { background-position: 200% center; }
                    100% { background-position: -200% center; }
                }
            `}</style>
      <div
        className={cn(
          "group cursor-pointer rounded-xl overflow-hidden border border-border/40 hover:border-border/80 transition-all duration-200 bg-card",
          world.status === "done" &&
            "hover:ring-1 hover:ring-lime-500/30 hover:shadow-[0_0_20px_rgba(132,204,22,0.08)]",
        )}
        onClick={onSelect}
      >
        {/* Thumbnail */}
        <div className="relative w-full aspect-video bg-linear-to-br from-green-950/60 via-slate-900 to-emerald-950/40 flex items-center justify-center overflow-hidden">
          {world.status === "generating" || world.status === "pending" ? (
            <div className="absolute inset-0 overflow-hidden">
              {/* Dark base — feels like a world forming in the void */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(135deg, #050508 0%, #0f1a0a 40%, #1a2d0f 60%, #050508 100%)",
                }}
              />
              {/* Sweeping shimmer */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(105deg, transparent 40%, rgba(132,204,22,0.06) 50%, transparent 60%)",
                  backgroundSize: "200% 100%",
                  animation: "gallery-shimmer 2.4s ease-in-out infinite",
                }}
              />
              {/* Pulsing center glow */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="w-16 h-16 rounded-full animate-pulse"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(132,204,22,0.15) 0%, transparent 70%)",
                  }}
                />
              </div>
            </div>
          ) : world.thumbnail_url ? (
            <img
              src={world.thumbnail_url}
              alt={world.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Globe2 className="h-8 w-8 text-green-500/20" />
          )}
          {world.status === "error" && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-400" />
            </div>
          )}
          {/* Quality badge for ready worlds */}
          {world.status === "done" && (
            <div className="absolute bottom-2 left-2">
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/50 text-white/40 tracking-wider">
                {hasFullRes ? "HD" : "500k"}
              </span>
            </div>
          )}
          {/* Hover tint */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
          {/* Delete button */}
          <button
            className="absolute top-2 right-2 h-7 w-7 rounded-md bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-black/80"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete world"
          >
            <Trash2 className="h-3.5 w-3.5 text-white/70" />
          </button>
        </div>

        {/* Info */}
        <div className="px-3 py-2.5">
          <p className="text-sm font-medium truncate leading-tight">{world.name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <StatusBadge status={world.status} />
            <span className="text-[10px] text-muted-foreground ml-auto">
              {timeAgo(world.created_at)}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
