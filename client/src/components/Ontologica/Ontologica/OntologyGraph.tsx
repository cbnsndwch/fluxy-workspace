import { useMemo, useState, useCallback } from 'react';
import { useProjectContext } from './context';
import { abbreviateLayerName } from './OntologyNode';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Search, ChevronRight, ChevronDown, Box, CircleDot,
  ArrowRight, ArrowLeft, Layers, Link2, Database,
  BarChart3, Sparkles, AlertTriangle,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────

interface ONode {
  id: number;
  name: string;
  node_type: 'class' | 'individual';
  description?: string;
  parent_id: number | null;
  confidence: number;
  status: string;
  layer_id?: number | null;
  base_item_uri?: string | null;
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

interface TreeNode extends ONode {
  children: TreeNode[];
  depth: number;
  descendantCount: number;
}

// ── Hierarchy builder ──────────────────────────────────

function buildTree(nodes: ONode[], edges: OEdge[]): TreeNode[] {
  const byId = new Map<number, ONode>(nodes.map(n => [n.id, n]));
  const childMap = new Map<number, number[]>();
  const isChild = new Set<number>();

  for (const n of nodes) childMap.set(n.id, []);

  // parent_id
  for (const n of nodes) {
    if (n.parent_id && byId.has(n.parent_id)) {
      childMap.get(n.parent_id)!.push(n.id);
      isChild.add(n.id);
    }
  }

  // is_a edges
  for (const e of edges) {
    if (e.edge_type === 'is_a' && byId.has(e.source_node_id) && byId.has(e.target_node_id)) {
      if (!isChild.has(e.source_node_id)) {
        childMap.get(e.target_node_id)!.push(e.source_node_id);
        isChild.add(e.source_node_id);
      }
    }
  }

  function build(id: number, depth: number): TreeNode {
    const n = byId.get(id)!;
    const kids = (childMap.get(id) ?? []).map(cid => build(cid, depth + 1));
    kids.sort((a, b) => {
      // Classes first, then alphabetical
      if (a.node_type !== b.node_type) return a.node_type === 'class' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const descendantCount = kids.reduce((s, k) => s + 1 + k.descendantCount, 0);
    return { ...n, children: kids, depth, descendantCount };
  }

  const roots = nodes.filter(n => !isChild.has(n.id)).map(n => build(n.id, 0));

  // Sort: categories (have children) first, then by descendant count desc
  roots.sort((a, b) => {
    const aHas = a.children.length > 0 ? 1 : 0;
    const bHas = b.children.length > 0 ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    if (a.descendantCount !== b.descendantCount) return b.descendantCount - a.descendantCount;
    return a.name.localeCompare(b.name);
  });

  return roots;
}

// ── Dedup helper ──────────────────────────────────────

function deduplicateRoots(roots: TreeNode[]): { categories: TreeNode[]; orphans: TreeNode[] } {
  const seen = new Map<string, TreeNode>();
  const categories: TreeNode[] = [];
  const orphans: TreeNode[] = [];

  for (const root of roots) {
    const key = root.name.toLowerCase().trim();
    if (root.children.length > 0) {
      // Category — keep the one with the most descendants
      if (seen.has(key)) {
        const existing = seen.get(key)!;
        if (root.descendantCount > existing.descendantCount) {
          // Merge children from existing into this one
          const existingChildren = existing.children.filter(
            ec => !root.children.some(rc => rc.name.toLowerCase() === ec.name.toLowerCase())
          );
          root.children.push(...existingChildren);
          root.descendantCount += existingChildren.reduce((s, c) => s + 1 + c.descendantCount, 0);
          const idx = categories.indexOf(existing);
          if (idx >= 0) categories[idx] = root;
          seen.set(key, root);
        } else {
          // Merge this root's unique children into existing
          const newChildren = root.children.filter(
            rc => !existing.children.some(ec => ec.name.toLowerCase() === rc.name.toLowerCase())
          );
          existing.children.push(...newChildren);
          existing.descendantCount += newChildren.reduce((s, c) => s + 1 + c.descendantCount, 0);
        }
      } else {
        seen.set(key, root);
        categories.push(root);
      }
    } else {
      // Leaf root — check if it already exists as a child in any category
      const isDup = categories.some(cat => hasDescendant(cat, key));
      if (!isDup) {
        if (seen.has(key)) continue; // skip duplicate orphans
        seen.set(key, root);
        orphans.push(root);
      }
    }
  }

  return { categories, orphans };
}

function hasDescendant(node: TreeNode, name: string): boolean {
  if (node.name.toLowerCase().trim() === name) return true;
  return node.children.some(c => hasDescendant(c, name));
}

// ── Search helper ─────────────────────────────────────

function searchTree(roots: TreeNode[], query: string): TreeNode[] {
  const q = query.toLowerCase();
  const results: TreeNode[] = [];

  function walk(node: TreeNode) {
    if (node.name.toLowerCase().includes(q) || node.description?.toLowerCase().includes(q)) {
      results.push(node);
    }
    node.children.forEach(walk);
  }

  roots.forEach(walk);
  return results;
}

// ── Color helpers ─────────────────────────────────────

const CATEGORY_COLORS = [
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', bar: 'bg-emerald-500' },
  { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400', bar: 'bg-violet-500' },
  { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', bar: 'bg-blue-500' },
  { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', bar: 'bg-amber-500' },
  { bg: 'bg-rose-500/10', border: 'border-rose-500/20', text: 'text-rose-400', bar: 'bg-rose-500' },
  { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400', bar: 'bg-cyan-500' },
  { bg: 'bg-orange-500/10', border: 'border-orange-500/20', text: 'text-orange-400', bar: 'bg-orange-500' },
  { bg: 'bg-pink-500/10', border: 'border-pink-500/20', text: 'text-pink-400', bar: 'bg-pink-500' },
  { bg: 'bg-teal-500/10', border: 'border-teal-500/20', text: 'text-teal-400', bar: 'bg-teal-500' },
  { bg: 'bg-indigo-500/10', border: 'border-indigo-500/20', text: 'text-indigo-400', bar: 'bg-indigo-500' },
];

function getColor(idx: number) {
  return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
}

function confidenceLabel(c: number): { text: string; className: string } {
  if (c >= 0.9) return { text: 'High', className: 'text-emerald-400' };
  if (c >= 0.7) return { text: 'Medium', className: 'text-amber-400' };
  return { text: 'Low', className: 'text-red-400' };
}

// ── Components ────────────────────────────────────────

function CategoryCard({
  node, colorIdx, onClick,
}: {
  node: TreeNode; colorIdx: number; onClick: () => void;
}) {
  const color = getColor(colorIdx);
  const childClasses = node.children.filter(c => c.node_type === 'class').length;
  const childInstances = node.children.filter(c => c.node_type === 'individual').length;

  return (
    <button
      onClick={onClick}
      className={`group relative w-full text-left rounded-lg border ${color.border} ${color.bg} p-4
        hover:brightness-125 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`shrink-0 w-8 h-8 rounded-md ${color.bg} flex items-center justify-center`}>
            <Box size={16} className={color.text} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{node.name}</h3>
            {node.description && (
              <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{node.description}</p>
            )}
          </div>
        </div>
        <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 group-hover:text-foreground/70 transition-colors mt-1" />
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Layers size={11} />
          {node.descendantCount + 1} concepts
        </span>
        {childClasses > 0 && (
          <span className="flex items-center gap-1">
            <Box size={10} className="text-emerald-400/70" />
            {childClasses}
          </span>
        )}
        {childInstances > 0 && (
          <span className="flex items-center gap-1">
            <CircleDot size={10} className="text-violet-400/70" />
            {childInstances}
          </span>
        )}
      </div>

      {/* Mini preview of children */}
      {node.children.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {node.children.slice(0, 5).map(child => (
            <span
              key={child.id}
              className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-muted-foreground/80 border border-white/5"
            >
              {child.name}
            </span>
          ))}
          {node.children.length > 5 && (
            <span className="px-1.5 py-0.5 text-[10px] text-muted-foreground/50">
              +{node.children.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Confidence bar */}
      <div className="mt-3 h-[3px] bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full ${color.bar} rounded-full`} style={{ width: `${node.confidence * 100}%`, opacity: 0.6 }} />
      </div>
    </button>
  );
}

function TreeRow({
  node, depth, expanded, onToggle, selected, onSelect, edges, layerMap,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  selected: number | null;
  onSelect: (id: number) => void;
  edges: OEdge[];
  layerMap: Map<number, string>;
}) {
  const hasKids = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = selected === node.id;
  const isClass = node.node_type === 'class';
  const layerName = node.layer_id ? layerMap.get(node.layer_id) : undefined;
  const isBaseLayer = !!layerName;

  // Count direct relationships
  const relCount = edges.filter(
    e => e.edge_type !== 'is_a' && (e.source_node_id === node.id || e.target_node_id === node.id)
  ).length;

  return (
    <>
      <button
        onClick={() => onSelect(node.id)}
        className={`w-full flex items-center gap-1.5 py-1.5 px-2 rounded-md text-left transition-colors cursor-pointer
          ${isSelected ? 'bg-emerald-500/15 text-foreground' : 'hover:bg-white/5 text-foreground/80'}`}
        style={{
          paddingLeft: `${depth * 20 + 8}px`,
          opacity: isBaseLayer ? 0.85 : 1,
        }}
        title={isBaseLayer ? `Base layer: ${layerName}${node.base_item_uri ? `\nURI: ${node.base_item_uri}` : ''}` : undefined}
      >
        {/* Expand toggle */}
        {hasKids ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            className="shrink-0 p-0.5 rounded hover:bg-white/10 cursor-pointer"
          >
            {isExpanded
              ? <ChevronDown size={14} className="text-muted-foreground" />
              : <ChevronRight size={14} className="text-muted-foreground" />
            }
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {/* Icon */}
        {isClass
          ? <Box size={12} className={`${isBaseLayer ? 'text-cyan-400' : 'text-emerald-400'} shrink-0`} />
          : <CircleDot size={12} className={`${isBaseLayer ? 'text-cyan-400' : 'text-violet-400'} shrink-0`} />
        }

        {/* Name */}
        <span className={`text-xs font-medium truncate flex-1 ${isBaseLayer ? 'text-muted-foreground' : ''}`}>{node.name}</span>

        {/* Layer badge */}
        {isBaseLayer && (
          <span className="shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded bg-cyan-500/15 text-cyan-400 text-[9px] font-medium leading-none border border-dashed border-cyan-500/30">
            <Layers size={8} />
            {abbreviateLayerName(layerName!)}
          </span>
        )}

        {/* Badges */}
        {hasKids && !isExpanded && (
          <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">
            {node.children.length}
          </span>
        )}
        {relCount > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/40 shrink-0">
            <Link2 size={9} /> {relCount}
          </span>
        )}
      </button>

      {/* Children */}
      {isExpanded && node.children.map(child => (
        <TreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          selected={selected}
          onSelect={onSelect}
          edges={edges}
          layerMap={layerMap}
        />
      ))}
    </>
  );
}

function DetailPanel({
  node, allNodes, edges, layerMap,
}: {
  node: TreeNode;
  allNodes: Map<number, TreeNode>;
  edges: OEdge[];
  layerMap: Map<number, string>;
}) {
  const isClass = node.node_type === 'class';
  const conf = confidenceLabel(node.confidence);
  const layerName = node.layer_id ? layerMap.get(node.layer_id) : undefined;

  // Get relationships for this node (non-is_a)
  const relationships = edges.filter(
    e => e.edge_type !== 'is_a' && (e.source_node_id === node.id || e.target_node_id === node.id)
  );

  const objectProps = relationships.filter(e => e.edge_type === 'object_property');
  const dataProps = relationships.filter(e => e.edge_type === 'data_property');

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          {isClass
            ? <Box size={16} className={layerName ? 'text-cyan-400' : 'text-emerald-400'} />
            : <CircleDot size={16} className={layerName ? 'text-cyan-400' : 'text-violet-400'} />
          }
          <h2 className="text-base font-semibold">{node.name}</h2>
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <Badge variant="outline" className={`text-[10px] ${isClass ? 'text-emerald-400 border-emerald-500/30' : 'text-violet-400 border-violet-500/30'}`}>
            {isClass ? 'Class' : 'Instance'}
          </Badge>
          <Badge variant="outline" className={`text-[10px] ${node.status === 'approved' ? 'text-emerald-400 border-emerald-500/30' : 'text-amber-400 border-amber-500/30'}`}>
            {node.status}
          </Badge>
          {layerName && (
            <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/30 border-dashed">
              <Layers size={9} className="mr-1" />
              {layerName}
            </Badge>
          )}
          <span className={`text-[11px] ${conf.className}`}>
            {Math.round(node.confidence * 100)}% confidence
          </span>
        </div>
      </div>

      {/* Base layer URI */}
      {node.base_item_uri && (
        <>
          <Separator className="bg-border/30" />
          <div>
            <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Base Layer URI</h4>
            <p className="text-[10px] text-cyan-400/80 font-mono break-all">{node.base_item_uri}</p>
          </div>
        </>
      )}

      {node.description && (
        <>
          <Separator className="bg-border/30" />
          <div>
            <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Description</h4>
            <p className="text-xs text-foreground/80 leading-relaxed">{node.description}</p>
          </div>
        </>
      )}

      {/* Children */}
      {node.children.length > 0 && (
        <>
          <Separator className="bg-border/30" />
          <div>
            <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Subtypes ({node.children.length})
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {node.children.map(child => (
                <span
                  key={child.id}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border ${
                    child.node_type === 'class'
                      ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                      : 'bg-violet-500/5 border-violet-500/20 text-violet-300'
                  }`}
                >
                  {child.node_type === 'class' ? <Box size={10} /> : <CircleDot size={10} />}
                  {child.name}
                  {child.children.length > 0 && (
                    <span className="text-muted-foreground/50 ml-0.5">({child.descendantCount + 1})</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Object Properties */}
      {objectProps.length > 0 && (
        <>
          <Separator className="bg-border/30" />
          <div>
            <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <ArrowRight size={11} /> Relationships ({objectProps.length})
            </h4>
            <div className="space-y-1.5">
              {objectProps.map(e => {
                const isSource = e.source_node_id === node.id;
                const otherId = isSource ? e.target_node_id : e.source_node_id;
                const other = allNodes.get(otherId);
                return (
                  <div key={e.id} className="flex items-center gap-2 text-xs bg-violet-500/5 rounded-md px-2.5 py-1.5 border border-violet-500/10">
                    <span className="text-violet-400 font-medium shrink-0">{e.name || 'relates to'}</span>
                    <ArrowRight size={10} className="text-muted-foreground/50 shrink-0" />
                    <span className="truncate text-foreground/80">{other?.name || `Node #${otherId}`}</span>
                    <span className="text-[10px] text-muted-foreground/40 ml-auto tabular-nums shrink-0">
                      {Math.round(e.confidence * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Data Properties */}
      {dataProps.length > 0 && (
        <>
          <Separator className="bg-border/30" />
          <div>
            <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Database size={11} /> Properties ({dataProps.length})
            </h4>
            <div className="space-y-1.5">
              {dataProps.map(e => (
                <div key={e.id} className="flex items-center justify-between gap-2 text-xs bg-amber-500/5 rounded-md px-2.5 py-1.5 border border-amber-500/10">
                  <span className="text-amber-400 font-medium">{e.name || 'property'}</span>
                  {e.target_value && <span className="text-foreground/60 truncate">{e.target_value}</span>}
                  {e.description && !e.target_value && (
                    <span className="text-foreground/60 truncate text-right">{e.description}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────

export function OntologyGraph() {
  const { nodes: rawNodes, edges: rawEdges, layers } = useProjectContext();

  const [search, setSearch] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  // Map layer_id → layer name for display
  const layerMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of (layers || [])) {
      // Active layers have layer_id (referencing onto_base_layers.id) and name
      if (l.layer_id && l.name) m.set(l.layer_id, l.name);
      // Also index by own id in case nodes reference it
      if (l.id && l.name) m.set(l.id, l.name);
    }
    return m;
  }, [layers]);

  // Build hierarchy
  const tree = useMemo(() => buildTree(rawNodes, rawEdges), [rawNodes, rawEdges]);
  const { categories, orphans } = useMemo(() => deduplicateRoots(tree), [tree]);

  // Flat map for detail panel lookups
  const nodeMap = useMemo(() => {
    const map = new Map<number, TreeNode>();
    function walk(n: TreeNode) { map.set(n.id, n); n.children.forEach(walk); }
    tree.forEach(walk);
    return map;
  }, [tree]);

  // Active category
  const activeCategory = activeCategoryId ? nodeMap.get(activeCategoryId) ?? null : null;

  // Search results
  const searchResults = useMemo(() => {
    if (!search) return null;
    return searchTree(tree, search);
  }, [tree, search]);

  // Selected node
  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;

  const toggleExpand = useCallback((id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAllIn = useCallback((node: TreeNode) => {
    const ids = new Set(expanded);
    function walk(n: TreeNode) { if (n.children.length > 0) { ids.add(n.id); n.children.forEach(walk); } }
    walk(node);
    setExpanded(ids);
  }, [expanded]);

  // Stats
  const totalClasses = rawNodes.filter(n => n.node_type === 'class').length;
  const totalInstances = rawNodes.filter(n => n.node_type === 'individual').length;
  const totalEdges = rawEdges.filter(e => e.edge_type !== 'is_a').length;
  const avgConfidence = rawNodes.length > 0
    ? rawNodes.reduce((s: number, n: any) => s + (n.confidence || 0), 0) / rawNodes.length
    : 0;

  if (rawNodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <Sparkles size={32} className="mx-auto text-emerald-500/40" />
          <p className="text-lg font-medium">No concepts yet</p>
          <p className="text-sm">Upload documents and run extraction to populate the ontology</p>
        </div>
      </div>
    );
  }

  // ── Search view ───────────────────────────────────
  if (searchResults) {
    return (
      <div className="w-full h-full flex flex-col">
        <Toolbar
          search={search}
          setSearch={setSearch}
          totalClasses={totalClasses}
          totalInstances={totalInstances}
          totalEdges={totalEdges}
          avgConfidence={avgConfidence}
        />
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 overflow-y-auto p-4">
            {searchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center mt-8">No results for "{search}"</p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground mb-3">{searchResults.length} results</p>
                {searchResults.map(node => (
                  <button
                    key={node.id}
                    onClick={() => { setSelectedNodeId(node.id); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors cursor-pointer
                      ${selectedNodeId === node.id ? 'bg-emerald-500/15' : 'hover:bg-white/5'}`}
                  >
                    {node.node_type === 'class'
                      ? <Box size={13} className="text-emerald-400 shrink-0" />
                      : <CircleDot size={13} className="text-violet-400 shrink-0" />
                    }
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-medium block truncate">{node.name}</span>
                      {node.description && (
                        <span className="text-[10px] text-muted-foreground/60 block truncate">{node.description}</span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {node.node_type}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Detail panel */}
          {selectedNode && (
            <div className="w-80 border-l border-border/30 shrink-0">
              <DetailPanel node={selectedNode} allNodes={nodeMap} edges={rawEdges} layerMap={layerMap} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Category detail view ──────────────────────────
  if (activeCategory) {
    return (
      <div className="w-full h-full flex flex-col">
        <Toolbar
          search={search}
          setSearch={setSearch}
          totalClasses={totalClasses}
          totalInstances={totalInstances}
          totalEdges={totalEdges}
          avgConfidence={avgConfidence}
        />

        {/* Breadcrumb */}
        <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-border/30 bg-background/50">
          <button
            onClick={() => { setActiveCategoryId(null); setSelectedNodeId(null); setExpanded(new Set()); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
          >
            <ArrowLeft size={12} />
            All Categories
          </button>
          <ChevronRight size={12} className="text-muted-foreground/40" />
          <span className="text-xs font-medium">{activeCategory.name}</span>
          <span className="text-[10px] text-muted-foreground/50 ml-1">
            ({activeCategory.descendantCount + 1} concepts)
          </span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] px-2"
            onClick={() => expandAllIn(activeCategory)}
          >
            Expand All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] px-2"
            onClick={() => setExpanded(new Set())}
          >
            Collapse
          </Button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Tree */}
          <div className="flex-1 overflow-y-auto p-2">
            <TreeRow
              node={activeCategory}
              depth={0}
              expanded={expanded}
              onToggle={toggleExpand}
              selected={selectedNodeId}
              onSelect={setSelectedNodeId}
              edges={rawEdges}
              layerMap={layerMap}
            />
          </div>

          {/* Detail panel */}
          {selectedNode && (
            <div className="w-80 border-l border-border/30 shrink-0">
              <DetailPanel node={selectedNode} allNodes={nodeMap} edges={rawEdges} layerMap={layerMap} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Overview — category grid ──────────────────────
  return (
    <div className="w-full h-full flex flex-col relative">
      <Toolbar
        search={search}
        setSearch={setSearch}
        totalClasses={totalClasses}
        totalInstances={totalInstances}
        totalEdges={totalEdges}
        avgConfidence={avgConfidence}
      />

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {/* Categories */}
        <div className="mb-6">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Layers size={12} />
            Categories ({categories.length})
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {categories.map((cat, idx) => (
              <CategoryCard
                key={cat.id}
                node={cat}
                colorIdx={idx}
                onClick={() => {
                  setActiveCategoryId(cat.id);
                  // Auto-expand root
                  setExpanded(new Set([cat.id]));
                  setSelectedNodeId(cat.id);
                }}
              />
            ))}
          </div>
        </div>

        {/* Orphan entities */}
        {orphans.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-amber-400/70" />
              Uncategorized ({orphans.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {orphans.map(node => (
                <button
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors cursor-pointer
                    ${selectedNodeId === node.id
                      ? 'bg-emerald-500/15 border-emerald-500/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                >
                  {node.node_type === 'class'
                    ? <Box size={11} className="text-emerald-400" />
                    : <CircleDot size={11} className="text-violet-400" />
                  }
                  {node.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating detail panel for orphan selection */}
      {selectedNode && !activeCategory && (
        <div className="absolute right-0 top-0 bottom-0 w-80 border-l border-border/30 bg-background shadow-xl z-10">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
            <span className="text-xs font-medium">Details</span>
            <button onClick={() => setSelectedNodeId(null)} className="text-muted-foreground hover:text-foreground cursor-pointer p-1">
              ✕
            </button>
          </div>
          <DetailPanel node={selectedNode} allNodes={nodeMap} edges={rawEdges} layerMap={layerMap} />
        </div>
      )}
    </div>
  );
}

// ── Toolbar ─────────────────────────────────────────

function Toolbar({
  search, setSearch, totalClasses, totalInstances, totalEdges, avgConfidence,
}: {
  search: string;
  setSearch: (v: string) => void;
  totalClasses: number;
  totalInstances: number;
  totalEdges: number;
  avgConfidence: number;
}) {
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border/30 bg-background/80 backdrop-blur-sm">
      <div className="relative w-56">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search concepts..."
          className="h-8 pl-8 text-xs"
        />
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Box size={11} className="text-emerald-400" />
          {totalClasses} classes
        </span>
        <span className="flex items-center gap-1">
          <CircleDot size={11} className="text-violet-400" />
          {totalInstances} instances
        </span>
        <span className="flex items-center gap-1">
          <Link2 size={11} />
          {totalEdges} relations
        </span>
        <span className="flex items-center gap-1">
          <BarChart3 size={11} />
          {Math.round(avgConfidence * 100)}% avg confidence
        </span>
      </div>
    </div>
  );
}
