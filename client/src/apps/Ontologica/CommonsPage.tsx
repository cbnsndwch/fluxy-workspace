// oxlint-disable no-console
import {
    ArrowUpRight,
    Check,
    Globe,
    Layers,
    Loader2,
    Plus,
    RefreshCw,
    Search,
    Sparkles,
    Trash2,
    X
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AppLayout } from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface CommonsLayer {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    namespace: string;
    version: string;
    category: string;
    dependencies: string[];
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

interface LayerItem {
    id: number;
    layer_id: number;
    item_type: string;
    name: string;
    uri: string;
    description: string | null;
    properties: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

interface CommonsCandidate {
    id: number;
    pattern_type: string;
    name: string;
    description: string | null;
    uri_suggestion: string | null;
    source_projects: string[];
    occurrence_count: number;
    first_seen: string;
    last_seen: string;
    status: string;
    promoted_to_layer_id: number | null;
}

interface CommonsStats {
    totalLayers: number;
    totalItems: number;
    totalCandidates: number;
    promotedCount: number;
    rejectedCount: number;
}

interface LayerWithItems extends CommonsLayer {
    items: LayerItem[];
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const API = '/app/api/ontologica/commons';

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...opts
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
            (body as Record<string, string>).error || `HTTP ${res.status}`
        );
    }
    return res.json();
}

function timeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.max(0, now - then);
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

const PATTERN_COLORS: Record<string, string> = {
    class: 'bg-blue-500/10 text-blue-500',
    property: 'bg-emerald-500/10 text-emerald-500',
    relationship: 'bg-purple-500/10 text-purple-500'
};

/* ─── Components ─────────────────────────────────────────────────────────── */

function StatsBar({ stats }: { stats: CommonsStats | null }) {
    if (!stats) return null;
    const items = [
        { label: 'Layers', value: stats.totalLayers, color: 'text-blue-500' },
        { label: 'Items', value: stats.totalItems, color: 'text-emerald-500' },
        {
            label: 'Candidates',
            value: stats.totalCandidates,
            color: 'text-amber-500'
        },
        {
            label: 'Promoted',
            value: stats.promotedCount,
            color: 'text-green-500'
        },
        {
            label: 'Rejected',
            value: stats.rejectedCount,
            color: 'text-red-400'
        }
    ];
    return (
        <div className="flex items-center gap-6 px-6 py-3 border-b border-border/40">
            {items.map(item => (
                <div
                    key={item.label}
                    className="flex items-center gap-1.5 text-sm"
                >
                    <span
                        className={cn('font-semibold tabular-nums', item.color)}
                    >
                        {item.value}
                    </span>
                    <span className="text-muted-foreground">{item.label}</span>
                </div>
            ))}
        </div>
    );
}

/* ── Layers Tab ──────────────────────────────────────────────────────────── */

