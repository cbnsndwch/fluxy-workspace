import {
    Check,
    X,
    SkipForward,
    CheckCheck,
    XCircle,
    Play,
    Search,
    Filter,
    ArrowUpDown,
    Link,
    GitBranch,
    Minus,
    Loader2,
    Pencil,
    Plus
} from 'lucide-react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { useProjectContext } from '../context';

// ── Types ────────────────────────────────────────────────────────────────────

interface Proposal {
    id: number;
    job_id: number;
    project_id: number;
    proposal_type:
        | 'link_to_base'
        | 'subclass_of'
        | 'merge'
        | 'not_duplicate'
        | 'no_match';
    source_id: number | null;
    target_id: number | null;
    payload: string;
    confidence: number;
    status: 'pending' | 'approved' | 'rejected' | 'applied' | 'skipped';
    decided_by: string | null;
    decided_at: string | null;
    applied_at: string | null;
    metadata: string;
    created_at: string;
    job_type: string;
}

interface ParsedPayload {
    node_id?: number;
    node_name?: string;
    node_description?: string;
    item_id?: number;
    layer_id?: number;
    layer_name?: string;
    layer_slug?: string;
    base_item_uri?: string;
    base_item_name?: string;
    base_item_description?: string;
    match_type?: 'same' | 'is_a' | 'related';
    embedding_similarity?: number;
    llm_confidence?: number;
    canonical_id?: number;
    duplicate_ids?: number[];
    node_ids?: number[];
}

type StatusFilter =
    | 'all'
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'skipped'
    | 'applied';
type TypeFilter =
    | 'all'
    | 'link_to_base'
    | 'subclass_of'
    | 'merge'
    | 'not_duplicate'
    | 'no_match';
type SortField = 'confidence' | 'created_at' | 'match_type';

// ── Helpers ──────────────────────────────────────────────────────────────────

const MATCH_TYPE_ORDER: Record<string, number> = {
    same: 0,
    is_a: 1,
    related: 2
};

function matchTypeBadge(matchType: string | undefined) {
    switch (matchType) {
        case 'same':
            return (
                <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-xs">
                    Same as
                </Badge>
            );
        case 'is_a':
            return (
                <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">
                    Is a type of
                </Badge>
            );
        case 'related':
            return (
                <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-xs">
                    Related to
                </Badge>
            );
        default:
            return (
                <Badge variant="outline" className="text-xs">
                    {matchType || 'unknown'}
                </Badge>
            );
    }
}

function proposalTypeBadge(type: string) {
    switch (type) {
        case 'link_to_base':
            return (
                <Badge variant="outline" className="text-xs gap-1">
                    <Link size={10} /> Link to base
                </Badge>
            );
        case 'subclass_of':
            return (
                <Badge variant="outline" className="text-xs gap-1">
                    <GitBranch size={10} /> Subclass of
                </Badge>
            );
        case 'merge':
            return (
                <Badge variant="outline" className="text-xs gap-1">
                    <GitBranch size={10} /> Merge
                </Badge>
            );
        case 'not_duplicate':
            return (
                <Badge variant="outline" className="text-xs gap-1">
                    <Minus size={10} /> Not duplicate
                </Badge>
            );
        case 'no_match':
            return (
                <Badge variant="outline" className="text-xs gap-1">
                    <X size={10} /> No match
                </Badge>
            );
        default:
            return (
                <Badge variant="outline" className="text-xs">
                    {type}
                </Badge>
            );
    }
}

function statusBadge(status: string) {
    switch (status) {
        case 'pending':
            return (
                <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 text-xs">
                    Pending
                </Badge>
            );
        case 'approved':
            return (
                <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-xs">
                    Approved
                </Badge>
            );
        case 'rejected':
            return (
                <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-xs">
                    Rejected
                </Badge>
            );
        case 'skipped':
            return (
                <Badge className="bg-muted text-muted-foreground text-xs">
                    Skipped
                </Badge>
            );
        case 'applied':
            return (
                <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 text-xs">
                    Applied
                </Badge>
            );
        default:
            return (
                <Badge variant="outline" className="text-xs">
                    {status}
                </Badge>
            );
    }
}

