import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { useProjectContext } from './context';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Search, Box, CircleDot, SlidersHorizontal,
  X, ZoomIn, ZoomOut, Maximize2,
  ArrowRight, Database, Link2, Layers,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────

interface ONode {
  id: number;
  name: string;
  node_type: 'class' | 'individual';
  description?: string;
  parent_id: number | null;
  confidence: number;
  status: string;
}

interface OEdge {
  id: number;
  edge_type: string;
  name: string;
  source_node_id: number;
  target_node_id: number;
  target_value?: string;
  description?: string;
  confidence: number;
  status: string;
}

// Force-graph node/link types
interface GraphNode {
  id: number;
  name: string;
  node_type: 'class' | 'individual';
  description?: string;
  confidence: number;
  status: string;
  category?: string; // root ancestor name for coloring
  categoryIdx: number;
  childCount: number;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
}

interface GraphLink {
  source: number;
  target: number;
  edge_type: string;
  name: string;
  confidence: number;
}

// ── Color palette ───────────────────────────────────

const PALETTE = [
  '#10b981', '#8b5cf6', '#3b82f6', '#f59e0b', '#ef4444',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#6366f1',
  '#84cc16', '#d946ef', '#0ea5e9', '#fbbf24', '#a855f7',
];

function nodeColor(n: GraphNode): string {
  if (n.node_type === 'individual') return '#8b5cf6';
  return PALETTE[n.categoryIdx % PALETTE.length];
}

function nodeColorDim(n: GraphNode): string {
  const c = nodeColor(n);
  return c + '40'; // 25% alpha
}

// ── Build graph data ─────────────────────────────────

function buildGraphData(
  nodes: ONode[],
  edges: OEdge[],
  filters: Filters,
): { nodes: GraphNode[]; links: GraphLink[] } {
  // Build parent map for category assignment
  const byId = new Map(nodes.map(n => [n.id, n]));

  // Find root ancestor for each node
  function rootAncestor(n: ONode, visited = new Set<number>()): ONode {
    if (visited.has(n.id)) return n;
    visited.add(n.id);
    if (n.parent_id && byId.has(n.parent_id)) {
      return rootAncestor(byId.get(n.parent_id)!, visited);
    }
    // Check is_a edges
    const isaEdge = edges.find(e => e.edge_type === 'is_a' && e.source_node_id === n.id);
    if (isaEdge && byId.has(isaEdge.target_node_id)) {
      return rootAncestor(byId.get(isaEdge.target_node_id)!, visited);
    }
    return n;
  }

  // Assign category indices
  const categoryMap = new Map<string, number>();
  let categoryIdx = 0;

  // Count children per node
  const childCounts = new Map<number, number>();
  for (const n of nodes) {
    if (n.parent_id) childCounts.set(n.parent_id, (childCounts.get(n.parent_id) ?? 0) + 1);
  }
  for (const e of edges) {
    if (e.edge_type === 'is_a') {
      childCounts.set(e.target_node_id, (childCounts.get(e.target_node_id) ?? 0) + 1);
    }
  }

  // Build graph nodes with filters
  const graphNodes: GraphNode[] = [];
  const nodeIdSet = new Set<number>();

  for (const n of nodes) {
    // Type filter
    if (filters.nodeType !== 'all' && n.node_type !== filters.nodeType) continue;
    // Confidence filter
    if (n.confidence < filters.minConfidence) continue;
    // Category filter
    if (filters.category && filters.category !== 'all') {
      const root = rootAncestor(n);
      if (root.name !== filters.category) continue;
    }

    const root = rootAncestor(n);
    const catName = root.name;
    if (!categoryMap.has(catName)) categoryMap.set(catName, categoryIdx++);

    graphNodes.push({
      id: n.id,
      name: n.name,
      node_type: n.node_type,
      description: n.description,
      confidence: n.confidence,
      status: n.status,
      category: catName,
      categoryIdx: categoryMap.get(catName)!,
      childCount: childCounts.get(n.id) ?? 0,
    });
    nodeIdSet.add(n.id);
  }

  // Build links
  const graphLinks: GraphLink[] = [];
  for (const e of edges) {
    if (!nodeIdSet.has(e.source_node_id) || !nodeIdSet.has(e.target_node_id)) continue;
    if (e.confidence < filters.minConfidence) continue;
    graphLinks.push({
      source: e.source_node_id,
      target: e.target_node_id,
      edge_type: e.edge_type,
      name: e.name,
      confidence: e.confidence,
    });
  }

  return { nodes: graphNodes, links: graphLinks };
}