function LayersTab({
    layers,
    onRefresh,
    loading
}: {
    layers: CommonsLayer[];
    onRefresh: () => void;
    loading: boolean;
}) {
    const [showCreate, setShowCreate] = useState(false);
    const [selectedLayer, setSelectedLayer] = useState<LayerWithItems | null>(
        null
    );
    const [showAddItem, setShowAddItem] = useState(false);
    const [loadingLayer, setLoadingLayer] = useState(false);

    // Create layer form
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newDeps, setNewDeps] = useState('');
    const [creating, setCreating] = useState(false);

    // Add item form
    const [itemType, setItemType] = useState('class');
    const [itemName, setItemName] = useState('');
    const [itemUri, setItemUri] = useState('');
    const [itemDesc, setItemDesc] = useState('');
    const [addingItem, setAddingItem] = useState(false);

    const createLayer = useCallback(async () => {
        if (!newName.trim()) return;
        setCreating(true);
        try {
            await apiFetch('', {
                method: 'POST',
                body: JSON.stringify({
                    name: newName.trim(),
                    description: newDesc.trim() || undefined,
                    dependencies: newDeps
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
                })
            });
            setNewName('');
            setNewDesc('');
            setNewDeps('');
            setShowCreate(false);
            onRefresh();
        } catch (err) {
            console.error('Failed to create layer:', err);
        } finally {
            setCreating(false);
        }
    }, [newName, newDesc, newDeps, onRefresh]);

    const loadLayerDetails = useCallback(async (id: number) => {
        setLoadingLayer(true);
        try {
            const data = await apiFetch<LayerWithItems>(`/${id}`);
            setSelectedLayer(data);
        } catch (err) {
            console.error('Failed to load layer:', err);
        } finally {
            setLoadingLayer(false);
        }
    }, []);

    const deleteLayer = useCallback(
        async (id: number) => {
            try {
                await apiFetch(`/${id}`, { method: 'DELETE' });
                setSelectedLayer(null);
                onRefresh();
            } catch (err) {
                console.error('Failed to delete layer:', err);
            }
        },
        [onRefresh]
    );

    const addItem = useCallback(async () => {
        if (!selectedLayer || !itemName.trim() || !itemUri.trim()) return;
        setAddingItem(true);
        try {
            await apiFetch(`/${selectedLayer.id}/items`, {
                method: 'POST',
                body: JSON.stringify({
                    item_type: itemType,
                    name: itemName.trim(),
                    uri: itemUri.trim(),
                    description: itemDesc.trim() || undefined
                })
            });
            setItemName('');
            setItemUri('');
            setItemDesc('');
            setShowAddItem(false);
            loadLayerDetails(selectedLayer.id);
        } catch (err) {
            console.error('Failed to add item:', err);
        } finally {
            setAddingItem(false);
        }
    }, [
        selectedLayer,
        itemType,
        itemName,
        itemUri,
        itemDesc,
        loadLayerDetails
    ]);

    const deleteItem = useCallback(
        async (layerId: number, itemId: number) => {
            try {
                await apiFetch(`/${layerId}/items/${itemId}`, {
                    method: 'DELETE'
                });
                loadLayerDetails(layerId);
            } catch (err) {
                console.error('Failed to delete item:', err);
            }
        },
        [loadLayerDetails]
    );

    return (
        <div className="flex h-full">
            {/* Left: Layer list */}
            <div className="w-80 border-r border-border/50 flex flex-col shrink-0">
                <div className="flex items-center justify-between p-4 border-b border-border/40">
                    <h3 className="text-sm font-semibold">Commons Layers</h3>
                    <div className="flex gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onRefresh}
                            disabled={loading}
                        >
                            <RefreshCw
                                className={cn(
                                    'size-3.5',
                                    loading && 'animate-spin'
                                )}
                            />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowCreate(true)}
                        >
                            <Plus className="size-3.5" />
                        </Button>
                    </div>
                </div>

                <ScrollArea className="flex-1">
                    <div className="p-2 space-y-1">
                        {layers.length === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                No commons layers yet.
                            </p>
                        )}
                        {layers.map(layer => (
                            <button
                                key={layer.id}
                                onClick={() => loadLayerDetails(layer.id)}
                                className={cn(
                                    'w-full text-left px-3 py-2 rounded-md hover:bg-muted/60 transition-colors',
                                    selectedLayer?.id === layer.id && 'bg-muted'
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <Layers className="size-3.5 text-blue-500 shrink-0" />
                                    <span className="text-sm font-medium truncate">
                                        {layer.name}
                                    </span>
                                    {!layer.is_active && (
                                        <Badge
                                            variant="secondary"
                                            className="text-[10px] px-1 py-0"
                                        >
                                            disabled
                                        </Badge>
                                    )}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                                    v{layer.version} &middot; {layer.slug}
                                </div>
                            </button>
                        ))}
                    </div>
                </ScrollArea>
            </div>

            {/* Right: Layer detail */}
            <div className="flex-1 overflow-auto">
                {loadingLayer && (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                )}

                {!loadingLayer && !selectedLayer && (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <Layers className="size-10 opacity-30" />
                        <p className="text-sm">
                            Select a layer to view its items
                        </p>
                    </div>
                )}

                {!loadingLayer && selectedLayer && (
                    <div className="p-6 space-y-6">
                        <div className="flex items-start justify-between">
                            <div>
                                <h2 className="text-lg font-semibold">
                                    {selectedLayer.name}
                                </h2>
                                {selectedLayer.description && (
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {selectedLayer.description}
                                    </p>
                                )}
                                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                    <span>v{selectedLayer.version}</span>
                                    <span>{selectedLayer.namespace}</span>
                                    {selectedLayer.dependencies.length > 0 && (
                                        <span>
                                            Deps:{' '}
                                            {selectedLayer.dependencies.join(
                                                ', '
                                            )}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowAddItem(true)}
                                >
                                    <Plus className="size-3.5 mr-1" /> Add Item
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() =>
                                        deleteLayer(selectedLayer.id)
                                    }
                                >
                                    <Trash2 className="size-3.5" />
                                </Button>
                            </div>
                        </div>

                        <Separator />

                        <div>
                            <h3 className="text-sm font-semibold mb-3">
                                Items ({selectedLayer.items.length})
                            </h3>
                            {selectedLayer.items.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                    No items in this layer yet.
                                </p>
                            )}
                            <div className="space-y-2">
                                {selectedLayer.items.map(item => (
                                    <div
                                        key={item.id}
                                        className="flex items-center justify-between px-3 py-2 rounded-md border border-border/50 bg-card"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <Badge
                                                variant="secondary"
                                                className={cn(
                                                    'text-[10px] shrink-0',
                                                    PATTERN_COLORS[
                                                        item.item_type
                                                    ]
                                                )}
                                            >
                                                {item.item_type}
                                            </Badge>
                                            <span className="text-sm font-medium truncate">
                                                {item.name}
                                            </span>
                                            <span className="text-xs text-muted-foreground truncate">
                                                {item.uri}
                                            </span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="shrink-0 text-destructive hover:text-destructive"
                                            onClick={() =>
                                                deleteItem(
                                                    selectedLayer.id,
                                                    item.id
                                                )
                                            }
                                        >
                                            <Trash2 className="size-3" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Create layer dialog */}
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Commons Layer</DialogTitle>
                        <DialogDescription>
                            Create a new orthogonal commons layer with its own
                            namespace and identity.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Name</Label>
                            <Input
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="e.g., Temporal Concepts"
                            />
                        </div>
                        <div>
                            <Label>Description</Label>
                            <Textarea
                                value={newDesc}
                                onChange={e => setNewDesc(e.target.value)}
                                placeholder="What does this layer contain?"
                                rows={2}
                            />
                        </div>
                        <div>
                            <Label>Dependencies (comma-separated slugs)</Label>
                            <Input
                                value={newDeps}
                                onChange={e => setNewDeps(e.target.value)}
                                placeholder="e.g., core-types, relationships"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowCreate(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={createLayer}
                            disabled={!newName.trim() || creating}
                        >
                            {creating && (
                                <Loader2 className="size-3.5 mr-1 animate-spin" />
                            )}
                            Create Layer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Add item dialog */}
            <Dialog open={showAddItem} onOpenChange={setShowAddItem}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            Add Item to {selectedLayer?.name}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Type</Label>
                            <Select
                                value={itemType}
                                onValueChange={setItemType}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="class">Class</SelectItem>
                                    <SelectItem value="property">
                                        Property
                                    </SelectItem>
                                    <SelectItem value="relationship">
                                        Relationship
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Name</Label>
                            <Input
                                value={itemName}
                                onChange={e => setItemName(e.target.value)}
                                placeholder="e.g., TemporalEntity"
                            />
                        </div>
                        <div>
                            <Label>URI</Label>
                            <Input
                                value={itemUri}
                                onChange={e => setItemUri(e.target.value)}
                                placeholder={
                                    selectedLayer
                                        ? `${selectedLayer.namespace}${itemName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'item-name'}`
                                        : 'https://ontologica.app/commons/...'
                                }
                            />
                        </div>
                        <div>
                            <Label>Description</Label>
                            <Textarea
                                value={itemDesc}
                                onChange={e => setItemDesc(e.target.value)}
                                placeholder="Optional description"
                                rows={2}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowAddItem(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={addItem}
                            disabled={
                                !itemName.trim() ||
                                !itemUri.trim() ||
                                addingItem
                            }
                        >
                            {addingItem && (
                                <Loader2 className="size-3.5 mr-1 animate-spin" />
                            )}
                            Add Item
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/* ── Candidates Tab ──────────────────────────────────────────────────────── */

function CandidatesTab({
    candidates,
    layers,
    onRefresh,
    loading
}: {
    candidates: CommonsCandidate[];
    layers: CommonsLayer[];
    onRefresh: () => void;
    loading: boolean;
}) {
    const [showCreate, setShowCreate] = useState(false);
    const [showPromote, setShowPromote] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [targetLayerId, setTargetLayerId] = useState<string>('');
    const [filter, setFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('candidate');
    const [promoting, setPromoting] = useState(false);

    // Create candidate form
    const [cType, setCType] = useState('class');
    const [cName, setCName] = useState('');
    const [cDesc, setCDesc] = useState('');
    const [cUri, setCUri] = useState('');
    const [cOccurrences, setCOccurrences] = useState('1');
    const [creatingCandidate, setCreatingCandidate] = useState(false);

    const toggleSelect = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const filtered = candidates.filter(c => {
        if (statusFilter && c.status !== statusFilter) return false;
        if (filter) {
            const q = filter.toLowerCase();
            return (
                c.name.toLowerCase().includes(q) ||
                (c.description || '').toLowerCase().includes(q)
            );
        }
        return true;
    });

    const promote = useCallback(async () => {
        if (selectedIds.size === 0 || !targetLayerId) return;
        setPromoting(true);
        try {
            await apiFetch('/promote', {
                method: 'POST',
                body: JSON.stringify({
                    candidate_ids: Array.from(selectedIds),
                    layer_id: Number(targetLayerId)
                })
            });
            setSelectedIds(new Set());
            setShowPromote(false);
            setTargetLayerId('');
            onRefresh();
        } catch (err) {
            console.error('Failed to promote:', err);
        } finally {
            setPromoting(false);
        }
    }, [selectedIds, targetLayerId, onRefresh]);

    const rejectCandidate = useCallback(
        async (id: number) => {
            try {
                await apiFetch(`/candidates/${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: 'rejected' })
                });
                onRefresh();
            } catch (err) {
                console.error('Failed to reject:', err);
            }
        },
        [onRefresh]
    );

    const createCandidate = useCallback(async () => {
        if (!cName.trim()) return;
        setCreatingCandidate(true);
        try {
            await apiFetch('/candidates', {
                method: 'POST',
                body: JSON.stringify({
                    pattern_type: cType,
                    name: cName.trim(),
                    description: cDesc.trim() || undefined,
                    uri_suggestion: cUri.trim() || undefined,
                    occurrence_count: Math.max(
                        1,
                        parseInt(cOccurrences, 10) || 1
                    )
                })
            });
            setCName('');
            setCDesc('');
            setCUri('');
            setCOccurrences('1');
            setShowCreate(false);
            onRefresh();
        } catch (err) {
            console.error('Failed to create candidate:', err);
        } finally {
            setCreatingCandidate(false);
        }
    }, [cType, cName, cDesc, cUri, cOccurrences, onRefresh]);

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-6 py-3 border-b border-border/40">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        placeholder="Filter candidates..."
                        className="pl-8 h-8"
                    />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-36 h-8">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="candidate">Candidates</SelectItem>
                        <SelectItem value="promoted">Promoted</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                </Select>
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRefresh}
                    disabled={loading}
                >
                    <RefreshCw
                        className={cn('size-3.5', loading && 'animate-spin')}
                    />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCreate(true)}
                >
                    <Plus className="size-3.5 mr-1" /> Add Candidate
                </Button>
                {selectedIds.size > 0 && (
                    <Button size="sm" onClick={() => setShowPromote(true)}>
                        <ArrowUpRight className="size-3.5 mr-1" /> Promote (
                        {selectedIds.size})
                    </Button>
                )}
            </div>

            {/* Candidate list */}
            <ScrollArea className="flex-1">
                <div className="p-6 space-y-2">
                    {filtered.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-12">
                            {statusFilter === 'candidate'
                                ? 'No candidates yet. Patterns appearing in 3+ projects will surface here.'
                                : `No ${statusFilter} candidates.`}
                        </p>
                    )}
                    {filtered.map(c => (
                        <div
                            key={c.id}
                            className={cn(
                                'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
                                selectedIds.has(c.id)
                                    ? 'border-primary/50 bg-primary/5'
                                    : 'border-border/50 bg-card',
                                c.status !== 'candidate' && 'opacity-60'
                            )}
                        >
                            {c.status === 'candidate' && (
                                <button
                                    onClick={() => toggleSelect(c.id)}
                                    className={cn(
                                        'size-4 rounded border shrink-0 flex items-center justify-center transition-colors',
                                        selectedIds.has(c.id)
                                            ? 'bg-primary border-primary text-primary-foreground'
                                            : 'border-border'
                                    )}
                                >
                                    {selectedIds.has(c.id) && (
                                        <Check className="size-3" />
                                    )}
                                </button>
                            )}

                            <Badge
                                variant="secondary"
                                className={cn(
                                    'text-[10px] shrink-0',
                                    PATTERN_COLORS[c.pattern_type]
                                )}
                            >
                                {c.pattern_type}
                            </Badge>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">
                                        {c.name}
                                    </span>
                                    <Badge
                                        variant="outline"
                                        className="text-[10px]"
                                    >
                                        {c.occurrence_count}x
                                    </Badge>
                                </div>
                                {c.description && (
                                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                                        {c.description}
                                    </p>
                                )}
                                {c.uri_suggestion && (
                                    <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                                        {c.uri_suggestion}
                                    </p>
                                )}
                            </div>

                            <span className="text-xs text-muted-foreground shrink-0">
                                {timeAgo(c.last_seen)}
                            </span>

                            {c.status === 'candidate' && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="shrink-0 text-destructive hover:text-destructive"
                                    onClick={() => rejectCandidate(c.id)}
                                >
                                    <X className="size-3.5" />
                                </Button>
                            )}

                            {c.status === 'promoted' && (
                                <Badge className="text-[10px] bg-green-500/10 text-green-500">
                                    promoted
                                </Badge>
                            )}
                            {c.status === 'rejected' && (
                                <Badge className="text-[10px] bg-red-500/10 text-red-400">
                                    rejected
                                </Badge>
                            )}
                        </div>
                    ))}
                </div>
            </ScrollArea>

            {/* Promote dialog */}
            <Dialog open={showPromote} onOpenChange={setShowPromote}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Promote Candidates</DialogTitle>
                        <DialogDescription>
                            Select a commons layer to promote {selectedIds.size}{' '}
                            candidate(s) into. Items will be created in the
                            target layer.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Target Commons Layer</Label>
                            <Select
                                value={targetLayerId}
                                onValueChange={setTargetLayerId}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a layer..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {layers.map(l => (
                                        <SelectItem
                                            key={l.id}
                                            value={String(l.id)}
                                        >
                                            {l.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {layers.length === 0 && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    No commons layers exist yet. Create one
                                    first.
                                </p>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowPromote(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={promote}
                            disabled={!targetLayerId || promoting}
                        >
                            {promoting && (
                                <Loader2 className="size-3.5 mr-1 animate-spin" />
                            )}
                            Promote {selectedIds.size} Candidate(s)
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Create candidate dialog */}
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Candidate</DialogTitle>
                        <DialogDescription>
                            Manually register a cross-project pattern as a
                            promotion candidate.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Pattern Type</Label>
                            <Select value={cType} onValueChange={setCType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="class">Class</SelectItem>
                                    <SelectItem value="property">
                                        Property
                                    </SelectItem>
                                    <SelectItem value="relationship">
                                        Relationship
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Name</Label>
                            <Input
                                value={cName}
                                onChange={e => setCName(e.target.value)}
                                placeholder="e.g., TemporalEntity"
                            />
                        </div>
                        <div>
                            <Label>Description</Label>
                            <Textarea
                                value={cDesc}
                                onChange={e => setCDesc(e.target.value)}
                                placeholder="What does this pattern represent?"
                                rows={2}
                            />
                        </div>
                        <div>
                            <Label>URI Suggestion</Label>
                            <Input
                                value={cUri}
                                onChange={e => setCUri(e.target.value)}
                                placeholder="https://ontologica.app/commons/..."
                            />
                        </div>
                        <div>
                            <Label>Occurrence Count</Label>
                            <Input
                                type="number"
                                min="1"
                                value={cOccurrences}
                                onChange={e => setCOccurrences(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowCreate(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={createCandidate}
                            disabled={!cName.trim() || creatingCandidate}
                        >
                            {creatingCandidate && (
                                <Loader2 className="size-3.5 mr-1 animate-spin" />
                            )}
                            Add Candidate
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */

export default function CommonsPage() {
    const [layers, setLayers] = useState<CommonsLayer[]>([]);
    const [candidates, setCandidates] = useState<CommonsCandidate[]>([]);
    const [stats, setStats] = useState<CommonsStats | null>(null);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [layerData, candidateData, statsData] = await Promise.all([
                apiFetch<CommonsLayer[]>(''),
                apiFetch<CommonsCandidate[]>('/candidates'),
                apiFetch<CommonsStats>('/stats')
            ]);
            setLayers(layerData);
            setCandidates(candidateData);
            setStats(statsData);
        } catch (err) {
            console.error('Failed to load commons data:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return (
        <AppLayout
            icon={<Globe className="size-5" />}
            iconClassName="bg-indigo-500/10 text-indigo-500"
            title="Ontologica"
            subtitle="Commons layer management and promotion workflow"
        >
            <StatsBar stats={stats} />

            <Tabs
                defaultValue="layers"
                className="flex-1 flex flex-col overflow-hidden"
            >
                <div className="px-6 pt-3">
                    <TabsList>
                        <TabsTrigger value="layers">
                            <Layers className="size-3.5 mr-1" /> Layers
                        </TabsTrigger>
                        <TabsTrigger value="candidates">
                            <Sparkles className="size-3.5 mr-1" /> Candidates
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="layers" className="flex-1 overflow-hidden">
                    <LayersTab
                        layers={layers}
                        onRefresh={refresh}
                        loading={loading}
                    />
                </TabsContent>

                <TabsContent
                    value="candidates"
                    className="flex-1 overflow-hidden"
                >
                    <CandidatesTab
                        candidates={candidates}
                        layers={layers}
                        onRefresh={refresh}
                        loading={loading}
                    />
                </TabsContent>
            </Tabs>
        </AppLayout>
    );
}
