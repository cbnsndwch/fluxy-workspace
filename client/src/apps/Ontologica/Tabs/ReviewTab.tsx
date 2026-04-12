import {
    ArrowRight,
    Box,
    Check,
    CheckCheck,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    CircleDot,
    Download,
    FileText,
    Filter,
    Info,
    Layers,
    Link2,
    Loader2,
    Pencil,
    Share2,
    Upload,
    X
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip';

import { useProjectContext } from '../context';
import { DeduplicateDialog } from '../DeduplicateDialog';
import { LayerSuggestionsPanel } from '../LayerSuggestionsPanel';

type SourceFilter = 'all' | 'extracted' | number; // number = layer_id
type TypeFilter = 'all' | 'classes' | 'examples' | 'relationships';
type ConfidenceFilter = 'all' | 60 | 80;

interface GroupedItems {
    key: string;
    label: string;
    layerId: number | null;
    color: string;
    nodes: any[];
    edges: any[];
}

const LAYER_COLORS = [
    {
        bg: 'bg-blue-500/20',
        text: 'text-blue-400',
        border: 'border-l-blue-500'
    },
    {
        bg: 'bg-purple-500/20',
        text: 'text-purple-400',
        border: 'border-l-purple-500'
    },
    {
        bg: 'bg-emerald-500/20',
        text: 'text-emerald-400',
        border: 'border-l-emerald-500'
    },
    {
        bg: 'bg-orange-500/20',
        text: 'text-orange-400',
        border: 'border-l-orange-500'
    },
    {
        bg: 'bg-cyan-500/20',
        text: 'text-cyan-400',
        border: 'border-l-cyan-500'
    },
    {
        bg: 'bg-pink-500/20',
        text: 'text-pink-400',
        border: 'border-l-pink-500'
    }
];

function getLayerColor(index: number) {
    return LAYER_COLORS[index % LAYER_COLORS.length];
}

export function ReviewTab() {
    const {
        projectId,
        nodes,
        edges,
        layers,
        docs,
        stats,
        loadGraph,
        loadStats,
        loadProject
    } = useProjectContext();

    const onReviewComplete = useCallback(() => {
        loadGraph();
        loadStats();
        loadProject();
    }, [loadGraph, loadStats, loadProject]);

    const [selectedNodes, setSelectedNodes] = useState<Set<number>>(new Set());
    const [selectedEdges, setSelectedEdges] = useState<Set<number>>(new Set());
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
        new Set()
    );
    const [bannerCollapsed, setBannerCollapsed] = useState(false);

    // Inline edit state
    const [editingId, setEditingId] = useState<{
        type: 'node' | 'edge';
        id: number;
    } | null>(null);
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [savingEdit, setSavingEdit] = useState(false);

    // Filters
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [confidenceFilter, setConfidenceFilter] =
        useState<ConfidenceFilter>('all');

    const pendingNodes = nodes.filter(n => n.status === 'suggested');
    const pendingEdges = edges.filter(e => e.status === 'suggested');

    // Layer lookup
    const layerMap = useMemo(() => {
        const m = new Map<number, any>();
        layers.forEach((l: any) => m.set(l.layer_id ?? l.id, l));
        return m;
    }, [layers]);

    const layerColorMap = useMemo(() => {
        const m = new Map<number, ReturnType<typeof getLayerColor>>();
        let idx = 0;
        layers.forEach((l: any) => {
            const id = l.layer_id ?? l.id;
            m.set(id, getLayerColor(idx++));
        });
        return m;
    }, [layers]);

    // Document lookup for provenance
    const docMap = useMemo(() => {
        const m = new Map<number, any>();
        docs.forEach((d: any) => m.set(d.id, d));
        return m;
    }, [docs]);

    // Active layer IDs present in pending items
    const activeLayerIds = useMemo(() => {
        const ids = new Set<number>();
        pendingNodes.forEach((n: any) => {
            if (n.layer_id) ids.add(n.layer_id);
        });
        pendingEdges.forEach((e: any) => {
            if (e.layer_id) ids.add(e.layer_id);
        });
        return Array.from(ids);
    }, [pendingNodes, pendingEdges]);

    // Apply filters
    const filteredNodes = useMemo(() => {
        return pendingNodes.filter((n: any) => {
            if (sourceFilter === 'extracted' && n.layer_id) return false;
            if (typeof sourceFilter === 'number' && n.layer_id !== sourceFilter)
                return false;
            if (typeFilter === 'classes' && n.node_type !== 'class')
                return false;
            if (typeFilter === 'examples' && n.node_type !== 'individual')
                return false;
            if (typeFilter === 'relationships') return false;
            if (
                confidenceFilter !== 'all' &&
                n.confidence * 100 < confidenceFilter
            )
                return false;
            return true;
        });
    }, [pendingNodes, sourceFilter, typeFilter, confidenceFilter]);

    const filteredEdges = useMemo(() => {
        return pendingEdges.filter((e: any) => {
            if (sourceFilter === 'extracted' && e.layer_id) return false;
            if (typeof sourceFilter === 'number' && e.layer_id !== sourceFilter)
                return false;
            if (typeFilter === 'classes' || typeFilter === 'examples')
                return false;
            if (
                confidenceFilter !== 'all' &&
                e.confidence * 100 < confidenceFilter
            )
                return false;
            return true;
        });
    }, [pendingEdges, sourceFilter, typeFilter, confidenceFilter]);

    // Group items by source
    const groups = useMemo((): GroupedItems[] => {
        const result: GroupedItems[] = [];
        const extractedNodes = filteredNodes.filter((n: any) => !n.layer_id);
        const extractedEdges = filteredEdges.filter((e: any) => !e.layer_id);
        if (extractedNodes.length > 0 || extractedEdges.length > 0) {
            result.push({
                key: 'extracted',
                label: 'Extracted Items',
                layerId: null,
                color: '',
                nodes: extractedNodes,
                edges: extractedEdges
            });
        }
        const layerIds = new Set<number>();
        filteredNodes.forEach((n: any) => {
            if (n.layer_id) layerIds.add(n.layer_id);
        });
        filteredEdges.forEach((e: any) => {
            if (e.layer_id) layerIds.add(e.layer_id);
        });
        Array.from(layerIds).forEach(lid => {
            const layer = layerMap.get(lid);
            result.push({
                key: `layer-${lid}`,
                label: layer ? `${layer.name} Items` : `Layer ${lid} Items`,
                layerId: lid,
                color: layerColorMap.get(lid)?.border || '',
                nodes: filteredNodes.filter((n: any) => n.layer_id === lid),
                edges: filteredEdges.filter((e: any) => e.layer_id === lid)
            });
        });
        return result;
    }, [filteredNodes, filteredEdges, layerMap, layerColorMap]);

    const totalFiltered = filteredNodes.length + filteredEdges.length;
    const totalPending = pendingNodes.length + pendingEdges.length;

    const filteredNodeIds = useMemo(
        () => new Set(filteredNodes.map((n: any) => n.id)),
        [filteredNodes]
    );
    const filteredEdgeIds = useMemo(
        () => new Set(filteredEdges.map((e: any) => e.id)),
        [filteredEdges]
    );

    // Trim selection on filter change
    const prevFilterRef = useRef({
        sourceFilter,
        typeFilter,
        confidenceFilter
    });
    const filtersChanged =
        prevFilterRef.current.sourceFilter !== sourceFilter ||
        prevFilterRef.current.typeFilter !== typeFilter ||
        prevFilterRef.current.confidenceFilter !== confidenceFilter;
    if (filtersChanged) {
        prevFilterRef.current = { sourceFilter, typeFilter, confidenceFilter };
        const trimmedNodes = new Set(
            [...selectedNodes].filter(id => filteredNodeIds.has(id))
        );
        const trimmedEdges = new Set(
            [...selectedEdges].filter(id => filteredEdgeIds.has(id))
        );
        if (
            trimmedNodes.size !== selectedNodes.size ||
            trimmedEdges.size !== selectedEdges.size
        ) {
            Promise.resolve().then(() => {
                setSelectedNodes(trimmedNodes);
                setSelectedEdges(trimmedEdges);
            });
        }
    }

    const activeFilterCount =
        (sourceFilter !== 'all' ? 1 : 0) +
        (typeFilter !== 'all' ? 1 : 0) +
        (confidenceFilter !== 'all' ? 1 : 0);
    const visibleSelectedNodes = useMemo(
        () => new Set([...selectedNodes].filter(id => filteredNodeIds.has(id))),
        [selectedNodes, filteredNodeIds]
    );
    const visibleSelectedEdges = useMemo(
        () => new Set([...selectedEdges].filter(id => filteredEdgeIds.has(id))),
        [selectedEdges, filteredEdgeIds]
    );
    const visibleSelectedCount =
        visibleSelectedNodes.size + visibleSelectedEdges.size;
    const allVisibleSelected =
        visibleSelectedCount === totalFiltered && totalFiltered > 0;

    const clearFilters = () => {
        setSourceFilter('all');
        setTypeFilter('all');
        setConfidenceFilter('all');
    };

    const toggleNode = (id: number) => {
        const next = new Set(selectedNodes);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelectedNodes(next);
    };

    const toggleEdge = (id: number) => {
        const next = new Set(selectedEdges);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelectedEdges(next);
    };

    const selectGroup = (group: GroupedItems) => {
        const next = new Set(selectedNodes);
        group.nodes.forEach(n => next.add(n.id));
        setSelectedNodes(next);
        const nextE = new Set(selectedEdges);
        group.edges.forEach(e => nextE.add(e.id));
        setSelectedEdges(nextE);
    };

    const deselectAll = () => {
        setSelectedNodes(new Set());
        setSelectedEdges(new Set());
    };

    const selectAll = () => {
        if (allVisibleSelected) {
            deselectAll();
        } else {
            setSelectedNodes(new Set(filteredNodes.map((n: any) => n.id)));
            setSelectedEdges(new Set(filteredEdges.map((e: any) => e.id)));
        }
    };

    const toggleGroupCollapse = (key: string) => {
        const next = new Set(collapsedGroups);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        setCollapsedGroups(next);
    };

    // ── Quick Actions (per-card approve/reject) ──────────────────────────────

    const quickAction = useCallback(
        async (
            type: 'node' | 'edge',
            id: number,
            action: 'approved' | 'rejected'
        ) => {
            await fetch(`/app/api/ontologica/projects/${projectId}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_ids: type === 'node' ? [id] : [],
                    edge_ids: type === 'edge' ? [id] : [],
                    action
                })
            });
            onReviewComplete();
        },
        [projectId, onReviewComplete]
    );

    const handleReview = async (action: 'approved' | 'rejected') => {
        await fetch(`/app/api/ontologica/projects/${projectId}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                node_ids: Array.from(visibleSelectedNodes),
                edge_ids: Array.from(visibleSelectedEdges),
                action
            })
        });
        setSelectedNodes(new Set());
        setSelectedEdges(new Set());
        onReviewComplete();
    };

    const handleApproveAll = async () => {
        await fetch(`/app/api/ontologica/projects/${projectId}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                node_ids: filteredNodes.map((n: any) => n.id),
                edge_ids: filteredEdges.map((e: any) => e.id),
                action: 'approved'
            })
        });
        onReviewComplete();
    };

    const handleApproveBaseLayerItems = async () => {
        const blNodes = pendingNodes.filter((n: any) => n.layer_id);
        const blEdges = pendingEdges.filter((e: any) => e.layer_id);
        await fetch(`/app/api/ontologica/projects/${projectId}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                node_ids: blNodes.map((n: any) => n.id),
                edge_ids: blEdges.map((e: any) => e.id),
                action: 'approved'
            })
        });
        onReviewComplete();
    };

    const handleApproveLayerItems = async (layerId: number) => {
        const lNodes = pendingNodes.filter((n: any) => n.layer_id === layerId);
        const lEdges = pendingEdges.filter((e: any) => e.layer_id === layerId);
        await fetch(`/app/api/ontologica/projects/${projectId}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                node_ids: lNodes.map((n: any) => n.id),
                edge_ids: lEdges.map((e: any) => e.id),
                action: 'approved'
            })
        });
        onReviewComplete();
    };

    // ── Inline Editing ───────────────────────────────────────────────────────

    const startEdit = useCallback(
        (type: 'node' | 'edge', id: number, name: string, desc: string) => {
            setEditingId({ type, id });
            setEditName(name);
            setEditDesc(desc || '');
        },
        []
    );

    const cancelEdit = useCallback(() => {
        setEditingId(null);
        setEditName('');
        setEditDesc('');
    }, []);

    const saveEdit = useCallback(async () => {
        if (!editingId) return;
        setSavingEdit(true);
        try {
            const endpoint =
                editingId.type === 'node'
                    ? `/app/api/ontologica/projects/${projectId}/nodes/${editingId.id}`
                    : `/app/api/ontologica/projects/${projectId}/edges/${editingId.id}`;
            await fetch(endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: editName.trim(),
                    description: editDesc.trim() || null
                })
            });
            onReviewComplete();
            setEditingId(null);
        } catch {
            toast.error('Failed to save edit');
        } finally {
            setSavingEdit(false);
        }
    }, [editingId, editName, editDesc, projectId, onReviewComplete]);

    // ── Export / Import ──────────────────────────────────────────────────────

    const [exportPhase, setExportPhase] = useState<
        null | 'grouping' | 'rendering' | 'downloading'
    >(null);
    const exportAbort = useRef<AbortController | null>(null);

    const handleShareExport = async () => {
        if (exportPhase) return;
        exportAbort.current = new AbortController();
        setExportPhase('grouping');
        try {
            const res = await fetch(
                `/app/api/ontologica/projects/${projectId}/review-export`,
                {
                    signal: exportAbort.current.signal
                }
            );
            if (!res.ok) throw new Error('Export failed');
            setExportPhase('rendering');
            const blob = await res.blob();
            setExportPhase('downloading');
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download =
                res.headers
                    .get('content-disposition')
                    ?.match(/filename="(.+)"/)?.[1] || 'review.html';
            a.click();
            URL.revokeObjectURL(url);
            toast.success('Review file downloaded — send it to your customer');
        } catch (e: any) {
            if (e.name !== 'AbortError')
                toast.error('Failed to export review file');
        } finally {
            setExportPhase(null);
            exportAbort.current = null;
        }
    };

    const handleImportDecisions = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const payload = JSON.parse(text);
                const res = await fetch(
                    `/app/api/ontologica/projects/${projectId}/review-import`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ decisions: payload.decisions })
                    }
                );
                if (!res.ok) throw new Error('Import failed');
                const result = await res.json();
                toast.success(
                    `Imported ${result.applied} decisions (${result.skipped} skipped)`
                );
                onReviewComplete();
            } catch (e: any) {
                toast.error(
                    'Failed to import: ' + (e.message || 'Invalid file')
                );
            }
        };
        input.click();
    };

    const nodeMap = new Map(nodes.map((n: any) => [n.id, n]));
    const hasBaseLayerItems =
        pendingNodes.some((n: any) => n.layer_id) ||
        pendingEdges.some((e: any) => e.layer_id);

    if (totalPending === 0) {
        return (
            <div className="h-full flex flex-col overflow-hidden">
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
                    <div className="text-center">
                        <CheckCheck
                            size={40}
                            className="mx-auto mb-3 text-emerald-500 opacity-50"
                        />
                        <p className="text-lg font-medium mb-1">
                            All caught up
                        </p>
                        <p className="text-sm mb-4">
                            No items pending review. Run extraction to generate
                            new suggestions.
                        </p>
                        <DeduplicateDialog
                            projectId={projectId}
                            onComplete={onReviewComplete}
                        />
                    </div>
                </div>
                {/* Show layer suggestions even when review queue is empty */}
                <LayerSuggestionsPanel
                    projectId={projectId}
                    onComplete={onReviewComplete}
                />
            </div>
        );
    }

    const renderLayerBadge = (layerId: number | null | undefined) => {
        if (!layerId) return null;
        const layer = layerMap.get(layerId);
        const colors = layerColorMap.get(layerId);
        if (!layer) return null;
        return (
            <Badge
                variant="outline"
                className={`text-[10px] ${colors?.bg || ''} ${colors?.text || ''} border-0`}
            >
                {layer.name}
            </Badge>
        );
    };

    const renderBaseItemUri = (uri: string | null | undefined) => {
        if (!uri) return null;
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Link2
                            size={12}
                            className="text-muted-foreground shrink-0 cursor-help"
                        />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-75">
                        <code className="text-xs break-all">{uri}</code>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    };

    const renderProvenance = (sourceDocId: number | null | undefined) => {
        if (!sourceDocId) return null;
        const doc = docMap.get(sourceDocId);
        if (!doc) return null;
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground max-w-35 cursor-help">
                            <FileText size={10} className="shrink-0" />
                            <span className="truncate">{doc.filename}</span>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-75">
                        <p className="text-xs font-medium">Source document</p>
                        <code className="text-xs break-all">
                            {doc.filename}
                        </code>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    };

    const FilterChip = ({
        active,
        onClick,
        children
    }: {
        active: boolean;
        onClick: () => void;
        children: React.ReactNode;
    }) => (
        <button
            onClick={onClick}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                active
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
        >
            {children}
        </button>
    );

    // ── Node card (with quick actions + inline edit) ─────────────────────────

    const renderNodeCard = (n: any, isLayerGroup: boolean, lColors: any) => {
        const isEditing = editingId?.type === 'node' && editingId.id === n.id;

        if (isEditing) {
            return (
                <Card
                    key={`n-${n.id}`}
                    className="border-violet-500/50 bg-violet-500/5"
                >
                    <CardContent className="p-3 space-y-2">
                        <Input
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            placeholder="Name"
                            className="h-8 text-sm"
                            autoFocus
                            onKeyDown={e => {
                                if (e.key === 'Escape') cancelEdit();
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    saveEdit();
                                }
                            }}
                        />
                        <Textarea
                            value={editDesc}
                            onChange={e => setEditDesc(e.target.value)}
                            placeholder="Description (optional)"
                            className="text-xs min-h-15 resize-none"
                            onKeyDown={e => {
                                if (e.key === 'Escape') cancelEdit();
                            }}
                        />
                        <div className="flex items-center gap-2 justify-end">
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={cancelEdit}
                                className="h-7 text-xs"
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={saveEdit}
                                disabled={savingEdit || !editName.trim()}
                                className="h-7 text-xs"
                            >
                                {savingEdit ? (
                                    <Loader2
                                        size={12}
                                        className="animate-spin mr-1"
                                    />
                                ) : null}
                                Save
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            );
        }

        return (
            <Card
                key={`n-${n.id}`}
                className={`group/card transition-colors ${
                    selectedNodes.has(n.id)
                        ? 'border-emerald-500/50 bg-emerald-500/5'
                        : 'hover:bg-muted/40'
                } ${isLayerGroup ? `border-l-2 ${lColors?.border || ''} bg-muted/20` : ''}`}
            >
                <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={selectedNodes.has(n.id)}
                            onChange={() => toggleNode(n.id)}
                            className="h-4 w-4 rounded border-muted accent-emerald-500 shrink-0 cursor-pointer"
                        />
                        {n.node_type === 'class' ? (
                            <Box
                                size={14}
                                className="text-emerald-400 shrink-0"
                            />
                        ) : (
                            <CircleDot
                                size={14}
                                className="text-violet-400 shrink-0"
                            />
                        )}
                        <span className="text-sm font-medium truncate flex-1">
                            {n.name}
                        </span>
                        {/* Quick actions — visible on hover */}
                        <div className="hidden group-hover/card:flex items-center gap-0.5 shrink-0">
                            <button
                                onClick={e => {
                                    e.stopPropagation();
                                    startEdit(
                                        'node',
                                        n.id,
                                        n.name,
                                        n.description
                                    );
                                }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                                title="Edit"
                            >
                                <Pencil size={12} />
                            </button>
                            <button
                                onClick={e => {
                                    e.stopPropagation();
                                    quickAction('node', n.id, 'approved');
                                }}
                                className="p-1 rounded hover:bg-emerald-500/20 text-muted-foreground hover:text-emerald-400 cursor-pointer"
                                title="Approve"
                            >
                                <Check size={14} />
                            </button>
                            <button
                                onClick={e => {
                                    e.stopPropagation();
                                    quickAction('node', n.id, 'rejected');
                                }}
                                className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 cursor-pointer"
                                title="Reject"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 group-hover/card:hidden">
                            {Math.round(n.confidence * 100)}%
                        </span>
                    </div>
                    {n.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 pl-6">
                            {n.description}
                        </p>
                    )}
                    <div className="flex items-center gap-1.5 pl-6 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">
                            {n.node_type === 'individual'
                                ? 'example'
                                : 'category'}
                        </Badge>
                        {renderLayerBadge(n.layer_id)}
                        {renderBaseItemUri(n.base_item_uri)}
                        {renderProvenance(n.source_document_id)}
                    </div>
                </CardContent>
            </Card>
        );
    };

    // ── Edge card (with quick actions + inline edit) ─────────────────────────

    const renderEdgeCard = (e: any, isLayerGroup: boolean, lColors: any) => {
        const src = nodeMap.get(e.source_node_id);
        const tgt = nodeMap.get(e.target_node_id);
        const isEditing = editingId?.type === 'edge' && editingId.id === e.id;

        if (isEditing) {
            return (
                <Card
                    key={`e-${e.id}`}
                    className="border-violet-500/50 bg-violet-500/5"
                >
                    <CardContent className="p-3 space-y-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                                {src?.name || '?'}
                            </span>
                            <ArrowRight size={12} />
                            <Input
                                value={editName}
                                onChange={ev => setEditName(ev.target.value)}
                                placeholder="Relationship name"
                                className="h-7 text-xs flex-1"
                                autoFocus
                                onKeyDown={ev => {
                                    if (ev.key === 'Escape') cancelEdit();
                                    if (ev.key === 'Enter') {
                                        ev.preventDefault();
                                        saveEdit();
                                    }
                                }}
                            />
                            <ArrowRight size={12} />
                            <span className="font-medium text-foreground">
                                {tgt?.name || e.target_value || '?'}
                            </span>
                        </div>
                        <Textarea
                            value={editDesc}
                            onChange={ev => setEditDesc(ev.target.value)}
                            placeholder="Description (optional)"
                            className="text-xs min-h-10 resize-none"
                            onKeyDown={ev => {
                                if (ev.key === 'Escape') cancelEdit();
                            }}
                        />
                        <div className="flex items-center gap-2 justify-end">
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={cancelEdit}
                                className="h-7 text-xs"
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={saveEdit}
                                disabled={savingEdit || !editName.trim()}
                                className="h-7 text-xs"
                            >
                                {savingEdit ? (
                                    <Loader2
                                        size={12}
                                        className="animate-spin mr-1"
                                    />
                                ) : null}
                                Save
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            );
        }

        return (
            <Card
                key={`e-${e.id}`}
                className={`group/card transition-colors ${
                    selectedEdges.has(e.id)
                        ? 'border-emerald-500/50 bg-emerald-500/5'
                        : 'hover:bg-muted/40'
                } ${isLayerGroup ? `border-l-2 ${lColors?.border || ''} bg-muted/20` : ''}`}
            >
                <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={selectedEdges.has(e.id)}
                            onChange={() => toggleEdge(e.id)}
                            onClick={ev => ev.stopPropagation()}
                            className="h-4 w-4 rounded border-muted accent-emerald-500 shrink-0 cursor-pointer"
                        />
                        <Share2 size={14} className="text-amber-400 shrink-0" />
                        <span className="text-sm truncate flex-1">
                            <span className="font-medium">
                                {src?.name || '?'}
                            </span>
                            <span className="text-muted-foreground mx-1">
                                →
                            </span>
                            <span className="text-emerald-400">
                                {e.name || e.edge_type}
                            </span>
                            <span className="text-muted-foreground mx-1">
                                →
                            </span>
                            <span className="font-medium">
                                {tgt?.name || e.target_value || '?'}
                            </span>
                        </span>
                        {/* Quick actions */}
                        <div className="hidden group-hover/card:flex items-center gap-0.5 shrink-0">
                            <button
                                onClick={ev => {
                                    ev.stopPropagation();
                                    startEdit(
                                        'edge',
                                        e.id,
                                        e.name || e.edge_type,
                                        e.description
                                    );
                                }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                                title="Edit"
                            >
                                <Pencil size={12} />
                            </button>
                            <button
                                onClick={ev => {
                                    ev.stopPropagation();
                                    quickAction('edge', e.id, 'approved');
                                }}
                                className="p-1 rounded hover:bg-emerald-500/20 text-muted-foreground hover:text-emerald-400 cursor-pointer"
                                title="Approve"
                            >
                                <Check size={14} />
                            </button>
                            <button
                                onClick={ev => {
                                    ev.stopPropagation();
                                    quickAction('edge', e.id, 'rejected');
                                }}
                                className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 cursor-pointer"
                                title="Reject"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 group-hover/card:hidden">
                            {Math.round(e.confidence * 100)}%
                        </span>
                    </div>
                    {e.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 pl-6">
                            {e.description}
                        </p>
                    )}
                    <div className="flex items-center gap-1.5 pl-6 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">
                            {e.edge_type}
                        </Badge>
                        {renderLayerBadge(e.layer_id)}
                        {renderBaseItemUri(e.base_item_uri)}
                        {renderProvenance(e.source_document_id)}
                    </div>
                </CardContent>
            </Card>
        );
    };

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Sticky header area */}
            <div className="shrink-0 px-6 pt-6 pb-4 space-y-4 border-b border-border/30 bg-background">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-medium">
                            {totalPending} items pending review
                        </h3>
                        <p className="text-xs text-muted-foreground">
                            Hover any card for quick approve/reject/edit — or
                            select multiple with checkboxes
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <DeduplicateDialog
                            projectId={projectId}
                            onComplete={onReviewComplete}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleImportDecisions}
                            title="Import customer feedback file"
                        >
                            <Upload size={14} className="mr-1" /> Import
                            Feedback
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleShareExport}
                            disabled={!!exportPhase}
                            title="Generate interactive review for customer"
                            className={exportPhase ? 'min-w-40' : ''}
                        >
                            {exportPhase ? (
                                <>
                                    <Loader2
                                        size={14}
                                        className="mr-1 animate-spin"
                                    />
                                    {exportPhase === 'grouping' &&
                                        'Organizing…'}
                                    {exportPhase === 'rendering' &&
                                        'Building file…'}
                                    {exportPhase === 'downloading' &&
                                        'Downloading…'}
                                </>
                            ) : (
                                <>
                                    <Download size={14} className="mr-1" />{' '}
                                    Share for Review
                                </>
                            )}
                        </Button>
                        <div className="w-px h-5 bg-border" />
                        <Button variant="outline" size="sm" onClick={selectAll}>
                            {allVisibleSelected ? 'Deselect All' : 'Select All'}
                        </Button>
                        {hasBaseLayerItems && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleApproveBaseLayerItems}
                                className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                            >
                                <Check size={14} className="mr-1" /> Approve All
                                Base Layer Items
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleApproveAll}
                            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                        >
                            <Check size={14} className="mr-1" /> Approve All
                        </Button>
                    </div>
                </div>

                {/* Layer summary banner */}
                {(() => {
                    const ls = stats?.layerStats;
                    const pendingLayers = (ls?.pending_by_layer || []).filter(
                        (l: any) => l.pending_nodes > 0 || l.pending_edges > 0
                    );
                    if (pendingLayers.length === 0) return null;
                    const autoSet = new Set<string>(ls?.auto_activated || []);
                    return (
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 overflow-hidden">
                            <button
                                onClick={() =>
                                    setBannerCollapsed(prev => !prev)
                                }
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-blue-300 hover:bg-blue-500/10 transition-colors cursor-pointer"
                            >
                                <Layers size={14} className="shrink-0" />
                                <span className="flex-1 text-left">
                                    Latest extraction referenced{' '}
                                    <strong>
                                        {pendingLayers.length} base layer
                                        {pendingLayers.length !== 1 ? 's' : ''}
                                    </strong>
                                    {': '}
                                    {pendingLayers.map((l: any, i: number) => {
                                        const count =
                                            l.pending_nodes + l.pending_edges;
                                        const suffix = autoSet.has(l.layer_slug)
                                            ? ' (auto-activated)'
                                            : ` (${count} item${count !== 1 ? 's' : ''})`;
                                        return (
                                            <span key={l.layer_id}>
                                                {i > 0 && ', '}
                                                <strong>{l.layer_name}</strong>
                                                {suffix}
                                            </span>
                                        );
                                    })}
                                </span>
                                {bannerCollapsed ? (
                                    <ChevronDown size={14} />
                                ) : (
                                    <ChevronUp size={14} />
                                )}
                            </button>
                            {!bannerCollapsed && (
                                <div className="px-3 pb-2.5 flex items-center gap-1.5 flex-wrap">
                                    {pendingLayers.map((l: any) => {
                                        const colors = layerColorMap.get(
                                            l.layer_id
                                        );
                                        const isActive =
                                            sourceFilter === l.layer_id;
                                        return (
                                            <button
                                                key={l.layer_id}
                                                onClick={() =>
                                                    setSourceFilter(
                                                        isActive
                                                            ? 'all'
                                                            : l.layer_id
                                                    )
                                                }
                                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                                    isActive
                                                        ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                                                        : `${colors?.bg || 'bg-muted/50'} ${colors?.text || 'text-muted-foreground'} hover:opacity-80`
                                                }`}
                                            >
                                                {l.layer_name}
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] ml-0.5 px-1 py-0 border-0 bg-transparent"
                                                >
                                                    {l.pending_nodes}N /{' '}
                                                    {l.pending_edges}E
                                                </Badge>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Info callout for base layer items */}
                {hasBaseLayerItems && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-blue-300">
                        <Info size={14} className="shrink-0 mt-0.5" />
                        <span>
                            Items from base layers are standard vocabulary terms
                            detected in your content. Generally safe to approve.
                        </span>
                    </div>
                )}

                {/* Filter bar */}
                <div className="flex items-center gap-3 flex-wrap p-3 rounded-lg bg-muted/30 border">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Filter size={12} />
                        <span>Source:</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <FilterChip
                            active={sourceFilter === 'all'}
                            onClick={() => setSourceFilter('all')}
                        >
                            All
                        </FilterChip>
                        <FilterChip
                            active={sourceFilter === 'extracted'}
                            onClick={() => setSourceFilter('extracted')}
                        >
                            Extracted
                        </FilterChip>
                        {activeLayerIds.map(lid => {
                            const layer = layerMap.get(lid);
                            return (
                                <FilterChip
                                    key={lid}
                                    active={sourceFilter === lid}
                                    onClick={() => setSourceFilter(lid)}
                                >
                                    {layer?.name || `Layer ${lid}`}
                                </FilterChip>
                            );
                        })}
                    </div>

                    <div className="w-px h-5 bg-border" />

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>Type:</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <FilterChip
                            active={typeFilter === 'all'}
                            onClick={() => setTypeFilter('all')}
                        >
                            All
                        </FilterChip>
                        <FilterChip
                            active={typeFilter === 'classes'}
                            onClick={() => setTypeFilter('classes')}
                        >
                            Categories
                        </FilterChip>
                        <FilterChip
                            active={typeFilter === 'examples'}
                            onClick={() => setTypeFilter('examples')}
                        >
                            Examples
                        </FilterChip>
                        <FilterChip
                            active={typeFilter === 'relationships'}
                            onClick={() => setTypeFilter('relationships')}
                        >
                            Relationships
                        </FilterChip>
                    </div>

                    <div className="w-px h-5 bg-border" />

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>Confidence:</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <FilterChip
                            active={confidenceFilter === 'all'}
                            onClick={() => setConfidenceFilter('all')}
                        >
                            All
                        </FilterChip>
                        <FilterChip
                            active={confidenceFilter === 60}
                            onClick={() => setConfidenceFilter(60)}
                        >
                            &gt;60%
                        </FilterChip>
                        <FilterChip
                            active={confidenceFilter === 80}
                            onClick={() => setConfidenceFilter(80)}
                        >
                            &gt;80%
                        </FilterChip>
                    </div>

                    {activeFilterCount > 0 && (
                        <>
                            <div className="w-px h-5 bg-border" />
                            <Badge
                                variant="outline"
                                className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            >
                                {activeFilterCount} active
                            </Badge>
                            <button
                                onClick={clearFilters}
                                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                                Clear filters
                            </button>
                        </>
                    )}
                </div>

                {/* Filtered count */}
                {activeFilterCount > 0 && totalFiltered !== totalPending && (
                    <p className="text-xs text-muted-foreground">
                        Showing {totalFiltered} of {totalPending} items
                    </p>
                )}

                {/* Selection bar */}
                {visibleSelectedCount > 0 && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
                        <span className="text-sm">
                            {visibleSelectedCount} selected
                        </span>
                        <Button
                            size="sm"
                            variant="outline"
                            className="text-emerald-400"
                            onClick={() => handleReview('approved')}
                        >
                            <Check size={14} className="mr-1" /> Approve
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="text-red-400"
                            onClick={() => handleReview('rejected')}
                        >
                            <X size={14} className="mr-1" /> Reject
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground ml-auto"
                            onClick={deselectAll}
                        >
                            Clear selection
                        </Button>
                    </div>
                )}

                {/* Layer-specific bulk approve */}
                {typeof sourceFilter === 'number' && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleApproveLayerItems(sourceFilter)}
                        className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                    >
                        <Check size={14} className="mr-1" /> Approve All{' '}
                        {layerMap.get(sourceFilter)?.name || 'Layer'} Items
                    </Button>
                )}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4 space-y-4">
                {/* Grouped items */}
                {groups.map(group => {
                    const groupTotal = group.nodes.length + group.edges.length;
                    const isCollapsed = collapsedGroups.has(group.key);
                    const isLayerGroup = group.layerId !== null;
                    const lColors = group.layerId
                        ? layerColorMap.get(group.layerId)
                        : null;

                    return (
                        <div key={group.key} className="space-y-1.5">
                            {/* Group header */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() =>
                                        toggleGroupCollapse(group.key)
                                    }
                                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer uppercase tracking-wide"
                                >
                                    {isCollapsed ? (
                                        <ChevronRight size={14} />
                                    ) : (
                                        <ChevronDown size={14} />
                                    )}
                                    {group.label} ({groupTotal})
                                </button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs h-6 px-2"
                                    onClick={() => selectGroup(group)}
                                >
                                    Select Group
                                </Button>
                            </div>

                            {!isCollapsed && (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
                                    {group.nodes.map((n: any) =>
                                        renderNodeCard(n, isLayerGroup, lColors)
                                    )}
                                    {group.edges.map((e: any) =>
                                        renderEdgeCard(e, isLayerGroup, lColors)
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                {totalFiltered === 0 && activeFilterCount > 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                        <p className="text-sm">
                            No items match the current filters.
                        </p>
                        <button
                            onClick={clearFilters}
                            className="text-xs text-emerald-400 hover:underline mt-1 cursor-pointer"
                        >
                            Clear filters
                        </button>
                    </div>
                )}
            </div>

            {/* Pinned bottom sheet — Layer Suggestions */}
            <LayerSuggestionsPanel
                projectId={projectId}
                onComplete={onReviewComplete}
            />
        </div>
    );
}
