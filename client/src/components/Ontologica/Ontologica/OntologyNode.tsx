import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, CircleDot, ChevronRight, ChevronDown, Layers } from 'lucide-react';

interface NodeData {
  label: string;
  description?: string;
  nodeType: 'class' | 'individual';
  status: 'suggested' | 'approved' | 'rejected';
  confidence: number;
  hasChildren: boolean;
  isExpanded: boolean;
  childCount: number;
  onToggle: () => void;
  layerName?: string;
  layerAbbr?: string;
  [key: string]: unknown;
}

/** Abbreviate layer names: "Schema.org" → "S.o", "Dublin Core" → "DC", short names stay as-is */
export function abbreviateLayerName(name: string): string {
  if (name.length <= 5) return name;
  const words = name.split(/[\s.]+/);
  if (words.length === 1) return name.slice(0, 4);
  return words.map(w => w[0]?.toUpperCase() ?? '').join('');
}

export const OntologyNode = memo(function OntologyNode({ data }: NodeProps) {
  const d = data as NodeData;
  const isClass = d.nodeType === 'class';
  const isBaseLayer = !!d.layerName;

  const borderColor = d.status === 'approved'
    ? 'border-emerald-500/50'
    : d.status === 'rejected'
      ? 'border-red-500/50'
      : isClass
        ? 'border-emerald-500/25'
        : 'border-violet-500/25';

  const bg = isClass ? 'bg-emerald-950/50' : 'bg-violet-950/50';
  const iconColor = isClass ? 'text-emerald-400' : 'text-violet-400';

  return (
    <div
      className={`rounded-md border ${borderColor} ${bg} shadow-md transition-all hover:shadow-lg hover:brightness-110`}
      style={{
        opacity: d.status === 'rejected' ? 0.35 : isBaseLayer ? 0.85 : 1,
        borderStyle: isBaseLayer ? 'dashed' : 'solid',
        minWidth: 140,
        maxWidth: 200,
      }}
      title={isBaseLayer ? `Base layer: ${d.layerName}` : undefined}
    >
      <Handle type="target" position={Position.Top} className="!bg-emerald-500/60 !w-1.5 !h-1.5 !border-0" />

      <div className="px-2.5 py-1.5">
        {/* Header row */}
        <div className="flex items-center gap-1.5">
          {isClass
            ? <Box size={11} className={`${iconColor} shrink-0`} />
            : <CircleDot size={11} className={`${iconColor} shrink-0`} />
          }
          <span className="text-[11px] font-semibold truncate flex-1 leading-tight">
            {d.label}
          </span>

          {/* Layer badge */}
          {isBaseLayer && (
            <span className="shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded bg-cyan-500/15 text-cyan-400 text-[8px] font-medium leading-none"
              title={d.layerName}
            >
              <Layers size={7} />
              {d.layerAbbr || abbreviateLayerName(d.layerName!)}
            </span>
          )}

          {/* Expand/collapse toggle */}
          {d.hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); d.onToggle(); }}
              className="shrink-0 p-0.5 rounded hover:bg-white/10 cursor-pointer transition-colors"
            >
              {d.isExpanded
                ? <ChevronDown size={12} className="text-muted-foreground" />
                : <ChevronRight size={12} className="text-muted-foreground" />
              }
            </button>
          )}
        </div>

        {/* Child count badge when collapsed */}
        {d.hasChildren && !d.isExpanded && (
          <div className="mt-1 flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground/70 bg-white/5 rounded px-1.5 py-0.5">
              {d.childCount} {d.childCount === 1 ? 'child' : 'children'}
            </span>
          </div>
        )}

        {/* Confidence bar */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex-1 h-[2px] bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${isClass ? 'bg-emerald-500/60' : 'bg-violet-500/60'}`}
              style={{ width: `${d.confidence * 100}%` }}
            />
          </div>
          <span className="text-[8px] text-muted-foreground/50 tabular-nums">
            {Math.round(d.confidence * 100)}%
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500/60 !w-1.5 !h-1.5 !border-0" />
    </div>
  );
});
