import { Globe2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarbleWorld } from "../types";

interface GeneratingPanelProps {
  world: MarbleWorld;
  onCheckNow: () => void;
}

export function GeneratingPanel({ world, onCheckNow }: GeneratingPanelProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
      <div className="relative">
        <div className="h-20 w-20 rounded-full bg-green-500/10 flex items-center justify-center">
          <Globe2 className="h-9 w-9 text-green-500/60" />
        </div>
        <div className="absolute -inset-1.5 border-2 border-green-500/20 border-t-green-500 rounded-full animate-spin" />
      </div>
      <div className="text-center">
        <p className="font-semibold text-base">Generating "{world.name}"</p>
        <p className="text-sm text-muted-foreground mt-1.5">
          World Labs Marble is building your 3D world.
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          This usually takes 1–3 minutes · Checking every 5s
        </p>
      </div>
      <div className="max-w-md text-center">
        <p className="text-xs text-muted-foreground/50 italic leading-relaxed line-clamp-3">
          "{world.prompt}"
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 cursor-pointer text-muted-foreground"
        onClick={onCheckNow}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Check now
      </Button>
    </div>
  );
}
