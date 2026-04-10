import { Play, Globe, Code2, GitBranch, Terminal, Clock, Zap, Database } from "lucide-react";
import { NODE_REGISTRY, NODE_ORDER } from "../nodeRegistry";
import { cn } from "@/lib/utils";

const ICONS = { Play, Globe, Code2, GitBranch, Terminal, Clock, Zap, Database };

export default function NodePalette() {
  return (
    <div className="w-[200px] shrink-0 border-r border-border bg-card/50 flex flex-col overflow-y-auto">
      <div className="px-3 py-3 border-b border-border">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Nodes
        </p>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">Drag onto canvas</p>
      </div>
      <div className="p-2 space-y-1.5 flex-1">
        {NODE_ORDER.map((type) => {
          const meta = NODE_REGISTRY[type];
          const Icon = ICONS[meta.icon as keyof typeof ICONS];
          return (
            <div
              key={type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("workflow/nodeType", type);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-grab active:cursor-grabbing",
                "bg-card hover:bg-accent/50 transition-colors select-none",
                meta.border,
              )}
            >
              <div className={cn("shrink-0 p-1 rounded", meta.bg, meta.color)}>
                <Icon size={12} strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground leading-tight">{meta.label}</p>
                <p className="text-[10px] text-muted-foreground/60 leading-tight truncate">
                  {meta.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
