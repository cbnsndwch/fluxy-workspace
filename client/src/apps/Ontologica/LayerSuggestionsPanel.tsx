import {
    Sparkles,
    Loader2,
    Check,
    X,
    GitMerge,
    Link2,
    ChevronDown,
    Search
} from 'lucide-react';
import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface LayerSuggestion {
    node_id: number;
    node_name: string;
    node_description: string | null;
    node_type: string;
    match: {
        item_id: number;
        layer_id: number;
        layer_name: string;
        layer_slug: string;
        uri: string;
        label: string;
        local_name: string;
        description: string | null;
        item_type: string;
        parent_uri: string | null;
    };
    similarity: number;
    match_type?: 'same' | 'is_a' | 'related';
}

const MATCH_TYPE_LABELS: Record<string, { label: string; color: string }> = {
    same: { label: 'Same as', color: 'text-emerald-400 bg-emerald-500/10' },
    is_a: { label: 'Is a type of', color: 'text-amber-400 bg-amber-500/10' },
    related: { label: 'Related to', color: 'text-blue-400 bg-blue-500/10' }
};

const SIMILARITY_PRESETS = [
    { label: '60%', value: 0.6 },
    { label: '70%', value: 0.7 },
    { label: '80%', value: 0.8 },
    { label: '85%', value: 0.85 },
    { label: '90%', value: 0.9 },
    { label: '95%', value: 0.95 }
];

interface Props {
    projectId: number;
    onComplete: () => void;
}