function confidenceBar(confidence: number) {
    const pct = Math.round(confidence * 100);
    const color =
        pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
    return (
        <div className="flex items-center gap-2 min-w-20">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-xs text-muted-foreground w-8 text-right">
                {pct}%
            </span>
        </div>
    );
}

// ── Component ────────────────────────────────────────────────────────────────

export function ProposalsTab() {
    const { projectId, loadGraph, loadStats } = useProjectContext();

    const [proposals, setProposals] = useState<Proposal[]>([]);
    const [loading, setLoading] = useState(true);
    const [applying, setApplying] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [sortField, setSortField] = useState<SortField>('confidence');
    const [sortDesc, setSortDesc] = useState(true);
    const [selected, setSelected] = useState<Set<number>>(new Set());

    const loadProposals = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter !== 'all') params.set('status', statusFilter);
            const res = await fetch(
                `/app/api/ontologica/projects/${projectId}/proposals?${params}`
            );
            if (res.ok) setProposals(await res.json());
        } finally {
            setLoading(false);
        }
    }, [projectId, statusFilter]);

    useEffect(() => {
        loadProposals();
    }, [loadProposals]);

    // Parse payloads once
    const parsed = useMemo(() => {
        const map = new Map<number, ParsedPayload>();
        for (const p of proposals) {
            try {
                map.set(p.id, JSON.parse(p.payload));
            } catch {
                map.set(p.id, {});
            }
        }
        return map;
    }, [proposals]);

    // Filter & sort
    const filtered = useMemo(() => {
        let result = [...proposals];

        if (typeFilter !== 'all') {
            result = result.filter(p => p.proposal_type === typeFilter);
        }

        if (search) {
            const q = search.toLowerCase();
            result = result.filter(p => {
                const payload = parsed.get(p.id);
                return (
                    payload?.node_name?.toLowerCase().includes(q) ||
                    payload?.base_item_name?.toLowerCase().includes(q) ||
                    payload?.node_description?.toLowerCase().includes(q)
                );
            });
        }

        result.sort((a, b) => {
            const pa = parsed.get(a.id);
            const pb = parsed.get(b.id);
            let cmp = 0;
            switch (sortField) {
                case 'confidence':
                    cmp = a.confidence - b.confidence;
                    break;
                case 'created_at':
                    cmp = a.created_at.localeCompare(b.created_at);
                    break;
                case 'match_type': {
                    const ma =
                        MATCH_TYPE_ORDER[pa?.match_type || 'related'] ?? 3;
                    const mb =
                        MATCH_TYPE_ORDER[pb?.match_type || 'related'] ?? 3;
                    cmp = ma - mb;
                    break;
                }
            }
            return sortDesc ? -cmp : cmp;
        });

        return result;
    }, [proposals, typeFilter, search, sortField, sortDesc, parsed]);

    // Stats
    const stats = useMemo(() => {
        const s = {
            total: proposals.length,
            pending: 0,
            approved: 0,
            rejected: 0,
            skipped: 0,
            applied: 0
        };
        for (const p of proposals) {
            if (p.status in s) (s as any)[p.status]++;
        }
        return s;
    }, [proposals]);

    // Actions
    const decide = async (
        ids: number[],
        status: 'approved' | 'rejected' | 'skipped'
    ) => {
        if (ids.length === 1) {
            await fetch(`/app/api/ontologica/proposals/${ids[0]}/decide`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, decided_by: 'human' })
            });
        } else {
            await fetch('/app/api/ontologica/proposals/bulk-decide', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proposal_ids: ids,
                    status,
                    decided_by: 'human'
                })
            });
        }
        setSelected(new Set());
        loadProposals();
    };

    const applyApproved = async () => {
        // Find all unique job IDs with approved proposals
        const jobIds = [
            ...new Set(
                proposals
                    .filter(p => p.status === 'approved')
                    .map(p => p.job_id)
            )
        ];
        if (jobIds.length === 0) return;

        setApplying(true);
        try {
            for (const jobId of jobIds) {
                await fetch(
                    `/app/api/ontologica/jobs/${jobId}/apply-proposals`,
                    { method: 'POST' }
                );
            }
            loadProposals();
            loadGraph();
            loadStats();
        } finally {
            setApplying(false);
        }
    };

    const toggleSelect = (id: number) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = () => {
        if (selected.size === filtered.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(filtered.map(p => p.id)));
        }
    };

    const [manualMapOpen, setManualMapOpen] = useState(false);
    const [overrideProposal, setOverrideProposal] = useState<Proposal | null>(
        null
    );

    const handleOverride = async (
        item: BaseItem,
        proposalType: 'link_to_base' | 'subclass_of'
    ) => {
        if (!overrideProposal) return;
        await fetch(
            `/app/api/ontologica/proposals/${overrideProposal.id}/override`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_id: item.id,
                    proposal_type: proposalType
                })
            }
        );
        setOverrideProposal(null);
        loadProposals();
    };

    const selectedPending = [...selected].filter(
        id => proposals.find(p => p.id === id)?.status === 'pending'
    );

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Stats bar */}
            <div className="px-6 py-3 border-b flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-medium">{stats.total}</span>
                </div>
                {(
                    [
                        'pending',
                        'approved',
                        'rejected',
                        'skipped',
                        'applied'
                    ] as const
                ).map(s => (
                    <button
                        key={s}
                        onClick={() =>
                            setStatusFilter(statusFilter === s ? 'all' : s)
                        }
                        className={`flex items-center gap-1.5 text-sm transition-colors cursor-pointer ${
                            statusFilter === s
                                ? 'text-foreground font-medium'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {statusBadge(s)}
                        <span>{(stats as any)[s]}</span>
                    </button>
                ))}

                <div className="ml-auto flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setManualMapOpen(true)}
                        className="gap-1"
                    >
                        <Plus size={14} /> Manual Map
                    </Button>
                    {stats.approved > 0 && (
                        <Button
                            size="sm"
                            onClick={applyApproved}
                            disabled={applying}
                            className="bg-violet-600 hover:bg-violet-700"
                        >
                            {applying ? (
                                <Loader2
                                    size={14}
                                    className="mr-1.5 animate-spin"
                                />
                            ) : (
                                <Play size={14} className="mr-1.5" />
                            )}
                            Apply {stats.approved} Approved
                        </Button>
                    )}
                </div>
            </div>

            {/* Filters bar */}
            <div className="px-6 py-2 border-b flex items-center gap-3">
                <div className="relative flex-1 max-w-xs">
                    <Search
                        size={14}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        placeholder="Search nodes..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-8 h-8 text-sm"
                    />
                </div>

                <div className="flex items-center gap-1">
                    <Filter size={14} className="text-muted-foreground" />
                    {(
                        ['all', 'link_to_base', 'subclass_of', 'merge'] as const
                    ).map(t => (
                        <button
                            key={t}
                            onClick={() =>
                                setTypeFilter(typeFilter === t ? 'all' : t)
                            }
                            className={`px-2 py-1 text-xs rounded transition-colors cursor-pointer ${
                                typeFilter === t
                                    ? 'bg-muted text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {t === 'all' ? 'All types' : t.replace(/_/g, ' ')}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-1 ml-auto">
                    <ArrowUpDown size={14} className="text-muted-foreground" />
                    {(['confidence', 'match_type', 'created_at'] as const).map(
                        f => (
                            <button
                                key={f}
                                onClick={() => {
                                    if (sortField === f) setSortDesc(!sortDesc);
                                    else {
                                        setSortField(f);
                                        setSortDesc(true);
                                    }
                                }}
                                className={`px-2 py-1 text-xs rounded transition-colors cursor-pointer ${
                                    sortField === f
                                        ? 'bg-muted text-foreground'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {f === 'match_type'
                                    ? 'match'
                                    : f.replace(/_/g, ' ')}
                                {sortField === f && (sortDesc ? ' ↓' : ' ↑')}
                            </button>
                        )
                    )}
                </div>
            </div>

            {/* Bulk actions */}
            {selected.size > 0 && (
                <div className="px-6 py-2 border-b bg-muted/30 flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                        {selected.size} selected
                    </span>
                    {selectedPending.length > 0 && (
                        <>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 text-green-400 border-green-500/30 hover:bg-green-500/10"
                                onClick={() =>
                                    decide(selectedPending, 'approved')
                                }
                            >
                                <CheckCheck size={12} /> Approve{' '}
                                {selectedPending.length}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10"
                                onClick={() =>
                                    decide(selectedPending, 'rejected')
                                }
                            >
                                <XCircle size={12} /> Reject{' '}
                                {selectedPending.length}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1"
                                onClick={() =>
                                    decide(selectedPending, 'skipped')
                                }
                            >
                                <SkipForward size={12} /> Skip{' '}
                                {selectedPending.length}
                            </Button>
                        </>
                    )}
                    <button
                        onClick={() => setSelected(new Set())}
                        className="text-xs text-muted-foreground hover:text-foreground ml-auto cursor-pointer"
                    >
                        Clear selection
                    </button>
                </div>
            )}

            {/* Dialogs */}
            <ManualMapDialog
                projectId={projectId}
                open={manualMapOpen}
                onClose={() => setManualMapOpen(false)}
                onCreated={() => {
                    loadProposals();
                    loadGraph();
                    loadStats();
                }}
            />
            <BaseItemSearchDialog
                projectId={projectId}
                open={!!overrideProposal}
                onClose={() => setOverrideProposal(null)}
                onSelect={handleOverride}
                title={
                    overrideProposal
                        ? `Override mapping for "${parsed.get(overrideProposal.id)?.node_name || 'node'}"`
                        : 'Override mapping'
                }
            />

            {/* Proposal list */}
            <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-2">
                {loading ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                        <Loader2 size={20} className="animate-spin mr-2" />{' '}
                        Loading proposals...
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                        {proposals.length === 0
                            ? 'No proposals yet. Run a Map or Deduplicate pipeline first.'
                            : 'No proposals match your filters.'}
                    </div>
                ) : (
                    <>
                        {/* Select all toggle */}
                        <div className="flex items-center gap-2 px-2 pb-1">
                            <input
                                type="checkbox"
                                checked={
                                    selected.size === filtered.length &&
                                    filtered.length > 0
                                }
                                onChange={selectAll}
                                className="rounded cursor-pointer"
                            />
                            <span className="text-xs text-muted-foreground">
                                {filtered.length} proposal
                                {filtered.length !== 1 ? 's' : ''}
                            </span>
                        </div>

                        {filtered.map(proposal => {
                            const payload = parsed.get(proposal.id) || {};
                            const isSelected = selected.has(proposal.id);
                            const isPending = proposal.status === 'pending';

                            return (
                                <ProposalCard
                                    key={proposal.id}
                                    proposal={proposal}
                                    payload={payload}
                                    isSelected={isSelected}
                                    isPending={isPending}
                                    onToggleSelect={() =>
                                        toggleSelect(proposal.id)
                                    }
                                    onDecide={status =>
                                        decide([proposal.id], status)
                                    }
                                    onOverride={() =>
                                        setOverrideProposal(proposal)
                                    }
                                />
                            );
                        })}
                    </>
                )}
            </div>
        </div>
    );
}

// ── Base Item Search Dialog ──────────────────────────────────────────────────

interface BaseItem {
    id: number;
    layer_id: number;
    item_type: string;
    uri: string;
    local_name: string;
    label: string;
    description: string;
    layer_name: string;
    layer_slug: string;
}

function BaseItemSearchDialog({
    projectId,
    open,
    onClose,
    onSelect,
    title = 'Search Base Layer Items'
}: {
    projectId: number;
    open: boolean;
    onClose: () => void;
    onSelect: (
        item: BaseItem,
        proposalType: 'link_to_base' | 'subclass_of'
    ) => void;
    title?: string;
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<BaseItem[]>([]);
    const [searching, setSearching] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

    useEffect(() => {
        if (!open) {
            setQuery('');
            setResults([]);
        }
    }, [open]);

    const doSearch = useCallback(
        (q: string) => {
            if (q.length < 2) {
                setResults([]);
                return;
            }
            setSearching(true);
            fetch(
                `/app/api/ontologica/projects/${projectId}/base-items/search?q=${encodeURIComponent(q)}`
            )
                .then(r => r.json())
                .then(setResults)
                .finally(() => setSearching(false));
        },
        [projectId]
    );

    const handleChange = (val: string) => {
        setQuery(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => doSearch(val), 300);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={v => {
                if (!v) onClose();
            }}
        >
            <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <div className="relative">
                    <Search
                        size={14}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        placeholder="Search base items (e.g. 'Accounting Service')..."
                        value={query}
                        onChange={e => handleChange(e.target.value)}
                        className="pl-8"
                        autoFocus
                    />
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 space-y-1 mt-2">
                    {searching && (
                        <div className="flex items-center justify-center py-4 text-muted-foreground">
                            <Loader2 size={16} className="animate-spin mr-2" />{' '}
                            Searching...
                        </div>
                    )}
                    {!searching &&
                        results.length === 0 &&
                        query.length >= 2 && (
                            <div className="text-center py-4 text-sm text-muted-foreground">
                                No results found
                            </div>
                        )}
                    {results.map(item => (
                        <div
                            key={item.id}
                            className="p-2 rounded-md border hover:bg-muted/50 transition-colors"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium text-sm">
                                        {item.label || item.local_name}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-xs text-violet-400/70">
                                            {item.layer_name}
                                        </span>
                                        {item.description && (
                                            <span className="text-xs text-muted-foreground truncate">
                                                {item.description}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs gap-1 text-green-400 border-green-500/30 hover:bg-green-500/10"
                                        onClick={() =>
                                            onSelect(item, 'link_to_base')
                                        }
                                        title="Same as (direct link)"
                                    >
                                        <Link size={10} /> Same
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs gap-1 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                                        onClick={() =>
                                            onSelect(item, 'subclass_of')
                                        }
                                        title="Is a type of (subclass)"
                                    >
                                        <GitBranch size={10} /> Type of
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Manual Map Dialog ───────────────────────────────────────────────────────

function ManualMapDialog({
    projectId,
    open,
    onClose,
    onCreated
}: {
    projectId: number;
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
}) {
    const [nodes, setNodes] = useState<
        Array<{ id: number; name: string; description: string }>
    >([]);
    const [selectedNode, setSelectedNode] = useState<{
        id: number;
        name: string;
    } | null>(null);
    const [nodeSearch, setNodeSearch] = useState('');
    const [showItemSearch, setShowItemSearch] = useState(false);
    const [_loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            setSelectedNode(null);
            setNodeSearch('');
            setNodes([]);
            return;
        }
        // Load unmapped nodes
        fetch(`/app/api/ontologica/projects/${projectId}/nodes`)
            .then(r => r.json())
            .then((data: any[]) =>
                setNodes(data.filter((n: any) => !n.layer_id))
            );
    }, [open, projectId]);

    const filteredNodes = useMemo(() => {
        if (!nodeSearch) return nodes.slice(0, 50);
        const q = nodeSearch.toLowerCase();
        return nodes.filter(n => n.name.toLowerCase().includes(q)).slice(0, 50);
    }, [nodes, nodeSearch]);

    const handleItemSelect = async (
        item: BaseItem,
        proposalType: 'link_to_base' | 'subclass_of'
    ) => {
        if (!selectedNode) return;
        setLoading(true);
        try {
            await fetch(
                `/app/api/ontologica/projects/${projectId}/proposals/manual`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        node_id: selectedNode.id,
                        item_id: item.id,
                        proposal_type: proposalType,
                        apply_immediately: true
                    })
                }
            );
            setShowItemSearch(false);
            onCreated();
            onClose();
        } finally {
            setLoading(false);
        }
    };

    if (showItemSearch && selectedNode) {
        return (
            <BaseItemSearchDialog
                projectId={projectId}
                open={true}
                onClose={() => setShowItemSearch(false)}
                onSelect={handleItemSelect}
                title={`Map "${selectedNode.name}" to base item`}
            />
        );
    }

    return (
        <Dialog
            open={open}
            onOpenChange={v => {
                if (!v) onClose();
            }}
        >
            <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Manual Map — Select Node</DialogTitle>
                </DialogHeader>
                <div className="relative">
                    <Search
                        size={14}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        placeholder="Filter unmapped nodes..."
                        value={nodeSearch}
                        onChange={e => setNodeSearch(e.target.value)}
                        className="pl-8"
                        autoFocus
                    />
                </div>
                <div className="text-xs text-muted-foreground">
                    {nodes.length} unmapped nodes
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 space-y-1 mt-1">
                    {filteredNodes.map(node => (
                        <button
                            key={node.id}
                            onClick={() => {
                                setSelectedNode(node);
                                setShowItemSearch(true);
                            }}
                            className="w-full text-left p-2 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer"
                        >
                            <div className="font-medium text-sm">
                                {node.name}
                            </div>
                            {node.description && (
                                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                                    {node.description}
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Proposal Card ────────────────────────────────────────────────────────────

function ProposalCard({
    proposal,
    payload,
    isSelected,
    isPending,
    onToggleSelect,
    onDecide,
    onOverride
}: {
    proposal: Proposal;
    payload: ParsedPayload;
    isSelected: boolean;
    isPending: boolean;
    onToggleSelect: () => void;
    onDecide: (status: 'approved' | 'rejected' | 'skipped') => void;
    onOverride: () => void;
}) {
    return (
        <Card
            className={`transition-colors ${isSelected ? 'ring-1 ring-violet-500/50' : ''}`}
        >
            <CardContent className="p-3">
                <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={onToggleSelect}
                        className="mt-1 rounded cursor-pointer"
                    />

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-2">
                        {/* Header row */}
                        <div className="flex items-center gap-2 flex-wrap">
                            {proposalTypeBadge(proposal.proposal_type)}
                            {matchTypeBadge(payload.match_type)}
                            {statusBadge(proposal.status)}
                            <span className="text-xs text-muted-foreground ml-auto">
                                Job #{proposal.job_id}
                            </span>
                        </div>

                        {/* Mapping visualization */}
                        {(proposal.proposal_type === 'link_to_base' ||
                            proposal.proposal_type === 'subclass_of') && (
                            <div className="flex items-center gap-3">
                                {/* Source node */}
                                <div className="flex-1 min-w-0 p-2 rounded-md bg-muted/50 border">
                                    <div className="font-medium text-sm truncate">
                                        {payload.node_name ||
                                            `Node #${payload.node_id}`}
                                    </div>
                                    {payload.node_description && (
                                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                            {payload.node_description}
                                        </div>
                                    )}
                                </div>

                                {/* Arrow */}
                                <div className="flex flex-col items-center gap-0.5 shrink-0">
                                    <span className="text-xs text-muted-foreground">
                                        {proposal.proposal_type ===
                                        'link_to_base'
                                            ? '='
                                            : '⊂'}
                                    </span>
                                    <span className="text-muted-foreground">
                                        →
                                    </span>
                                </div>

                                {/* Target base item */}
                                <div className="flex-1 min-w-0 p-2 rounded-md bg-violet-500/5 border border-violet-500/20">
                                    <div className="font-medium text-sm truncate text-violet-300">
                                        {payload.base_item_name ||
                                            `Item #${payload.item_id}`}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-xs text-violet-400/70">
                                            {payload.layer_name}
                                        </span>
                                        {payload.base_item_description && (
                                            <span className="text-xs text-muted-foreground truncate">
                                                {payload.base_item_description}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Merge visualization */}
                        {proposal.proposal_type === 'merge' && (
                            <div className="p-2 rounded-md bg-muted/50 border">
                                <div className="text-sm">
                                    Merge {payload.duplicate_ids?.length || 0}{' '}
                                    duplicate
                                    {(payload.duplicate_ids?.length || 0) !== 1
                                        ? 's'
                                        : ''}{' '}
                                    into canonical node #{payload.canonical_id}
                                </div>
                            </div>
                        )}

                        {/* Confidence */}
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                    Confidence
                                </span>
                                {confidenceBar(proposal.confidence)}
                            </div>
                            {payload.embedding_similarity != null && (
                                <div className="text-xs text-muted-foreground">
                                    Embedding:{' '}
                                    {Math.round(
                                        payload.embedding_similarity * 100
                                    )}
                                    %
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    {isPending && (
                        <div className="flex flex-col gap-1 shrink-0">
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-green-400 hover:text-green-300 hover:bg-green-500/10"
                                onClick={() => onDecide('approved')}
                                title="Approve"
                            >
                                <Check size={14} />
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => onDecide('rejected')}
                                title="Reject"
                            >
                                <X size={14} />
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => onDecide('skipped')}
                                title="Skip"
                            >
                                <SkipForward size={14} />
                            </Button>
                            {(proposal.proposal_type === 'link_to_base' ||
                                proposal.proposal_type === 'subclass_of') && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                    onClick={onOverride}
                                    title="Override — change target"
                                >
                                    <Pencil size={14} />
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
