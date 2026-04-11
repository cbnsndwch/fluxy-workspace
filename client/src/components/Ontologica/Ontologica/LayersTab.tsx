import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Loader2, ChevronDown, ChevronRight, Layers, Package } from 'lucide-react';
import { useProjectContext } from './context';
import { toast } from 'sonner';

interface BaseLayer {
  id: number;
  slug: string;
  name: string;
  description: string;
  namespace: string;
  version: string;
  category: string;
  is_always_on: number;
  item_count: number;
  metadata: string;
  created_at: string;
}

interface ActiveLayer {
  id: number;
  project_id: number;
  layer_id: number;
  slug: string;
  name: string;
  auto_activated: number;
}

interface LayerItem {
  id: number;
  layer_id: number;
  item_type: string;
  uri: string;
  local_name: string;
  label: string;
  description: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  'W3C': 'bg-blue-500/20 text-blue-400',
  'Community': 'bg-purple-500/20 text-purple-400',
  'Domain': 'bg-emerald-500/20 text-emerald-400',
  'Commons': 'bg-orange-500/20 text-orange-400',
};

export default function LayersTab() {
  const { projectId, layers: activeLayers, loadLayers } = useProjectContext();
  const [catalog, setCatalog] = useState<BaseLayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [items, setItems] = useState<LayerItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const loadCatalog = useCallback(async () => {
    const res = await fetch('/app/api/ontologica/layers');
    if (res.ok) setCatalog(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const isActive = (slug: string) => activeLayers.some((l: ActiveLayer) => l.slug === slug);
  const getActiveLayer = (slug: string) => activeLayers.find((l: ActiveLayer) => l.slug === slug);

  const handleToggle = async (layer: BaseLayer) => {
    if (layer.is_always_on) return;

    setToggling(prev => new Set(prev).add(layer.slug));
    try {
      if (isActive(layer.slug)) {
        const res = await fetch(`/app/api/ontologica/projects/${projectId}/layers/${layer.slug}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          toast.success(`Deactivated "${layer.name}"`);
        } else {
          const err = await res.json();
          toast.error(err.error || 'Failed to deactivate');
        }
      } else {
        const res = await fetch(`/app/api/ontologica/projects/${projectId}/layers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: layer.slug }),
        });
        if (res.ok) {
          const data = await res.json();
          const autoActivated = data.activated?.filter((a: any) => a.auto_activated) || [];
          if (autoActivated.length > 0) {
            toast.success(
              `Activated "${layer.name}" + auto-activated dependencies: ${autoActivated.map((a: any) => a.name).join(', ')}`
            );
          } else {
            toast.success(`Activated "${layer.name}"`);
          }
        } else {
          toast.error('Failed to activate layer');
        }
      }
      await loadLayers();
    } finally {
      setToggling(prev => {
        const next = new Set(prev);
        next.delete(layer.slug);
        return next;
      });
    }
  };

  const handleExpand = async (slug: string) => {
    if (expandedSlug === slug) {
      setExpandedSlug(null);
      return;
    }
    setExpandedSlug(slug);
    setLoadingItems(true);
    const res = await fetch(`/app/api/ontologica/layers/${slug}/items`);
    if (res.ok) setItems(await res.json());
    else setItems([]);
    setLoadingItems(false);
  };

  const getDependencies = (layer: BaseLayer): string[] => {
    try {
      const meta = JSON.parse(layer.metadata || '{}');
      return meta.dependencies || [];
    } catch {
      return [];
    }
  };

  const groupItemsByType = (items: LayerItem[]) => {
    const groups: Record<string, LayerItem[]> = {};
    for (const item of items) {
      const type = item.item_type || 'other';
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    }
    return groups;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto h-full space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Layers size={20} className="text-emerald-500" />
          Base Ontology Layers
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Activate standard vocabularies and ontology layers to enrich your project with shared definitions.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {catalog.map(layer => {
          const active = isActive(layer.slug);
          const activeLayer = getActiveLayer(layer.slug);
          const deps = getDependencies(layer);
          const isExpanded = expandedSlug === layer.slug;
          const isToggling = toggling.has(layer.slug);

          return (
            <Card
              key={layer.slug}
              className={`transition-colors ${active ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}
            >
              <CardContent className="p-4 space-y-3">
                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{layer.name}</span>
                      <Badge variant="outline" className={CATEGORY_COLORS[layer.category] || 'bg-muted text-muted-foreground'}>
                        {layer.category}
                      </Badge>
                      {layer.is_always_on ? (
                        <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-400 text-xs">
                          Always On
                        </Badge>
                      ) : null}
                      {activeLayer?.auto_activated ? (
                        <Badge variant="secondary" className="bg-amber-500/20 text-amber-400 text-xs">
                          Auto-activated
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{layer.description}</p>
                  </div>
                  <div className="flex-shrink-0 pt-0.5">
                    {isToggling ? (
                      <Loader2 className="animate-spin text-muted-foreground" size={16} />
                    ) : (
                      <Switch
                        checked={active || !!layer.is_always_on}
                        onCheckedChange={() => handleToggle(layer)}
                        disabled={!!layer.is_always_on || isToggling}
                      />
                    )}
                  </div>
                </div>

                {/* Namespace + count */}
                <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs truncate max-w-[200px]">
                    {layer.namespace}
                  </code>
                  <Badge variant="outline" className="text-xs">
                    <Package size={10} className="mr-1" />
                    {layer.item_count} items
                  </Badge>
                </div>

                {/* Dependencies */}
                {deps.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">Requires:</span>
                    {deps.map(dep => (
                      <Badge key={dep} variant="outline" className="text-xs">
                        {dep}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Expand toggle */}
                <button
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                  onClick={() => handleExpand(layer.slug)}
                >
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {isExpanded ? 'Hide items' : 'View items'}
                </button>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="border-t pt-3 mt-1 space-y-2">
                    {loadingItems ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="animate-spin text-muted-foreground" size={16} />
                      </div>
                    ) : items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No items in this layer.</p>
                    ) : (
                      Object.entries(groupItemsByType(items)).map(([type, typeItems]) => (
                        <div key={type}>
                          <h4 className="text-xs font-medium capitalize text-muted-foreground mb-1">
                            {type}s ({typeItems.length})
                          </h4>
                          <div className="space-y-0.5">
                            {typeItems.map(item => (
                              <div key={item.id} className="text-xs flex items-start gap-2 py-0.5">
                                <code className="bg-muted px-1 rounded flex-shrink-0">{item.local_name}</code>
                                {item.label && item.label !== item.local_name && (
                                  <span className="text-muted-foreground truncate">{item.label}</span>
                                )}
                              </div>
                            ))}
                          </div>
                          <Separator className="my-2" />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
