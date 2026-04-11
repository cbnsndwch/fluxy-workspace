import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { useProjectContext } from './context';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Search, X, Filter, ZoomIn, ZoomOut, Maximize2,
  Box, CircleDot, ArrowRight, Database, Link2, Info,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────

interface GraphNode {
  id: number;
  name: string;
  node_type: 'class' | 'individual';
  description?: string;
  parent_id: number | null;
  confidence: number;
  status: string;
  layer_id?: number | null;
  base_item_uri?: string | null;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | undefined;
  fy?: number | undefined;
  __category?: string;
  __isBaseLayer?: boolean;
  __layerName?: string;
}

interface GraphLink {
  source: number | GraphNode;
  target: number | GraphNode;
  edge_type: string;
  name: string;
  confidence: number;
}

// ── Color palette ────────────────────────────────────────

const PALETTE = [
  '#10b981', '#8b5cf6', '#3b82f6', '#f59e0b', '#f43f5e',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#6366f1',
  '#84cc16', '#a855f7',
];

const EDGE_COLORS: Record<string, string> = {
  is_a: '#4b5563',
  object_property: '#8b5cf6',
  data_property: '#f59e0b',
};

// ── Helpers ──────────────────────────────────────────────

function findRootCategory(nodeId: number, nodeMap: Map<number, any>): string {
  const visited = new Set<number>();
  let current = nodeMap.get(nodeId);
  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    if (!current.parent_id || !nodeMap.has(current.parent_id)) {
      return current.name;
    }
    current = nodeMap.get(current.parent_id);
  }
  return 'Uncategorized';
}

// Stable category→color mapping rebuilt per data change
function buildCategoryColorMap(nodes: any[], nodeMap: Map<number, any>): Map<string, string> {
  const cats = new Set<string>();
  for (const n of nodes) cats.add(findRootCategory(n.id, nodeMap));
  const map = new Map<string, string>();
  let i = 0;
  for (const c of cats) {
    map.set(c, PALETTE[i % PALETTE.length]);
    i++;
  }
  return map;
}

// ── Component ────────────────────────────────────────────

