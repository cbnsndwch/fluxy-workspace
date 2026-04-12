import {
    GitMerge,
    Loader2,
    Search,
    AlertTriangle,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    Check,
    X,
    Eye,
    Scissors,
    Undo2
} from 'lucide-react';
import { useState, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip';

// ── Types ──────────────────────────────────────────────────────────────────

interface NodeInfo {
    id: number;
    name: string;
    description: string | null;
    node_type: string;
    status: string;
    edge_count: number;
    parent_name: string | null;
}

interface DuplicateCluster {
    nodes: NodeInfo[];
    max_similarity: number;
}

type ClusterDecision = 'pending' | 'merge' | 'discard' | 'review' | 'split';

interface SplitGroup {
    nodeIds: Set<number>;
    canonicalId: number | null;
}

interface ClusterState {
    decision: ClusterDecision;
    canonicalId: number; // which node to keep (for merge)
    splitGroups: SplitGroup[]; // N-way split groups
}

interface Props {
    projectId: number;
    onComplete: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function DeduplicateDialog({ projectId, onComplete }: Props) {
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState<
        'idle' | 'scanning' | 'slideshow' | 'summary' | 'merging'
    >('idle');
    const [clusters, setClusters] = useState<DuplicateCluster[]>([]);
    const [threshold, setThreshold] = useState(0.85);
    const [currentIdx, setCurrentIdx] = useState(0);
    const [clusterStates, setClusterStates] = useState<ClusterState[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [splitting, setSplitting] = useState(false); // UI toggle for split mode
    const [availableThresholds, setAvailableThresholds] = useState<number[]>(
        []
    ); // thresholds with clusters, descending

    const scan = useCallback(
        async (t: number) => {
            setPhase('scanning');
            setError(null);
            try {
                const res = await fetch(
                    `/app/api/ontologica/projects/${projectId}/duplicates?threshold=${t}`
                );
                if (!res.ok)
                    throw new Error((await res.json()).error || 'Scan failed');
                const data = await res.json();
                setClusters(data.clusters);
                setCurrentIdx(0);
                setSplitting(false);
                setAvailableThresholds(data.available_thresholds || []);

                // All deselected by default — canonical defaults to most-connected
                setClusterStates(
                    data.clusters.map((c: DuplicateCluster) => ({
                        decision: 'pending' as ClusterDecision,
                        canonicalId: c.nodes.reduce(
                            (a: NodeInfo, b: NodeInfo) =>
                                a.edge_count >= b.edge_count ? a : b
                        ).id,
                        splitGroups: []
                    }))
                );

                setPhase(data.clusters.length > 0 ? 'slideshow' : 'slideshow');
            } catch (err: any) {
                setError(err.message);
                setPhase('slideshow');
            }
        },
        [projectId]
    );

    // Find the next lower threshold that has clusters
    const nextLowerThreshold = useMemo(() => {
        const currentPct = Math.round(threshold * 100);
        return (
            availableThresholds.find(t => Math.round(t * 100) < currentPct) ??
            null
        );
    }, [threshold, availableThresholds]);

    const handleOpen = () => {
        setOpen(true);
        scan(threshold);
    };

    // ── State helpers ──

    const updateState = (idx: number, patch: Partial<ClusterState>) => {
        setClusterStates(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], ...patch };
            return next;
        });
    };

    const current = clusters[currentIdx];
    const state = clusterStates[currentIdx];

    const goNext = () => {
        setSplitting(false);
        if (currentIdx < clusters.length - 1) setCurrentIdx(i => i + 1);
        else setPhase('summary');
    };

    const goPrev = () => {
        setSplitting(false);
        if (currentIdx > 0) setCurrentIdx(i => i - 1);
    };

    const decide = (decision: ClusterDecision) => {
        updateState(currentIdx, { decision });
        // Auto-advance after a short beat
        setTimeout(goNext, 300);
    };

    // ── Split helpers (N-way) ──

    const dragNodeId = useRef<number | null>(null);
    const [dragOverGroup, setDragOverGroup] = useState<number | null>(null);

    const handleDragStart = (nodeId: number) => {
        dragNodeId.current = nodeId;
    };

    const handleDragOver = (e: React.DragEvent, groupIdx: number) => {
        e.preventDefault();
        setDragOverGroup(groupIdx);
    };

    const handleDragLeave = () => {
        setDragOverGroup(null);
    };

    const handleDrop = (targetGroupIdx: number) => {
        setDragOverGroup(null);
        const nodeId = dragNodeId.current;
        dragNodeId.current = null;
        if (nodeId == null || !state) return;

        // Find which group this node is currently in
        const sourceGroupIdx = state.splitGroups.findIndex(g =>
            g.nodeIds.has(nodeId)
        );
        if (sourceGroupIdx === targetGroupIdx) return; // same group, no-op

        const groups = state.splitGroups.map(g => ({
            nodeIds: new Set(g.nodeIds),
            canonicalId: g.canonicalId
        }));

        // Don't allow emptying a group completely (must have at least 1 node)
        if (sourceGroupIdx >= 0 && groups[sourceGroupIdx].nodeIds.size <= 1)
            return;

        // Remove from source
        if (sourceGroupIdx >= 0) {
            groups[sourceGroupIdx].nodeIds.delete(nodeId);
            // If this was the canonical, pick the next best
            if (groups[sourceGroupIdx].canonicalId === nodeId) {
                const remaining = current.nodes.filter(n =>
                    groups[sourceGroupIdx].nodeIds.has(n.id)
                );
                groups[sourceGroupIdx].canonicalId =
                    remaining.length > 0
                        ? remaining.reduce((a, b) =>
                              a.edge_count >= b.edge_count ? a : b
                          ).id
                        : null;
            }
        }

        // Add to target
        groups[targetGroupIdx].nodeIds.add(nodeId);
        // Auto-set canonical if first node in group
        if (groups[targetGroupIdx].nodeIds.size === 1) {
            groups[targetGroupIdx].canonicalId = nodeId;
        }

        updateState(currentIdx, { splitGroups: groups });
    };

    const selectCanonical = (nodeId: number, groupIdx: number) => {
        if (!state) return;
        const groups = state.splitGroups.map((g, i) =>
            i === groupIdx
                ? { nodeIds: new Set(g.nodeIds), canonicalId: nodeId }
                : { nodeIds: new Set(g.nodeIds), canonicalId: g.canonicalId }
        );
        updateState(currentIdx, { splitGroups: groups });
    };

    const addSplitGroup = () => {
        if (!state) return;
        const groups = state.splitGroups.map(g => ({
            nodeIds: new Set(g.nodeIds),
            canonicalId: g.canonicalId
        }));
        groups.push({ nodeIds: new Set<number>(), canonicalId: null });
        updateState(currentIdx, { splitGroups: groups });
    };

    // Remove empty groups (except must keep at least 2)
    const removeSplitGroup = (groupIdx: number) => {
        if (!state || state.splitGroups.length <= 2) return;
        const group = state.splitGroups[groupIdx];
        if (group.nodeIds.size > 0) return; // can only remove empty groups
        const groups = state.splitGroups
            .filter((_, i) => i !== groupIdx)
            .map(g => ({
                nodeIds: new Set(g.nodeIds),
                canonicalId: g.canonicalId
            }));
        updateState(currentIdx, { splitGroups: groups });
    };

    const confirmSplit = () => {
        if (!state) return;
        // Need at least 2 groups with nodes
        const nonEmpty = state.splitGroups.filter(g => g.nodeIds.size > 0);
        if (nonEmpty.length < 2) return;

        // Ensure every group has a canonical
        const groups = state.splitGroups.map(g => {
            if (g.nodeIds.size > 0 && !g.canonicalId) {
                const nodes = current.nodes.filter(n => g.nodeIds.has(n.id));
                return {
                    nodeIds: new Set(g.nodeIds),
                    canonicalId: nodes.reduce((a, b) =>
                        a.edge_count >= b.edge_count ? a : b
                    ).id
                };
            }
            return { nodeIds: new Set(g.nodeIds), canonicalId: g.canonicalId };
        });

        updateState(currentIdx, {
            decision: 'split' as ClusterDecision,
            splitGroups: groups
        });
        setTimeout(goNext, 300);
    };

    // ── Summary stats ──

    const summaryStats = useMemo(() => {
        const merge = clusterStates.filter(s => s.decision === 'merge');
        const discard = clusterStates.filter(s => s.decision === 'discard');
        const review = clusterStates.filter(s => s.decision === 'review');
        const split = clusterStates.filter(s => s.decision === 'split');
        const pending = clusterStates.filter(s => s.decision === 'pending');
        return { merge, discard, review, split, pending };
    }, [clusterStates]);

    // ── Execute merges ──

    const handleExecute = async (continueAfter = false) => {
        const merges: Array<{ canonical_id: number; duplicate_ids: number[] }> =
            [];
        const dismissals: Array<{ node_ids: number[] }> = [];

        clusterStates.forEach((s, idx) => {
            const c = clusters[idx];
            if (s.decision === 'merge') {
                const dupIds = c.nodes
                    .filter(n => n.id !== s.canonicalId)
                    .map(n => n.id);
                merges.push({
                    canonical_id: s.canonicalId,
                    duplicate_ids: dupIds
                });
            } else if (s.decision === 'discard') {
                // Persist "not duplicates" so they never resurface on rescan
                dismissals.push({ node_ids: c.nodes.map(n => n.id) });
            } else if (s.decision === 'split') {
                // N-way split: each group with >1 node gets merged internally
                const nonEmpty = s.splitGroups.filter(g => g.nodeIds.size > 0);
                for (const group of nonEmpty) {
                    if (group.nodeIds.size > 1 && group.canonicalId) {
                        const dupIds = [...group.nodeIds].filter(
                            id => id !== group.canonicalId
                        );
                        if (dupIds.length)
                            merges.push({
                                canonical_id: group.canonicalId,
                                duplicate_ids: dupIds
                            });
                    }
                }
                // Dismiss all cross-group pairs (they're "not duplicates")
                for (let i = 0; i < nonEmpty.length; i++) {
                    for (let j = i + 1; j < nonEmpty.length; j++) {
                        for (const aId of nonEmpty[i].nodeIds) {
                            for (const bId of nonEmpty[j].nodeIds) {
                                dismissals.push({ node_ids: [aId, bId] });
                            }
                        }
                    }
                }
            }
        });

        // Mark "review" items — update their status in DB
        const reviewNodeIds: number[] = [];
        clusterStates.forEach((s, idx) => {
            if (s.decision === 'review') {
                clusters[idx].nodes.forEach(n => reviewNodeIds.push(n.id));
            }
        });

        if (!merges.length && !dismissals.length && !reviewNodeIds.length) {
            toast.info('Nothing to execute');
            return;
        }

        setPhase('merging');
        try {
            // Send merges AND dismissals in one call
            if (merges.length || dismissals.length) {
                const res = await fetch(
                    `/app/api/ontologica/projects/${projectId}/merge`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ merges, dismissals })
                    }
                );
                if (!res.ok)
                    throw new Error((await res.json()).error || 'Merge failed');
                const result = await res.json();
                const parts: string[] = [];
                if (result.total_nodes_deleted > 0)
                    parts.push(`merged ${result.total_nodes_deleted} nodes`);
                if (result.dismissals_saved > 0)
                    parts.push(
                        `dismissed ${dismissals.length} group${dismissals.length !== 1 ? 's' : ''}`
                    );
                if (parts.length) toast.success(parts.join(', '));
            }

            // Mark review nodes with "needs_review" status via the existing bulk review endpoint
            if (reviewNodeIds.length) {
                await fetch(
                    `/app/api/ontologica/projects/${projectId}/review`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            node_ids: reviewNodeIds,
                            action: 'needs_review'
                        })
                    }
                );
                toast.info(`${reviewNodeIds.length} nodes marked for review`);
            }

            onComplete(); // refresh counts in parent

            if (continueAfter) {
                // First rescan at current threshold (merged nodes are gone, new clusters may appear)
                toast.info('Finding next batch...');
                const res2 = await fetch(
                    `/app/api/ontologica/projects/${projectId}/duplicates?threshold=${threshold}`
                );
                if (res2.ok) {
                    const data2 = await res2.json();
                    setAvailableThresholds(data2.available_thresholds || []);
                    if (data2.clusters.length > 0) {
                        // Still have results at current threshold
                        setClusters(data2.clusters);
                        setCurrentIdx(0);
                        setSplitting(false);
                        setClusterStates(
                            data2.clusters.map((c: DuplicateCluster) => ({
                                decision: 'pending' as ClusterDecision,
                                canonicalId: c.nodes.reduce(
                                    (a: NodeInfo, b: NodeInfo) =>
                                        a.edge_count >= b.edge_count ? a : b
                                ).id,
                                splitGroups: []
                            }))
                        );
                        setPhase('slideshow');
                    } else {
                        // No results at current threshold — auto-step down
                        const nextAvail = (
                            data2.available_thresholds || []
                        ).find(
                            (t: number) =>
                                Math.round(t * 100) <
                                Math.round(threshold * 100)
                        );
                        if (nextAvail) {
                            setThreshold(nextAvail);
                            await scan(nextAvail);
                        } else {
                            // Nothing left at any threshold
                            setClusters([]);
                            setClusterStates([]);
                            setPhase('slideshow');
                        }
                    }
                }
            } else {
                setOpen(false);
            }
        } catch (err: any) {
            toast.error('Failed: ' + err.message);
            setPhase('summary');
        }
    };

    // ── Progress dots ──

    const decisionColor = (d: ClusterDecision) => {
        switch (d) {
            case 'merge':
                return 'bg-emerald-500';
            case 'discard':
                return 'bg-red-500';
            case 'review':
                return 'bg-amber-500';
            case 'split':
                return 'bg-blue-500';
            default:
                return 'bg-muted-foreground/30';
        }
    };

    // ── Render ──

    return (
        <>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleOpen}
                        >
                            <GitMerge size={14} className="mr-1" /> Deduplicate
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        Find and merge semantically similar nodes using local AI
                        embeddings
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden p-0">
                    {/* ── Header ── */}
                    <DialogHeader className="px-6 pt-6 pb-3">
                        <DialogTitle className="flex items-center gap-2">
                            <GitMerge size={18} /> Deduplicate Nodes
                            <DialogDescription className="sr-only">
                                Find and merge semantically similar nodes using
                                local AI embeddings.
                            </DialogDescription>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={async () => {
                                                if (
                                                    !confirm(
                                                        'Reset all "Not Duplicates" dismissals? Previously dismissed pairs will reappear in scans.'
                                                    )
                                                )
                                                    return;
                                                await fetch(
                                                    `/app/api/ontologica/projects/${projectId}/dismissals`,
                                                    {
                                                        method: 'DELETE'
                                                    }
                                                );
                                                toast.info(
                                                    'Dismissals cleared — rescan to see all pairs'
                                                );
                                                scan(threshold);
                                            }}
                                            className="ml-auto text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
                                        >
                                            Reset dismissals
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        Clear all "Not Duplicates" decisions so
                                        dismissed pairs reappear
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </DialogTitle>
                    </DialogHeader>

                    {/* ── Threshold (shown during scan/slideshow) ── */}
                    {(phase === 'scanning' || phase === 'slideshow') && (
                        <div className="px-6 pb-2 space-y-2">
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                    Similarity:
                                </span>
                                <Slider
                                    aria-label="Similarity Threshold"
                                    min={50}
                                    max={99}
                                    step={1}
                                    value={[Math.round(threshold * 100)]}
                                    onValueChange={([v]) =>
                                        setThreshold(v / 100)
                                    }
                                    className="flex-1 **:data-[slot=slider-range]:bg-violet-500 **:data-[slot=slider-thumb]:border-violet-500 **:data-[slot=slider-thumb]:hover:ring-violet-500/30 **:data-[slot=slider-thumb]:focus-visible:ring-violet-500/30"
                                />
                                <span className="text-xs font-mono w-10 text-right">
                                    {Math.round(threshold * 100)}%
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => scan(threshold)}
                                    disabled={phase === 'scanning'}
                                >
                                    <Search size={12} className="mr-1" /> Rescan
                                </Button>
                                {nextLowerThreshold !== null && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setThreshold(nextLowerThreshold);
                                            scan(nextLowerThreshold);
                                        }}
                                        disabled={phase === 'scanning'}
                                        className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                                    >
                                        <ChevronDown
                                            size={12}
                                            className="mr-1"
                                        />{' '}
                                        {Math.round(nextLowerThreshold * 100)}%
                                    </Button>
                                )}
                            </div>
                            {/* Presets */}
                            <div className="flex items-center gap-1 pl-17">
                                {SIMILARITY_PRESETS.map(p => (
                                    <button
                                        key={p.value}
                                        onClick={() => {
                                            setThreshold(p.value);
                                            scan(p.value);
                                        }}
                                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                                            Math.abs(threshold - p.value) <
                                            0.005
                                                ? 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Scanning ── */}
                    {phase === 'scanning' && (
                        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                            <Loader2 size={28} className="animate-spin mb-3" />
                            <p className="text-sm">
                                Computing embeddings & finding duplicates...
                            </p>
                            <p className="text-xs mt-1 opacity-60">
                                First run downloads the model (~80MB)
                            </p>
                        </div>
                    )}

                    {/* ── Merging ── */}
                    {phase === 'merging' && (
                        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                            <Loader2 size={28} className="animate-spin mb-3" />
                            <p className="text-sm">Executing merges...</p>
                        </div>
                    )}

                    {/* ── Error ── */}
                    {error && (
                        <div className="flex items-center gap-2 mx-6 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
                            <AlertTriangle size={16} /> {error}
                        </div>
                    )}

                    {/* ── No results ── */}
                    {phase === 'slideshow' &&
                        !error &&
                        clusters.length === 0 && (
                            <div className="text-center py-16 text-muted-foreground">
                                <p className="text-sm">
                                    No duplicates found at{' '}
                                    {Math.round(threshold * 100)}% similarity
                                </p>
                                {nextLowerThreshold !== null ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setThreshold(nextLowerThreshold);
                                            scan(nextLowerThreshold);
                                        }}
                                        className="mt-3 text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                                    >
                                        <ChevronDown
                                            size={14}
                                            className="mr-1"
                                        />{' '}
                                        Jump to{' '}
                                        {Math.round(nextLowerThreshold * 100)}%
                                    </Button>
                                ) : (
                                    <p className="text-xs mt-1">
                                        No more duplicates at any threshold
                                    </p>
                                )}
                            </div>
                        )}

                    {/* ── Slideshow ── */}
                    {phase === 'slideshow' &&
                        clusters.length > 0 &&
                        current &&
                        state && (
                            <div className="flex-1 flex flex-col min-h-0 px-6">
                                {/* Progress dots */}
                                <div className="flex items-center gap-1 mb-3 justify-center flex-wrap">
                                    {clusters.map((_, i) => (
                                        <button
                                            key={i}
                                            aria-label={`Jump to cluster ${i + 1}`}
                                            onClick={() => {
                                                setSplitting(false);
                                                setCurrentIdx(i);
                                            }}
                                            className={`w-2.5 h-2.5 rounded-full transition-all cursor-pointer ${
                                                i === currentIdx
                                                    ? 'ring-2 ring-violet-400 ring-offset-1 ring-offset-background ' +
                                                      decisionColor(
                                                          clusterStates[i]
                                                              ?.decision ||
                                                              'pending'
                                                      )
                                                    : decisionColor(
                                                          clusterStates[i]
                                                              ?.decision ||
                                                              'pending'
                                                      )
                                            }`}
                                        />
                                    ))}
                                </div>

                                {/* Counter */}
                                <div className="text-center text-xs text-muted-foreground mb-3">
                                    {currentIdx + 1} of {clusters.length}
                                    <Badge
                                        variant="outline"
                                        className="ml-2 text-[10px]"
                                    >
                                        {Math.round(
                                            current.max_similarity * 100
                                        )}
                                        % similar
                                    </Badge>
                                    {state.decision !== 'pending' && (
                                        <Badge
                                            className={`ml-2 text-[10px] border-0 ${
                                                state.decision === 'merge'
                                                    ? 'bg-emerald-500/20 text-emerald-400'
                                                    : state.decision ===
                                                        'discard'
                                                      ? 'bg-red-500/20 text-red-400'
                                                      : state.decision ===
                                                          'review'
                                                        ? 'bg-amber-500/20 text-amber-400'
                                                        : 'bg-blue-500/20 text-blue-400'
                                            }`}
                                        >
                                            {state.decision === 'merge'
                                                ? 'Will Merge'
                                                : state.decision === 'discard'
                                                  ? 'Discarded'
                                                  : state.decision === 'review'
                                                    ? 'Needs Review'
                                                    : 'Split'}
                                        </Badge>
                                    )}
                                </div>

                                {/* ── Split mode (N-way) ── */}
                                {splitting ? (
                                    <div className="flex-1 overflow-y-auto min-h-0 space-y-2 mb-3">
                                        <p className="text-xs text-muted-foreground text-center mb-2">
                                            Drag items between groups. Click to
                                            pick which to{' '}
                                            <span className="text-emerald-400 font-medium">
                                                keep
                                            </span>
                                            .
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {state.splitGroups.map(
                                                (group, gIdx) => {
                                                    const gc =
                                                        SPLIT_GROUP_COLORS[
                                                            gIdx %
                                                                SPLIT_GROUP_COLORS.length
                                                        ];
                                                    const groupNodes =
                                                        current.nodes.filter(
                                                            n =>
                                                                group.nodeIds.has(
                                                                    n.id
                                                                )
                                                        );
                                                    return (
                                                        <div
                                                            key={gIdx}
                                                            className={`rounded-lg border p-2 transition-colors min-h-20 flex-1 min-w-45 ${
                                                                dragOverGroup ===
                                                                gIdx
                                                                    ? `${gc.activeBorder} ${gc.bg}`
                                                                    : gc.border
                                                            }`}
                                                            onDragOver={e =>
                                                                handleDragOver(
                                                                    e,
                                                                    gIdx
                                                                )
                                                            }
                                                            onDragLeave={
                                                                handleDragLeave
                                                            }
                                                            onDrop={() =>
                                                                handleDrop(gIdx)
                                                            }
                                                        >
                                                            <div className="flex items-center justify-between mb-1.5">
                                                                <div
                                                                    className={`text-[10px] font-medium ${gc.text} uppercase tracking-wider`}
                                                                >
                                                                    Group{' '}
                                                                    {String.fromCharCode(
                                                                        65 +
                                                                            gIdx
                                                                    )}
                                                                </div>
                                                                {state
                                                                    .splitGroups
                                                                    .length >
                                                                    2 &&
                                                                    groupNodes.length ===
                                                                        0 && (
                                                                        <button
                                                                            aria-label="Remove split group"
                                                                            onClick={() =>
                                                                                removeSplitGroup(
                                                                                    gIdx
                                                                                )
                                                                            }
                                                                            className="text-muted-foreground/40 hover:text-red-400 transition-colors cursor-pointer"
                                                                        >
                                                                            <X
                                                                                size={
                                                                                    12
                                                                                }
                                                                            />
                                                                        </button>
                                                                    )}
                                                            </div>
                                                            {groupNodes.length ===
                                                            0 ? (
                                                                <p className="text-xs text-muted-foreground/50 text-center py-4">
                                                                    Drag items
                                                                    here
                                                                </p>
                                                            ) : (
                                                                groupNodes.map(
                                                                    node => {
                                                                        const isKeep =
                                                                            node.id ===
                                                                            group.canonicalId;
                                                                        return (
                                                                            <button
                                                                                type="button"
                                                                                key={
                                                                                    node.id
                                                                                }
                                                                                draggable
                                                                                onDragStart={() =>
                                                                                    handleDragStart(
                                                                                        node.id
                                                                                    )
                                                                                }
                                                                                onClick={() =>
                                                                                    selectCanonical(
                                                                                        node.id,
                                                                                        gIdx
                                                                                    )
                                                                                }
                                                                                onKeyDown={e => {
                                                                                    if (
                                                                                        e.key ===
                                                                                            'Enter' ||
                                                                                        e.key ===
                                                                                            ' '
                                                                                    ) {
                                                                                        e.preventDefault();
                                                                                        selectCanonical(
                                                                                            node.id,
                                                                                            gIdx
                                                                                        );
                                                                                    }
                                                                                }}
                                                                                className={`p-2 rounded-md mb-1 cursor-grab active:cursor-grabbing transition-all ${
                                                                                    isKeep
                                                                                        ? 'bg-emerald-500/10 border border-emerald-500/30 ring-1 ring-emerald-500/20'
                                                                                        : `${gc.hoverBg} border border-transparent`
                                                                                }`}
                                                                            >
                                                                                <div className="flex items-center gap-2">
                                                                                    <div
                                                                                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                                                                            isKeep
                                                                                                ? 'border-emerald-500 bg-emerald-500'
                                                                                                : 'border-muted-foreground/30'
                                                                                        }`}
                                                                                    >
                                                                                        {isKeep && (
                                                                                            <Check
                                                                                                size={
                                                                                                    10
                                                                                                }
                                                                                                className="text-white"
                                                                                            />
                                                                                        )}
                                                                                    </div>
                                                                                    <div className="flex-1 min-w-0">
                                                                                        <NodeLabel
                                                                                            node={
                                                                                                node
                                                                                            }
                                                                                        />
                                                                                    </div>
                                                                                </div>
                                                                                {isKeep && (
                                                                                    <span className="text-[10px] text-emerald-400 font-medium ml-6">
                                                                                        keep
                                                                                    </span>
                                                                                )}
                                                                            </button>
                                                                        );
                                                                    }
                                                                )
                                                            )}
                                                        </div>
                                                    );
                                                }
                                            )}
                                            {/* Add group button */}
                                            <button
                                                aria-label="Add split group"
                                                onClick={addSplitGroup}
                                                className="rounded-lg border border-dashed border-muted-foreground/20 hover:border-muted-foreground/40 min-h-20 min-w-15 flex items-center justify-center transition-colors cursor-pointer group"
                                            >
                                                <span className="text-muted-foreground/30 group-hover:text-muted-foreground/60 text-lg font-light">
                                                    +
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    /* ── Normal card view ── */
                                    <div className="flex-1 overflow-y-auto min-h-0 space-y-2 mb-3">
                                        {current.nodes.map(node => {
                                            const isCanonical =
                                                node.id === state.canonicalId;
                                            return (
                                                <button
                                                    type="button"
                                                    key={node.id}
                                                    onClick={() =>
                                                        updateState(
                                                            currentIdx,
                                                            {
                                                                canonicalId:
                                                                    node.id
                                                            }
                                                        )
                                                    }
                                                    onKeyDown={e => {
                                                        if (
                                                            e.key === 'Enter' ||
                                                            e.key === ' '
                                                        ) {
                                                            e.preventDefault();
                                                            updateState(
                                                                currentIdx,
                                                                {
                                                                    canonicalId:
                                                                        node.id
                                                                }
                                                            );
                                                        }
                                                    }}
                                                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                                                        isCanonical
                                                            ? 'border-emerald-500/40 bg-emerald-500/5 ring-1 ring-emerald-500/20'
                                                            : 'border-border/40 hover:border-border/60 hover:bg-muted/30'
                                                    }`}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <div
                                                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                                                                isCanonical
                                                                    ? 'border-emerald-500 bg-emerald-500'
                                                                    : 'border-muted-foreground/30'
                                                            }`}
                                                        >
                                                            {isCanonical && (
                                                                <Check
                                                                    size={12}
                                                                    className="text-white"
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <NodeLabel
                                                                node={node}
                                                            />
                                                            {isCanonical && (
                                                                <span className="text-[10px] text-emerald-400 font-medium mt-1 block">
                                                                    ← Keep this
                                                                    one
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                        <p className="text-[10px] text-muted-foreground/50 text-center pt-1">
                                            Tap an item to select which one to
                                            keep when merging
                                        </p>
                                    </div>
                                )}

                                {/* ── Actions ── */}
                                <div className="border-t pt-3 pb-4">
                                    {splitting ? (
                                        <div className="flex items-center justify-between">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() =>
                                                    setSplitting(false)
                                                }
                                            >
                                                <Undo2
                                                    size={14}
                                                    className="mr-1"
                                                />{' '}
                                                Cancel
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={confirmSplit}
                                                disabled={
                                                    state.splitGroups.filter(
                                                        g => g.nodeIds.size > 0
                                                    ).length < 2
                                                }
                                                className="bg-blue-600 hover:bg-blue-700"
                                            >
                                                <Scissors
                                                    size={14}
                                                    className="mr-1"
                                                />
                                                Confirm Split (
                                                {
                                                    state.splitGroups.filter(
                                                        g => g.nodeIds.size > 0
                                                    ).length
                                                }{' '}
                                                groups)
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {/* Main action row */}
                                            <div className="flex items-center gap-2 justify-center">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={goPrev}
                                                    disabled={currentIdx === 0}
                                                    className="px-2"
                                                >
                                                    <ChevronLeft size={16} />
                                                </Button>

                                                <Button
                                                    size="sm"
                                                    onClick={() =>
                                                        decide('merge')
                                                    }
                                                    className="bg-emerald-600 hover:bg-emerald-700 flex-1 max-w-35"
                                                >
                                                    <Check
                                                        size={14}
                                                        className="mr-1"
                                                    />{' '}
                                                    Merge
                                                </Button>

                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        decide('discard')
                                                    }
                                                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/30 flex-1 max-w-35"
                                                >
                                                    <X
                                                        size={14}
                                                        className="mr-1"
                                                    />{' '}
                                                    Not Duplicates
                                                </Button>

                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        decide('review')
                                                    }
                                                    className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border-amber-500/30 flex-1 max-w-35"
                                                >
                                                    <Eye
                                                        size={14}
                                                        className="mr-1"
                                                    />{' '}
                                                    Review Later
                                                </Button>

                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={goNext}
                                                    className="px-2"
                                                >
                                                    <ChevronRight size={16} />
                                                </Button>
                                            </div>

                                            {/* Split button — secondary row */}
                                            <div className="flex justify-center">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        updateState(
                                                            currentIdx,
                                                            {
                                                                splitGroups: [
                                                                    {
                                                                        nodeIds:
                                                                            new Set(
                                                                                current.nodes.map(
                                                                                    n =>
                                                                                        n.id
                                                                                )
                                                                            ),
                                                                        canonicalId:
                                                                            state.canonicalId
                                                                    },
                                                                    {
                                                                        nodeIds:
                                                                            new Set<number>(),
                                                                        canonicalId:
                                                                            null
                                                                    }
                                                                ]
                                                            }
                                                        );
                                                        setSplitting(true);
                                                    }}
                                                    className="text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                                >
                                                    <Scissors
                                                        size={12}
                                                        className="mr-1"
                                                    />{' '}
                                                    Split into groups
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                    {/* ── Summary ── */}
                    {phase === 'summary' && (
                        <div className="flex-1 flex flex-col min-h-0 px-6 pb-6">
                            <div className="text-center mb-4">
                                <h3 className="text-lg font-medium">
                                    Review Summary
                                </h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {clusters.length} groups reviewed
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <SummaryCard
                                    label="Merge"
                                    count={summaryStats.merge.length}
                                    color="emerald"
                                    icon={<GitMerge size={16} />}
                                />
                                <SummaryCard
                                    label="Not Duplicates"
                                    count={summaryStats.discard.length}
                                    color="red"
                                    icon={<X size={16} />}
                                />
                                <SummaryCard
                                    label="Review Later"
                                    count={summaryStats.review.length}
                                    color="amber"
                                    icon={<Eye size={16} />}
                                />
                                <SummaryCard
                                    label="Split & Merge"
                                    count={summaryStats.split.length}
                                    color="blue"
                                    icon={<Scissors size={16} />}
                                />
                            </div>

                            {summaryStats.pending.length > 0 && (
                                <p className="text-xs text-muted-foreground text-center mb-3">
                                    {summaryStats.pending.length} group
                                    {summaryStats.pending.length !== 1
                                        ? 's'
                                        : ''}{' '}
                                    skipped (no action)
                                </p>
                            )}

                            {/* Scrollable detail list */}
                            <div className="flex-1 overflow-y-auto min-h-0 space-y-2 mb-4">
                                {clusters.map((c, idx) => {
                                    const s = clusterStates[idx];
                                    if (s.decision === 'pending') return null;
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => {
                                                setPhase('slideshow');
                                                setCurrentIdx(idx);
                                                setSplitting(false);
                                            }}
                                            className="w-full text-left p-2 rounded-lg border border-border/30 hover:bg-muted/30 transition-colors"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div
                                                    className={`w-2 h-2 rounded-full ${decisionColor(s.decision)}`}
                                                />
                                                <span className="text-sm truncate flex-1">
                                                    {c.nodes
                                                        .map(n => n.name)
                                                        .join(' · ')}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground capitalize">
                                                    {s.decision}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Next threshold hint */}
                            {nextLowerThreshold !== null && (
                                <p className="text-xs text-muted-foreground text-center mb-2">
                                    Next threshold with results:{' '}
                                    <span className="text-violet-400 font-medium">
                                        {Math.round(nextLowerThreshold * 100)}%
                                    </span>
                                </p>
                            )}

                            {/* Action buttons */}
                            <div className="flex gap-2 border-t pt-3">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setPhase('slideshow');
                                        setCurrentIdx(0);
                                        setSplitting(false);
                                    }}
                                >
                                    <ChevronLeft size={14} className="mr-1" />{' '}
                                    Review
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={() => handleExecute(false)}
                                    disabled={
                                        summaryStats.merge.length === 0 &&
                                        summaryStats.split.length === 0 &&
                                        summaryStats.review.length === 0 &&
                                        summaryStats.discard.length === 0
                                    }
                                    className="flex-1 bg-violet-600 hover:bg-violet-700"
                                >
                                    <Check size={14} className="mr-1" /> Execute
                                    & Close
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={() => handleExecute(true)}
                                    disabled={
                                        summaryStats.merge.length === 0 &&
                                        summaryStats.split.length === 0 &&
                                        summaryStats.review.length === 0 &&
                                        summaryStats.discard.length === 0
                                    }
                                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                                >
                                    <ChevronRight size={14} className="mr-1" />{' '}
                                    Execute & Continue
                                    {nextLowerThreshold !== null && (
                                        <span className="ml-1 opacity-70">
                                            →{' '}
                                            {Math.round(
                                                nextLowerThreshold * 100
                                            )}
                                            %
                                        </span>
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function NodeLabel({ node }: { node: NodeInfo }) {
    return (
        <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-medium">{node.name}</span>
                {node.node_type === 'individual' && node.parent_name ? (
                    <span className="text-xs text-muted-foreground">
                        is a{' '}
                        <span className="text-violet-400">
                            {node.parent_name}
                        </span>
                    </span>
                ) : (
                    <Badge variant="outline" className="text-[10px]">
                        {node.node_type === 'individual'
                            ? 'example'
                            : 'category'}
                    </Badge>
                )}
            </div>
            {node.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {node.description}
                </p>
            )}
        </div>
    );
}

// ── Split group colors ────────────────────────────────────────────────────

const SPLIT_GROUP_COLORS = [
    {
        border: 'border-violet-500/30',
        activeBorder: 'border-violet-400',
        bg: 'bg-violet-500/10',
        hoverBg: 'hover:bg-violet-500/10',
        text: 'text-violet-400'
    },
    {
        border: 'border-blue-500/30',
        activeBorder: 'border-blue-400',
        bg: 'bg-blue-500/10',
        hoverBg: 'hover:bg-blue-500/10',
        text: 'text-blue-400'
    },
    {
        border: 'border-amber-500/30',
        activeBorder: 'border-amber-400',
        bg: 'bg-amber-500/10',
        hoverBg: 'hover:bg-amber-500/10',
        text: 'text-amber-400'
    },
    {
        border: 'border-rose-500/30',
        activeBorder: 'border-rose-400',
        bg: 'bg-rose-500/10',
        hoverBg: 'hover:bg-rose-500/10',
        text: 'text-rose-400'
    },
    {
        border: 'border-cyan-500/30',
        activeBorder: 'border-cyan-400',
        bg: 'bg-cyan-500/10',
        hoverBg: 'hover:bg-cyan-500/10',
        text: 'text-cyan-400'
    },
    {
        border: 'border-lime-500/30',
        activeBorder: 'border-lime-400',
        bg: 'bg-lime-500/10',
        hoverBg: 'hover:bg-lime-500/10',
        text: 'text-lime-400'
    },
    {
        border: 'border-orange-500/30',
        activeBorder: 'border-orange-400',
        bg: 'bg-orange-500/10',
        hoverBg: 'hover:bg-orange-500/10',
        text: 'text-orange-400'
    },
    {
        border: 'border-pink-500/30',
        activeBorder: 'border-pink-400',
        bg: 'bg-pink-500/10',
        hoverBg: 'hover:bg-pink-500/10',
        text: 'text-pink-400'
    }
];

// ── Similarity presets ─────────────────────────────────────────────────────

const SIMILARITY_PRESETS = [
    { label: '60%', value: 0.6 },
    { label: '70%', value: 0.7 },
    { label: '80%', value: 0.8 },
    { label: '85%', value: 0.85 },
    { label: '90%', value: 0.9 },
    { label: '95%', value: 0.95 },
    { label: '98%', value: 0.98 }
];

function SummaryCard({
    label,
    count,
    color,
    icon
}: {
    label: string;
    count: number;
    color: string;
    icon: React.ReactNode;
}) {
    const colorMap: Record<string, string> = {
        emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        red: 'bg-red-500/10 text-red-400 border-red-500/20',
        amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20'
    };
    return (
        <div
            className={`rounded-lg border p-3 flex items-center gap-3 ${colorMap[color] || ''}`}
        >
            {icon}
            <div>
                <div className="text-xl font-bold">{count}</div>
                <div className="text-xs opacity-80">{label}</div>
            </div>
        </div>
    );
}
