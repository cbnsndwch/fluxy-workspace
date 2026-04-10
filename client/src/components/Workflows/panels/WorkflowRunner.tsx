import {
  CheckCircle2,
  XCircle,
  Loader2,
  Minus,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowRun, WorkflowRunNode, RunNodeStatus } from "../types";
import { useCallback, useRef, useState } from "react";

interface Props {
  run: WorkflowRun | null;
  nodes: WorkflowRunNode[];
  isRunning: boolean;
}

function StatusIcon({ status }: { status: RunNodeStatus | "running" | "success" | "error" }) {
  if (status === "running")
    return <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />;
  if (status === "success") return <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />;
  if (status === "error") return <XCircle size={13} className="text-red-400 shrink-0" />;
  if (status === "skipped") return <Minus size={13} className="text-muted-foreground shrink-0" />;
  return <div className="w-3 h-3 rounded-full border border-border shrink-0" />;
}

function NodeRow({ node }: { node: WorkflowRunNode }) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = node.output && node.output !== "null";
  const hasError = !!node.error;

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        onClick={() => (hasOutput || hasError) && setExpanded((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
          hasOutput || hasError ? "hover:bg-accent/30 cursor-pointer" : "cursor-default",
        )}
      >
        <StatusIcon status={node.status} />
        <span className="text-xs text-foreground flex-1 truncate font-mono">
          {node.node_id.slice(0, 8)}…
        </span>
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded font-medium",
            node.node_type === "trigger" && "bg-emerald-500/10 text-emerald-400",
            node.node_type === "http_request" && "bg-blue-500/10 text-blue-400",
            node.node_type === "code" && "bg-amber-500/10 text-amber-400",
            node.node_type === "condition" && "bg-violet-500/10 text-violet-400",
            node.node_type === "log" && "bg-slate-500/10 text-slate-400",
          )}
        >
          {node.node_type.replace("_", " ")}
        </span>
        {node.duration_ms != null && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
            <Clock size={9} />
            {node.duration_ms}ms
          </span>
        )}
        {(hasOutput || hasError) &&
          (expanded ? (
            <ChevronDown size={12} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-muted-foreground shrink-0" />
          ))}
      </button>
      {expanded && (
        <div className="px-3 pb-2">
          {hasError && (
            <pre className="text-[10px] text-red-400 bg-red-500/10 rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {node.error}
            </pre>
          )}
          {hasOutput && !hasError && (
            <pre className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-48">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(node.output!), null, 2);
                } catch {
                  return node.output;
                }
              })()}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 600;

export default function WorkflowRunner({ run, nodes, isRunning }: Props) {
  const runStatus = isRunning ? "running" : (run?.status ?? "pending");
  const [height, setHeight] = useState(220);
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef<number>(220);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartY.current = e.clientY;
      dragStartH.current = height;

      const onMove = (ev: MouseEvent) => {
        const delta = dragStartY.current! - ev.clientY;
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragStartH.current + delta)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height],
  );

  return (
    <div className="border-t border-border bg-card/80 flex flex-col shrink-0" style={{ height }}>
      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="h-1.5 w-full cursor-row-resize shrink-0 flex items-center justify-center group"
      >
        <div className="w-8 h-0.5 rounded-full bg-border group-hover:bg-muted-foreground/40 transition-colors" />
      </div>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <StatusIcon status={runStatus as RunNodeStatus} />
        <span className="text-xs font-semibold text-foreground">
          {isRunning ? "Running…" : run ? `Run #${run.id} — ${run.status}` : "Last run"}
        </span>
        {run?.finished_at && (
          <span className="text-[10px] text-muted-foreground/60 ml-auto">
            {new Date(run.finished_at).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Node rows */}
      <div className="flex-1 overflow-y-auto">
        {nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground/40 italic">
            No run yet
          </div>
        ) : (
          nodes.map((n) => <NodeRow key={n.node_id} node={n} />)
        )}
      </div>
    </div>
  );
}