export function LayerSuggestionsPanel({ projectId, onComplete }: Props) {
    const [suggestions, setSuggestions] = useState<LayerSuggestion[]>([]);
    const [scanning, setScanning] = useState(false);
    const [scanned, setScanned] = useState(false);
    const [open, setOpen] = useState(false);
    const [threshold, setThreshold] = useState(0.7);
    const [processing, setProcessing] = useState<Set<number>>(new Set());
    const [heightPx, setHeightPx] = useState<number | null>(null);
    const dragging = useRef(false);
    const panelRef = useRef<HTMLDivElement>(null);

    const getParentHeight = useCallback(() => {
        if (!panelRef.current?.parentElement) return 600;
        return panelRef.current.parentElement.clientHeight;
    }, []);

    const handleToggle = useCallback(() => {
        setOpen(prev => {
            if (!prev && !heightPx) {
                setHeightPx(Math.round(getParentHeight() * 0.38));
            }
            return !prev;
        });
    }, [heightPx, getParentHeight]);

    const handleDragStart = useCallback(
        (e: React.MouseEvent | React.TouchEvent) => {
            e.preventDefault();
            dragging.current = true;
            const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            const startH = heightPx || Math.round(getParentHeight() * 0.38);
            const parentH = getParentHeight();
            const minH = Math.round(parentH * 0.15);
            const maxH = Math.round(parentH * 0.85);

            const onMove = (ev: MouseEvent | TouchEvent) => {
                if (!dragging.current) return;
                const clientY =
                    'touches' in ev ? ev.touches[0].clientY : ev.clientY;
                const delta = startY - clientY;
                setHeightPx(Math.max(minH, Math.min(maxH, startH + delta)));
            };
            const onUp = () => {
                dragging.current = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove);
            document.addEventListener('touchend', onUp);
        },
        [heightPx, getParentHeight]
    );

    const scan = useCallback(
        async (overrideThreshold?: number) => {
            const t = overrideThreshold ?? threshold;
            setScanning(true);
            try {
                const res = await fetch(
                    `/app/api/ontologica/projects/${projectId}/layer-suggestions?threshold=${t}`
                );
                if (!res.ok) throw new Error('Scan failed');
                const data = await res.json();
                setSuggestions(data.suggestions);
                setScanned(true);
                if (data.suggestions.length === 0) {
                    toast.info('No base layer matches found');
                }
            } catch (e: any) {
                toast.error(e.message || 'Failed to scan');
            } finally {
                setScanning(false);
            }
        },
        [projectId, threshold]
    );

    // Next lower preset that could reveal more matches
    const nextLowerPreset =
        scanned && suggestions.length === 0
            ? (SIMILARITY_PRESETS.slice()
                  .reverse()
                  .find(p => p.value < threshold - 0.005) ?? null)
            : null;

    const handleAccept = useCallback(
        async (s: LayerSuggestion) => {
            setProcessing(prev => new Set(prev).add(s.node_id));
            try {
                const res = await fetch(
                    `/app/api/ontologica/projects/${projectId}/layer-suggestions/accept`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            node_id: s.node_id,
                            item_id: s.match.item_id,
                            layer_id: s.match.layer_id,
                            base_item_uri: s.match.uri
                        })
                    }
                );
                if (!res.ok) throw new Error('Failed');
                setSuggestions(prev =>
                    prev.filter(x => x.node_id !== s.node_id)
                );
                toast.success(`Linked "${s.node_name}" → ${s.match.label}`);
                onComplete();
            } catch {
                toast.error('Failed to accept suggestion');
            } finally {
                setProcessing(prev => {
                    const n = new Set(prev);
                    n.delete(s.node_id);
                    return n;
                });
            }
        },
        [projectId, onComplete]
    );

    const handleSubclass = useCallback(
        async (s: LayerSuggestion) => {
            setProcessing(prev => new Set(prev).add(s.node_id));
            try {
                const res = await fetch(
                    `/app/api/ontologica/projects/${projectId}/layer-suggestions/subclass`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            node_id: s.node_id,
                            item_id: s.match.item_id,
                            layer_id: s.match.layer_id,
                            base_item_uri: s.match.uri,
                            base_item_name: s.match.label || s.match.local_name
                        })
                    }
                );
                if (!res.ok) throw new Error('Failed');
                setSuggestions(prev =>
                    prev.filter(x => x.node_id !== s.node_id)
                );
                toast.success(
                    `"${s.node_name}" is now a type of ${s.match.label}`
                );
                onComplete();
            } catch {
                toast.error('Failed to create subclass relationship');
            } finally {
                setProcessing(prev => {
                    const n = new Set(prev);
                    n.delete(s.node_id);
                    return n;
                });
            }
        },
        [projectId, onComplete]
    );

    const handleDismiss = useCallback(
        async (s: LayerSuggestion) => {
            setProcessing(prev => new Set(prev).add(s.node_id));
            try {
                await fetch(
                    `/app/api/ontologica/projects/${projectId}/layer-suggestions/dismiss`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            node_id: s.node_id,
                            item_id: s.match.item_id
                        })
                    }
                );
                setSuggestions(prev =>
                    prev.filter(x => x.node_id !== s.node_id)
                );
            } catch {
                toast.error('Failed to dismiss');
            } finally {
                setProcessing(prev => {
                    const n = new Set(prev);
                    n.delete(s.node_id);
                    return n;
                });
            }
        },
        [projectId]
    );

    return (
        <div
            ref={panelRef}
            className={cn(
                'border-t border-border/50 flex flex-col shrink-0',
                open && 'overflow-hidden'
            )}
            style={open && heightPx ? { height: heightPx } : undefined}
        >
            {/* Drag handle — only when open */}
            {open && (
                <div
                    role="separator"
                    className="h-2 cursor-row-resize hover:bg-amber-500/20 active:bg-amber-500/30 transition-colors flex items-center justify-center shrink-0 group"
                    onMouseDown={handleDragStart}
                    onTouchStart={handleDragStart}
                >
                    <div className="w-10 h-0.5 rounded-full bg-border group-hover:bg-amber-500/50 transition-colors" />
                </div>
            )}

            {/* Toggle header */}
            <button
                className="flex items-center gap-2 w-full px-5 py-2 hover:bg-muted/20 transition-colors text-left shrink-0 cursor-pointer"
                onClick={handleToggle}
            >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-medium text-muted-foreground flex-1">
                    Base Layer Suggestions
                    {suggestions.length > 0 && (
                        <span className="ml-1.5 text-amber-400">
                            {' '}
                            ● {suggestions.length} match
                            {suggestions.length !== 1 ? 'es' : ''}
                        </span>
                    )}
                </span>
                <ChevronDown
                    className={cn(
                        'h-3.5 w-3.5 text-muted-foreground transition-transform',
                        open && 'rotate-180'
                    )}
                />
            </button>

            {/* Expanded content */}
            {open && (
                <div className="flex-1 overflow-y-auto min-h-0 px-5 pb-3">
                    {/* Controls bar */}
                    <div className="sticky top-0 bg-background z-10 pb-2 pt-1">
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                Similarity:
                            </span>
                            <Slider
                                min={50}
                                max={95}
                                step={1}
                                value={[Math.round(threshold * 100)]}
                                onValueChange={([v]) => setThreshold(v / 100)}
                                className="flex-1 max-w-[200px] [&_[data-slot=slider-range]]:bg-amber-500 [&_[data-slot=slider-thumb]]:border-amber-500 [&_[data-slot=slider-thumb]]:hover:ring-amber-500/30 [&_[data-slot=slider-thumb]]:focus-visible:ring-amber-500/30"
                            />
                            <span className="text-xs font-mono w-10 text-right">
                                {Math.round(threshold * 100)}%
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => scan()}
                                disabled={scanning}
                            >
                                {scanning ? (
                                    <>
                                        <Loader2
                                            size={12}
                                            className="mr-1 animate-spin"
                                        />{' '}
                                        Scanning…
                                    </>
                                ) : (
                                    <>
                                        <Search size={12} className="mr-1" />{' '}
                                        {scanned ? 'Rescan' : 'Find Matches'}
                                    </>
                                )}
                            </Button>
                            {nextLowerPreset && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                                    onClick={() => {
                                        setThreshold(nextLowerPreset.value);
                                        scan(nextLowerPreset.value);
                                    }}
                                    disabled={scanning}
                                >
                                    <ChevronDown size={12} className="mr-1" />{' '}
                                    {nextLowerPreset.label}
                                </Button>
                            )}
                        </div>
                        {/* Presets */}
                        <div className="flex items-center gap-1 mt-1.5 pl-[68px]">
                            {SIMILARITY_PRESETS.map(p => (
                                <button
                                    key={p.value}
                                    onClick={() => {
                                        setThreshold(p.value);
                                        scan(p.value);
                                    }}
                                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                                        Math.abs(threshold - p.value) < 0.005
                                            ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                    }`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Empty states */}
                    {!scanned && !scanning && (
                        <div className="text-center py-8 text-muted-foreground">
                            <Sparkles
                                size={24}
                                className="mx-auto mb-2 text-amber-400 opacity-50"
                            />
                            <p className="text-sm">
                                Scan your custom items against base vocabulary
                                layers
                            </p>
                            <p className="text-xs mt-1">
                                Finds items that may duplicate or extend
                                standard vocabulary terms
                            </p>
                        </div>
                    )}

                    {scanning && (
                        <div className="text-center py-8 text-muted-foreground">
                            <Loader2
                                size={24}
                                className="mx-auto mb-2 animate-spin text-amber-400"
                            />
                            <p className="text-sm">Analyzing matches…</p>
                            <p className="text-xs mt-1 opacity-60">
                                Embedding similarity + LLM semantic evaluation
                            </p>
                        </div>
                    )}

                    {scanned && suggestions.length === 0 && !scanning && (
                        <div className="text-center py-6 text-muted-foreground">
                            <Check
                                size={20}
                                className="mx-auto mb-1 text-emerald-400 opacity-50"
                            />
                            <p className="text-xs">
                                No matches found at{' '}
                                {Math.round(threshold * 100)}% similarity
                            </p>
                            {nextLowerPreset ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setThreshold(nextLowerPreset.value);
                                        scan(nextLowerPreset.value);
                                    }}
                                    className="mt-3 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                                >
                                    <ChevronDown size={14} className="mr-1" />{' '}
                                    Jump to {nextLowerPreset.label}
                                </Button>
                            ) : (
                                <p className="text-xs mt-1 opacity-60">
                                    No more matches at any threshold
                                </p>
                            )}
                        </div>
                    )}

                    {/* Suggestion cards */}
                    {suggestions.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                            {suggestions.map(s => {
                                const isProcessing = processing.has(s.node_id);
                                return (
                                    <Card
                                        key={s.node_id}
                                        className={cn(
                                            'transition-opacity flex flex-col',
                                            isProcessing && 'opacity-50'
                                        )}
                                    >
                                        <CardContent className="p-3 flex flex-col flex-1">
                                            {/* Custom node */}
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className={cn(
                                                            'w-2 h-2 rounded-full shrink-0',
                                                            s.node_type ===
                                                                'class'
                                                                ? 'bg-emerald-400'
                                                                : 'bg-violet-400'
                                                        )}
                                                    />
                                                    <span className="text-sm font-medium truncate">
                                                        {s.node_name}
                                                    </span>
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[10px] shrink-0"
                                                    >
                                                        {s.node_type ===
                                                        'individual'
                                                            ? 'example'
                                                            : 'category'}
                                                    </Badge>
                                                </div>
                                                {s.node_description && (
                                                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 pl-4">
                                                        {s.node_description}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Match type + base match */}
                                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/30">
                                                {s.match_type &&
                                                MATCH_TYPE_LABELS[
                                                    s.match_type
                                                ] ? (
                                                    <Badge
                                                        variant="outline"
                                                        className={cn(
                                                            'text-[10px] border-0 shrink-0',
                                                            MATCH_TYPE_LABELS[
                                                                s.match_type
                                                            ].color
                                                        )}
                                                    >
                                                        {
                                                            MATCH_TYPE_LABELS[
                                                                s.match_type
                                                            ].label
                                                        }
                                                    </Badge>
                                                ) : (
                                                    <span
                                                        className={cn(
                                                            'text-xs font-bold shrink-0',
                                                            s.similarity >= 0.9
                                                                ? 'text-red-400'
                                                                : s.similarity >=
                                                                    0.8
                                                                  ? 'text-amber-400'
                                                                  : 'text-blue-400'
                                                        )}
                                                    >
                                                        {Math.round(
                                                            s.similarity * 100
                                                        )}
                                                        %
                                                    </span>
                                                )}
                                                <Link2
                                                    size={12}
                                                    className="text-blue-400 shrink-0"
                                                />
                                                <span className="text-xs font-medium truncate">
                                                    {s.match.label ||
                                                        s.match.local_name}
                                                </span>
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] bg-blue-500/10 text-blue-400 border-0 shrink-0"
                                                >
                                                    {s.match.layer_name}
                                                </Badge>
                                            </div>
                                            {s.match.description && (
                                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 pl-6">
                                                    {s.match.description}
                                                </p>
                                            )}

                                            {/* Actions — highlight recommended action based on match_type */}
                                            <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-2">
                                                <Button
                                                    size="sm"
                                                    variant={
                                                        s.match_type === 'same'
                                                            ? 'default'
                                                            : 'outline'
                                                    }
                                                    className={cn(
                                                        'h-6 text-[11px]',
                                                        s.match_type === 'same'
                                                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                                            : 'text-blue-400 border-blue-500/30 hover:bg-blue-500/10'
                                                    )}
                                                    onClick={() =>
                                                        handleAccept(s)
                                                    }
                                                    disabled={isProcessing}
                                                    title="Replace this custom item with the base layer equivalent"
                                                >
                                                    <Check
                                                        size={10}
                                                        className="mr-1"
                                                    />{' '}
                                                    Link to base
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant={
                                                        s.match_type === 'is_a'
                                                            ? 'default'
                                                            : 'outline'
                                                    }
                                                    className={cn(
                                                        'h-6 text-[11px]',
                                                        s.match_type === 'is_a'
                                                            ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                                            : 'text-amber-400 border-amber-500/30 hover:bg-amber-500/10'
                                                    )}
                                                    onClick={() =>
                                                        handleSubclass(s)
                                                    }
                                                    disabled={isProcessing}
                                                    title="Keep custom item but mark it as a type of the base layer item"
                                                >
                                                    <GitMerge
                                                        size={10}
                                                        className="mr-1"
                                                    />{' '}
                                                    Type of{' '}
                                                    {s.match.label ||
                                                        s.match.local_name}
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-6 text-[11px] text-muted-foreground ml-auto"
                                                    onClick={() =>
                                                        handleDismiss(s)
                                                    }
                                                    disabled={isProcessing}
                                                >
                                                    <X size={10} /> Keep
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