// ── Filter types ────────────────────────────────────

interface Filters {
  nodeType: 'all' | 'class' | 'individual';
  minConfidence: number;
  category: string; // 'all' or category name
}

// ── Detail Panel ────────────────────────────────────

function DetailPanel({
  node, edges, allNodes, onClose,
}: {
  node: GraphNode;
  edges: OEdge[];
  allNodes: Map<number, GraphNode>;
  onClose: () => void;
}) {
  const isClass = node.node_type === 'class';
  const confPct = Math.round(node.confidence * 100);

  const relationships = edges.filter(
    e => e.edge_type !== 'is_a' && (e.source_node_id === node.id || e.target_node_id === node.id)
  );
  const objectProps = relationships.filter(e => e.edge_type === 'object_property');
  const dataProps = relationships.filter(e => e.edge_type === 'data_property');

  return (
    <div className="w-72 border-l border-border/30 bg-background/95 backdrop-blur-sm flex flex-col shrink-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium truncate">{node.name}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer p-1">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="flex items-center gap-2">
          {isClass
            ? <Box size={14} className="text-emerald-400" />
            : <CircleDot size={14} className="text-violet-400" />
          }
          <Badge variant="outline" className={`text-[10px] ${isClass ? 'text-emerald-400 border-emerald-500/30' : 'text-violet-400 border-violet-500/30'}`}>
            {isClass ? 'Class' : 'Instance'}
          </Badge>
          <Badge variant="outline" className={`text-[10px] ${node.status === 'approved' ? 'text-emerald-400 border-emerald-500/30' : 'text-amber-400 border-amber-500/30'}`}>
            {node.status}
          </Badge>
          <span className="text-[11px] text-muted-foreground ml-auto">{confPct}%</span>
        </div>

        {node.description && (
          <>
            <Separator className="bg-border/30" />
            <p className="text-xs text-foreground/80 leading-relaxed">{node.description}</p>
          </>
        )}

        {node.category && (
          <div className="text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wider text-[10px] font-medium">Category:</span>{' '}
            <span className="text-foreground/70">{node.category}</span>
          </div>
        )}

        {objectProps.length > 0 && (
          <>
            <Separator className="bg-border/30" />
            <div>
              <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <ArrowRight size={10} /> Relationships ({objectProps.length})
              </h4>
              <div className="space-y-1">
                {objectProps.map(e => {
                  const otherId = e.source_node_id === node.id ? e.target_node_id : e.source_node_id;
                  const other = allNodes.get(otherId);
                  return (
                    <div key={e.id} className="flex items-center gap-1.5 text-[11px] bg-violet-500/5 rounded px-2 py-1 border border-violet-500/10">
                      <span className="text-violet-400 font-medium shrink-0">{e.name || 'relates to'}</span>
                      <ArrowRight size={8} className="text-muted-foreground/50 shrink-0" />
                      <span className="truncate text-foreground/80">{other?.name || `#${otherId}`}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {dataProps.length > 0 && (
          <>
            <Separator className="bg-border/30" />
            <div>
              <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Database size={10} /> Properties ({dataProps.length})
              </h4>
              <div className="space-y-1">
                {dataProps.map(e => (
                  <div key={e.id} className="flex items-center justify-between text-[11px] bg-amber-500/5 rounded px-2 py-1 border border-amber-500/10">
                    <span className="text-amber-400 font-medium">{e.name || 'property'}</span>
                    {e.target_value && <span className="text-foreground/60 truncate ml-2">{e.target_value}</span>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Minimap ─────────────────────────────────────────

function Minimap({ graphRef }: { graphRef: React.RefObject<ForceGraphMethods | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const fg = graphRef.current;
    if (!canvas || !fg) return;

    const interval = setInterval(() => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const graphData = (fg as any).graphData?.() as { nodes: GraphNode[] } | undefined;
      if (!graphData?.nodes?.length) return;

      const nodes = graphData.nodes;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (n.x !== undefined && n.y !== undefined) {
          minX = Math.min(minX, n.x);
          minY = Math.min(minY, n.y);
          maxX = Math.max(maxX, n.x);
          maxY = Math.max(maxY, n.y);
        }
      }

      if (minX === Infinity) return;

      const pad = 20;
      const rangeX = maxX - minX + pad * 2;
      const rangeY = maxY - minY + pad * 2;
      const scale = Math.min(canvas.width / rangeX, canvas.height / rangeY);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const n of nodes) {
        if (n.x === undefined || n.y === undefined) continue;
        const x = (n.x - minX + pad) * scale;
        const y = (n.y - minY + pad) * scale;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor(n);
        ctx.fill();
      }
    }, 500);

    return () => clearInterval(interval);
  }, [graphRef]);

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={120}
      className="absolute bottom-3 left-3 rounded-md border border-border/30 bg-background/50 backdrop-blur-sm"
    />
  );
}

// ── Main Component ──────────────────────────────────

export { ForceGraph as ForceGraphTab };

export function ForceGraph() {
  const { nodes: rawNodes, edges: rawEdges } = useProjectContext();
  const graphRef = useRef<ForceGraphMethods | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [filters, setFilters] = useState<Filters>({
    nodeType: 'all',
    minConfidence: 0,
    category: 'all',
  });

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build graph data
  const graphData = useMemo(
    () => buildGraphData(rawNodes, rawEdges, filters),
    [rawNodes, rawEdges, filters],
  );

  // Node map for detail panel
  const nodeMap = useMemo(() => {
    const m = new Map<number, GraphNode>();
    for (const n of graphData.nodes) m.set(n.id, n);
    return m;
  }, [graphData.nodes]);

  // Categories for filter dropdown
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const n of graphData.nodes) if (n.category) cats.add(n.category);
    return Array.from(cats).sort();
  }, [graphData.nodes]);

  // Search highlight
  const searchMatch = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    return graphData.nodes.find(n => n.name.toLowerCase().includes(q));
  }, [search, graphData.nodes]);

  // Focus on search result
  useEffect(() => {
    if (searchMatch && graphRef.current) {
      graphRef.current.centerAt(searchMatch.x, searchMatch.y, 500);
      graphRef.current.zoom(3, 500);
    }
  }, [searchMatch]);

  // Node click
  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node as GraphNode);
  }, []);

  // Zoom controls
  const zoomIn = useCallback(() => graphRef.current?.zoom(graphRef.current.zoom() * 1.5, 300), []);
  const zoomOut = useCallback(() => graphRef.current?.zoom(graphRef.current.zoom() / 1.5, 300), []);
  const zoomFit = useCallback(() => graphRef.current?.zoomToFit(400, 40), []);

  // Canvas node painter
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as GraphNode;
    const isHighlighted = searchMatch?.id === n.id;
    const isSelected = selectedNode?.id === n.id;
    const isHovered = hoveredNode?.id === n.id;

    // Node size based on child count
    const baseSize = n.node_type === 'class' ? 5 : 3;
    const size = baseSize + Math.min(n.childCount * 0.5, 8);

    const x = n.x ?? 0;
    const y = n.y ?? 0;

    // Glow for highlighted/selected
    if (isHighlighted || isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(x, y, size + 4, 0, Math.PI * 2);
      ctx.fillStyle = isHighlighted
        ? 'rgba(16, 185, 129, 0.3)'
        : isSelected
          ? 'rgba(139, 92, 246, 0.3)'
          : 'rgba(255, 255, 255, 0.15)';
      ctx.fill();
    }

    // Node circle
    ctx.beginPath();
    if (n.node_type === 'class') {
      // Rounded square for classes
      const r = size * 0.3;
      ctx.moveTo(x - size + r, y - size);
      ctx.lineTo(x + size - r, y - size);
      ctx.quadraticCurveTo(x + size, y - size, x + size, y - size + r);
      ctx.lineTo(x + size, y + size - r);
      ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);
      ctx.lineTo(x - size + r, y + size);
      ctx.quadraticCurveTo(x - size, y + size, x - size, y + size - r);
      ctx.lineTo(x - size, y - size + r);
      ctx.quadraticCurveTo(x - size, y - size, x - size + r, y - size);
    } else {
      ctx.arc(x, y, size, 0, Math.PI * 2);
    }
    ctx.fillStyle = nodeColor(n);
    ctx.fill();

    // Confidence ring
    if (n.confidence < 0.7) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Label
    if (globalScale > 1.2 || isHighlighted || isSelected || isHovered) {
      const label = n.name;
      const fontSize = Math.max(10 / globalScale, 3);
      ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(label, x, y + size + 2);
    }
  }, [searchMatch, selectedNode, hoveredNode]);

  // Link painter
  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const source = link.source as GraphNode;
    const target = link.target as GraphNode;
    if (!source.x || !source.y || !target.x || !target.y) return;

    const isIsa = link.edge_type === 'is_a';

    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.strokeStyle = isIsa ? 'rgba(255,255,255,0.08)' : 'rgba(139,92,246,0.2)';
    ctx.lineWidth = isIsa ? 0.5 : 1;
    ctx.stroke();

    // Edge label at midpoint (only when zoomed in)
    if (globalScale > 2.5 && link.name && !isIsa) {
      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      const fontSize = Math.max(8 / globalScale, 2.5);
      ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(139, 92, 246, 0.6)';
      ctx.fillText(link.name, mx, my);
    }
  }, []);

  if (rawNodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <Layers size={32} className="mx-auto text-emerald-500/40" />
          <p className="text-lg font-medium">No concepts yet</p>
          <p className="text-sm">Upload documents and run extraction to populate the ontology</p>
        </div>
      </div>
    );
  }

  const detailPanelWidth = selectedNode ? 288 : 0;
  const canvasWidth = dimensions.width - detailPanelWidth;

  return (
    <div className="w-full h-full flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border/30 bg-background/80 backdrop-blur-sm">
        <div className="relative w-52">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Find node..."
            className="h-8 pl-8 text-xs"
          />
        </div>

        <Button
          variant={showFilters ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => setShowFilters(!showFilters)}
        >
          <SlidersHorizontal size={14} className="mr-1" />
          Filters
        </Button>

        <div className="flex-1" />

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Box size={11} className="text-emerald-400" />
            {graphData.nodes.filter(n => n.node_type === 'class').length} classes
          </span>
          <span className="flex items-center gap-1">
            <CircleDot size={11} className="text-violet-400" />
            {graphData.nodes.filter(n => n.node_type === 'individual').length} instances
          </span>
          <span className="flex items-center gap-1">
            <Link2 size={11} />
            {graphData.links.length} edges
          </span>
        </div>

        <Separator orientation="vertical" className="h-4" />

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomIn}>
            <ZoomIn size={14} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomOut}>
            <ZoomOut size={14} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomFit}>
            <Maximize2 size={14} />
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="shrink-0 flex items-center gap-4 px-4 py-2 border-b border-border/30 bg-background/50 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Type:</span>
            {(['all', 'class', 'individual'] as const).map(t => (
              <button
                key={t}
                onClick={() => setFilters(f => ({ ...f, nodeType: t }))}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  filters.nodeType === t ? 'bg-emerald-500/20 text-emerald-400' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'all' ? 'All' : t === 'class' ? 'Classes' : 'Instances'}
              </button>
            ))}
          </div>

          <Separator orientation="vertical" className="h-4" />

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Confidence:</span>
            <input
              type="range"
              min={0}
              max={100}
              value={filters.minConfidence * 100}
              onChange={e => setFilters(f => ({ ...f, minConfidence: Number(e.target.value) / 100 }))}
              className="w-24 h-1 accent-emerald-500"
            />
            <span className="text-muted-foreground tabular-nums w-8">
              {Math.round(filters.minConfidence * 100)}%
            </span>
          </div>

          <Separator orientation="vertical" className="h-4" />

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Category:</span>
            <select
              value={filters.category}
              onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
              className="bg-transparent border border-border/30 rounded px-2 py-0.5 text-xs text-foreground cursor-pointer"
            >
              <option value="all">All</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Graph + Detail */}
      <div className="flex-1 min-h-0 flex relative">
        <div ref={containerRef} className="flex-1 min-w-0 relative">
          <ForceGraph2D
            ref={graphRef}
            width={canvasWidth > 0 ? canvasWidth : dimensions.width}
            height={dimensions.height - (showFilters ? 80 : 40)}
            graphData={graphData}
            nodeId="id"
            nodeCanvasObject={paintNode}
            linkCanvasObject={paintLink}
            onNodeClick={handleNodeClick}
            onNodeHover={(node: any) => setHoveredNode(node as GraphNode | null)}
            onBackgroundClick={() => setSelectedNode(null)}
            cooldownTicks={100}
            warmupTicks={50}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={0.9}
            enableNodeDrag={true}
            enableZoomInteraction={true}
            enablePanInteraction={true}
            backgroundColor="transparent"
          />
          <Minimap graphRef={graphRef} />
        </div>

        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            edges={rawEdges}
            allNodes={nodeMap}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}