export function ForceGraphTab() {
  const { nodes: rawNodes, edges: rawEdges, layers } = useProjectContext();
  const graphRef = useRef<ForceGraphMethods | undefined>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<number>>(new Set());
  const [highlightedLinks, setHighlightedLinks] = useState<Set<string>>(new Set());
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'class' | 'individual'>('all');
  const [minConfidence, setMinConfidence] = useState(0);
  const [filterEdgeTypes, setFilterEdgeTypes] = useState<Set<string>>(new Set(['is_a', 'object_property', 'data_property']));

  // Legend
  const [showLegend, setShowLegend] = useState(false);

  // Lazy-load expansion
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);

  // ── Dimensions ─────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        setDimensions({ width: e.contentRect.width, height: e.contentRect.height });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Node map ───────────────────────────────────────────
  const nodeMap = useMemo(() => {
    const m = new Map<number, any>();
    for (const n of rawNodes) m.set(n.id, n);
    return m;
  }, [rawNodes]);

  // ── Category color map ─────────────────────────────────
  const catColors = useMemo(() => buildCategoryColorMap(rawNodes, nodeMap), [rawNodes, nodeMap]);

  // ── Layer map (layer_id → name) ───────────────────────
  const layerMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of (layers || [])) {
      if (l.layer_id && l.name) m.set(l.layer_id, l.name);
      if (l.id && l.name) m.set(l.id, l.name);
    }
    return m;
  }, [layers]);

  // Set of base layer node IDs for quick lookup
  const baseLayerNodeIds = useMemo(() => {
    const s = new Set<number>();
    for (const n of rawNodes) {
      if (n.layer_id && layerMap.has(n.layer_id)) s.add(n.id);
    }
    return s;
  }, [rawNodes, layerMap]);

  // ── Build graph data ───────────────────────────────────
  const graphData = useMemo(() => {
    // Root nodes
    const rootIds = new Set<number>();
    for (const n of rawNodes) {
      if (!n.parent_id || !nodeMap.has(n.parent_id)) rootIds.add(n.id);
    }

    // Visible node IDs (lazy loading for large graphs)
    let visibleIds: Set<number>;
    if (showAll || rawNodes.length <= 50) {
      visibleIds = new Set(rawNodes.map((n: any) => n.id));
    } else {
      visibleIds = new Set(rootIds);
      for (const nid of expandedNodes) {
        visibleIds.add(nid);
        for (const n of rawNodes) {
          if (n.parent_id === nid) visibleIds.add(n.id);
        }
        for (const e of rawEdges) {
          if (e.source_node_id === nid) visibleIds.add(e.target_node_id);
          if (e.target_node_id === nid) visibleIds.add(e.source_node_id);
        }
      }
    }

    // Apply filters
    const filteredNodes = rawNodes.filter((n: any) => {
      if (!visibleIds.has(n.id)) return false;
      if (filterType !== 'all' && n.node_type !== filterType) return false;
      if (n.confidence < minConfidence) return false;
      return true;
    });

    const filteredNodeIds = new Set(filteredNodes.map((n: any) => n.id));

    const nodes: GraphNode[] = filteredNodes.map((n: any) => ({
      ...n,
      __category: findRootCategory(n.id, nodeMap),
      __isBaseLayer: !!n.layer_id && layerMap.has(n.layer_id),
      __layerName: n.layer_id ? layerMap.get(n.layer_id) : undefined,
    }));

    const links: GraphLink[] = rawEdges
      .filter((e: any) =>
        filteredNodeIds.has(e.source_node_id) &&
        filteredNodeIds.has(e.target_node_id) &&
        filterEdgeTypes.has(e.edge_type)
      )
      .map((e: any) => ({
        source: e.source_node_id,
        target: e.target_node_id,
        edge_type: e.edge_type,
        name: e.name || e.edge_type,
        confidence: e.confidence,
      }));

    return { nodes, links };
  }, [rawNodes, rawEdges, nodeMap, filterType, minConfidence, filterEdgeTypes, expandedNodes, showAll, layerMap]);

  // ── Search ─────────────────────────────────────────────
  const handleSearch = useCallback((query: string) => {
    setSearch(query);
    if (!query.trim()) {
      setHighlightedNodes(new Set());
      setHighlightedLinks(new Set());
      return;
    }
    const q = query.toLowerCase();
    const matched = new Set<number>();
    const matchedLinks = new Set<string>();

    for (const n of graphData.nodes) {
      if (n.name.toLowerCase().includes(q) || n.description?.toLowerCase().includes(q)) {
        matched.add(n.id);
      }
    }

    for (const l of graphData.links) {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      if (matched.has(sid) || matched.has(tid)) {
        matchedLinks.add(`${sid}-${tid}`);
      }
    }

    setHighlightedNodes(matched);
    setHighlightedLinks(matchedLinks);

    // Center on first match
    if (matched.size > 0 && graphRef.current) {
      const firstId = matched.values().next().value;
      const node = graphData.nodes.find(n => n.id === firstId);
      if (node?.x !== undefined && node?.y !== undefined) {
        graphRef.current.centerAt(node.x, node.y, 500);
        graphRef.current.zoom(3, 500);
      }
    }
  }, [graphData]);

  // ── Node click → expand + highlight neighborhood ───────
  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node);

    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });

    const neighborIds = new Set<number>([node.id]);
    const neighborLinks = new Set<string>();
    for (const l of graphData.links) {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      if (sid === node.id) { neighborIds.add(tid); neighborLinks.add(`${sid}-${tid}`); }
      if (tid === node.id) { neighborIds.add(sid); neighborLinks.add(`${sid}-${tid}`); }
    }
    setHighlightedNodes(neighborIds);
    setHighlightedLinks(neighborLinks);
  }, [graphData]);

  // ── Node hover ─────────────────────────────────────────
  const handleNodeHover = useCallback((node: any) => {
    setHoverNode(node || null);
    if (!node) return;
    const neighborIds = new Set<number>([node.id]);
    const neighborLinks = new Set<string>();
    for (const l of graphData.links) {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      if (sid === node.id) { neighborIds.add(tid); neighborLinks.add(`${sid}-${tid}`); }
      if (tid === node.id) { neighborIds.add(sid); neighborLinks.add(`${sid}-${tid}`); }
    }
    setHighlightedNodes(neighborIds);
    setHighlightedLinks(neighborLinks);
  }, [graphData]);

  // ── Canvas node painting ───────────────────────────────
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const isHighlighted = highlightedNodes.size === 0 || highlightedNodes.has(node.id);
    const isSelected = selectedNode?.id === node.id;
    const isBaseLayer = !!node.__isBaseLayer;
    const alpha = isHighlighted ? (isBaseLayer ? 0.7 : 1) : 0.15;
    const size = node.node_type === 'class' ? 6 : 4;
    const color = isBaseLayer ? '#06b6d4' : (catColors.get(node.__category || 'Uncategorized') || '#6b7280');

    const x = node.x ?? 0;
    const y = node.y ?? 0;

    // Glow for selected
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, size + 4, 0, 2 * Math.PI);
      ctx.fillStyle = `${color}44`;
      ctx.fill();
    }

    if (isBaseLayer) {
      // Diamond shape for base layer nodes
      const s = size * 1.1;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      ctx.fillStyle = isHighlighted ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : `${color}26`;
      ctx.fill();

      // Dashed border
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = isHighlighted ? color : `${color}44`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // Normal circle node
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = isHighlighted ? color : `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
      ctx.fill();

      // Border for classes
      if (node.node_type === 'class') {
        ctx.strokeStyle = isHighlighted ? '#fff' : '#ffffff22';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Label
    if (globalScale > 1.5 || isSelected || (hoverNode?.id === node.id)) {
      const label = node.name;
      const fontSize = Math.max(10 / globalScale, 2);
      ctx.font = `${isSelected ? 'bold ' : ''}${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isHighlighted ? (isBaseLayer ? '#a5f3fc' : '#e5e7eb') : '#6b728066';
      ctx.fillText(label, x, y + size + 2);

      // Layer name sub-label
      if (isBaseLayer && node.__layerName && (isSelected || hoverNode?.id === node.id)) {
        const subFontSize = Math.max(8 / globalScale, 1.5);
        ctx.font = `${subFontSize}px Inter, sans-serif`;
        ctx.fillStyle = '#06b6d488';
        ctx.fillText(node.__layerName, x, y + size + 2 + fontSize + 1);
      }
    }
  }, [highlightedNodes, selectedNode, hoverNode, catColors]);

  // ── Link painting ──────────────────────────────────────
  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const sid = typeof link.source === 'object' ? link.source.id : link.source;
    const tid = typeof link.target === 'object' ? link.target.id : link.target;
    const key = `${sid}-${tid}`;
    const isHighlighted = highlightedLinks.size === 0 || highlightedLinks.has(key);
    const alpha = isHighlighted ? 0.6 : 0.08;
    const connectsBaseLayer = baseLayerNodeIds.has(sid) || baseLayerNodeIds.has(tid);

    const sx = link.source.x ?? 0;
    const sy = link.source.y ?? 0;
    const tx = link.target.x ?? 0;
    const ty = link.target.y ?? 0;

    // Dashed line for edges connecting to base layer nodes
    if (connectsBaseLayer) ctx.setLineDash([4, 3]);

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = connectsBaseLayer
      ? `#06b6d4${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
      : `${EDGE_COLORS[link.edge_type] || '#6b7280'}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
    ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
    ctx.stroke();

    if (connectsBaseLayer) ctx.setLineDash([]);

    // Arrow at midpoint
    if (isHighlighted) {
      const angle = Math.atan2(ty - sy, tx - sx);
      const arrowLen = 4;
      const midX = (sx + tx) / 2;
      const midY = (sy + ty) / 2;
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(midX - arrowLen * Math.cos(angle - Math.PI / 6), midY - arrowLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(midX, midY);
      ctx.lineTo(midX - arrowLen * Math.cos(angle + Math.PI / 6), midY - arrowLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }

    // Edge label at high zoom
    if (globalScale > 2.5 && isHighlighted && link.name && link.name !== link.edge_type) {
      const fontSize = Math.max(8 / globalScale, 1.5);
      ctx.font = `${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#9ca3af88';
      ctx.fillText(link.name, (sx + tx) / 2, (sy + ty) / 2 - 3);
    }
  }, [highlightedLinks, baseLayerNodeIds]);

  // ── Edge type toggle ───────────────────────────────────
  const toggleEdgeType = (type: string) => {
    setFilterEdgeTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // ── Detail edges ───────────────────────────────────────
  const detailEdges = useMemo(() => {
    if (!selectedNode) return [];
    return rawEdges.filter((e: any) =>
      e.edge_type !== 'is_a' &&
      (e.source_node_id === selectedNode.id || e.target_node_id === selectedNode.id)
    );
  }, [selectedNode, rawEdges]);

  // ── Empty state ────────────────────────────────────────
  if (rawNodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <Box size={32} className="mx-auto text-emerald-500/40" />
          <p className="text-lg font-medium">No concepts yet</p>
          <p className="text-sm">Upload documents and run extraction to build the graph</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex overflow-hidden">
      {/* Main canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-background/80 backdrop-blur-sm">
          <div className="relative w-52">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search & focus node..."
              className="h-8 pl-8 text-xs"
            />
            {search && (
              <button onClick={() => handleSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer">
                <X size={12} />
              </button>
            )}
          </div>

          <Button variant={showFilters ? 'secondary' : 'ghost'} size="sm" className="h-8 px-2" onClick={() => setShowFilters(!showFilters)}>
            <Filter size={14} />
          </Button>

          <Button variant={showLegend ? 'secondary' : 'ghost'} size="sm" className="h-8 px-2" onClick={() => setShowLegend(!showLegend)} title="Toggle legend">
            <Info size={14} />
          </Button>

          <Separator orientation="vertical" className="h-5" />

          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => graphRef.current?.zoom((graphRef.current.zoom?.() ?? 1) * 1.5, 300)}>
            <ZoomIn size={14} />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => graphRef.current?.zoom((graphRef.current.zoom?.() ?? 1) * 0.67, 300)}>
            <ZoomOut size={14} />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => graphRef.current?.zoomToFit(400, 40)}>
            <Maximize2 size={14} />
          </Button>

          <div className="flex-1" />

          {rawNodes.length > 50 && (
            <Button variant={showAll ? 'secondary' : 'outline'} size="sm" className="h-7 text-[11px] px-2" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Collapse' : `Show All (${rawNodes.length})`}
            </Button>
          )}

          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>{graphData.nodes.length} nodes</span>
            <span>{graphData.links.length} edges</span>
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border/30 bg-muted/30">
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground">Type:</span>
              {(['all', 'class', 'individual'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
                    filterType === t ? 'bg-emerald-500/20 text-emerald-400' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'all' ? 'All' : t === 'class' ? 'Classes' : 'Instances'}
                </button>
              ))}
            </div>

            <Separator orientation="vertical" className="h-4" />

            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground">Edges:</span>
              {['is_a', 'object_property', 'data_property'].map(t => (
                <button
                  key={t}
                  onClick={() => toggleEdgeType(t)}
                  className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
                    filterEdgeTypes.has(t) ? 'bg-violet-500/20 text-violet-400' : 'text-muted-foreground/50 line-through'
                  }`}
                >
                  {t.replace('_', ' ')}
                </button>
              ))}
            </div>

            <Separator orientation="vertical" className="h-4" />

            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground">Min confidence:</span>
              <input
                type="range"
                min={0}
                max={100}
                value={minConfidence * 100}
                onChange={e => setMinConfidence(Number(e.target.value) / 100)}
                className="w-20 h-1 accent-emerald-500"
              />
              <span className="text-muted-foreground tabular-nums w-8">{Math.round(minConfidence * 100)}%</span>
            </div>
          </div>
        )}

        {/* Force graph canvas */}
        <div ref={containerRef} className="flex-1 min-h-0 bg-background relative">
          {/* Legend overlay */}
          {showLegend && (
            <div className="absolute bottom-3 left-3 z-10 bg-background/90 backdrop-blur-sm border border-border/40 rounded-md px-3 py-2 space-y-1.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Legend</span>
              <div className="flex items-center gap-2 text-[10px] text-foreground/70">
                <span className="inline-block w-3 h-3 rounded-full bg-emerald-500 border border-white/30" />
                <span>Project node (solid circle)</span>
              </div>
              {baseLayerNodeIds.size > 0 && (
                <div className="flex items-center gap-2 text-[10px] text-cyan-400/80">
                  <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
                    <polygon points="6,1 11,6 6,11 1,6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1.5" />
                  </svg>
                  <span>Base layer node (dashed ◇)</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-[10px] text-foreground/70">
                <span className="inline-block w-5 border-t border-foreground/50" />
                <span>Solid edge — project relationships</span>
              </div>
              {baseLayerNodeIds.size > 0 && (
                <div className="flex items-center gap-2 text-[10px] text-cyan-400/80">
                  <span className="inline-block w-5 border-t border-dashed border-cyan-400/60" />
                  <span>Dashed edge — connects to base layer</span>
                </div>
              )}
              {/* Active layers list */}
              {layerMap.size > 0 && (
                <>
                  <div className="border-t border-border/30 pt-1.5 mt-1">
                    <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Active Layers</span>
                  </div>
                  {Array.from(new Set(layerMap.values())).map(name => (
                    <div key={name} className="flex items-center gap-2 text-[10px] text-cyan-400/70">
                      <span className="inline-block w-2 h-2 rounded-sm bg-cyan-500/40 border border-cyan-500/60" />
                      <span>{name}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          <ForceGraph2D
            ref={graphRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeId="id"
            nodeCanvasObject={paintNode}
            linkCanvasObject={paintLink}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            onBackgroundClick={() => {
              setSelectedNode(null);
              setHighlightedNodes(new Set());
              setHighlightedLinks(new Set());
            }}
            cooldownTicks={100}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            enableNodeDrag={true}
            enableZoomInteraction={true}
            enablePanInteraction={true}
            warmupTicks={50}
            nodeRelSize={6}
          />
        </div>
      </div>

      {/* Detail sidebar */}
      {selectedNode && (
        <div className="w-72 border-l border-border/30 bg-background shrink-0 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
            <span className="text-xs font-medium">Node Details</span>
            <button
              onClick={() => { setSelectedNode(null); setHighlightedNodes(new Set()); setHighlightedLinks(new Set()); }}
              className="text-muted-foreground hover:text-foreground cursor-pointer p-1"
            >
              <X size={12} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                {selectedNode.node_type === 'class'
                  ? <Box size={14} className={selectedNode.__isBaseLayer ? 'text-cyan-400' : 'text-emerald-400'} />
                  : <CircleDot size={14} className={selectedNode.__isBaseLayer ? 'text-cyan-400' : 'text-violet-400'} />
                }
                <h3 className="text-sm font-semibold">{selectedNode.name}</h3>
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Badge variant="outline" className={`text-[9px] ${selectedNode.node_type === 'class' ? 'text-emerald-400 border-emerald-500/30' : 'text-violet-400 border-violet-500/30'}`}>
                  {selectedNode.node_type}
                </Badge>
                <Badge variant="outline" className={`text-[9px] ${selectedNode.status === 'approved' ? 'text-emerald-400 border-emerald-500/30' : 'text-amber-400 border-amber-500/30'}`}>
                  {selectedNode.status}
                </Badge>
                {selectedNode.__isBaseLayer && selectedNode.__layerName && (
                  <Badge variant="outline" className="text-[9px] text-cyan-400 border-cyan-500/30 border-dashed">
                    {selectedNode.__layerName}
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground">{Math.round(selectedNode.confidence * 100)}%</span>
              </div>
            </div>

            {/* Base layer URI */}
            {selectedNode.base_item_uri && (
              <>
                <Separator className="bg-border/30" />
                <div>
                  <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Base Layer URI</h4>
                  <p className="text-[9px] text-cyan-400/80 font-mono break-all">{selectedNode.base_item_uri}</p>
                </div>
              </>
            )}

            {selectedNode.description && (
              <>
                <Separator className="bg-border/30" />
                <p className="text-[11px] text-foreground/70 leading-relaxed">{selectedNode.description}</p>
              </>
            )}

            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: catColors.get(selectedNode.__category || 'Uncategorized') || '#6b7280' }} />
              <span className="text-[11px] text-muted-foreground">{selectedNode.__category}</span>
            </div>

            {detailEdges.length > 0 && (
              <>
                <Separator className="bg-border/30" />
                <div>
                  <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Link2 size={10} /> Relationships ({detailEdges.length})
                  </h4>
                  <div className="space-y-1">
                    {detailEdges.map((e: any) => {
                      const isSource = e.source_node_id === selectedNode.id;
                      const otherId = isSource ? e.target_node_id : e.source_node_id;
                      const other = nodeMap.get(otherId);
                      const isObjProp = e.edge_type === 'object_property';
                      return (
                        <div key={e.id} className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border ${
                          isObjProp ? 'bg-violet-500/5 border-violet-500/10' : 'bg-amber-500/5 border-amber-500/10'
                        }`}>
                          {isObjProp
                            ? <ArrowRight size={9} className="text-violet-400 shrink-0" />
                            : <Database size={9} className="text-amber-400 shrink-0" />
                          }
                          <span className={`font-medium shrink-0 ${isObjProp ? 'text-violet-400' : 'text-amber-400'}`}>
                            {e.name || e.edge_type}
                          </span>
                          <span className="text-foreground/60 truncate">{other?.name || `#${otherId}`}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
