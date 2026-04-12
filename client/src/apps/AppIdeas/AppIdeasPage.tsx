// oxlint-disable no-console
import {
    Background,
    BackgroundVariant,
    MarkerType,
    MiniMap,
    Panel,
    ReactFlow,
    SelectionMode,
    addEdge,
    useEdgesState,
    useNodesState,
    useReactFlow,
    type Connection,
    type Edge,
    type EdgeProps,
    type Node,
    type NodeChange
} from '@xyflow/react';
import {
    Filter,
    GitBranch,
    Lightbulb,
    Lock,
    Maximize2,
    Plus,
    RefreshCw,
    Unlock,
    ZoomIn,
    ZoomOut
} from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppTracking } from '@/apps/Analytics/AnalyticsProvider';
import { AppLayout } from '@/components/AppLayout';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip';

import { IdeaCardNode } from './IdeaCardNode';
import IdeaModal from './IdeaModal';
import { GROUP_COLORS, STAGE_META } from './types';

import type { AppIdea, AppIdeaConnection, Stage } from './types';

// Custom "string/thread" edge — droopy bezier with a gravity dip
function StringEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    label,
    markerEnd,
    style
}: EdgeProps) {
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const droop = Math.min(dist * 0.22, 90);

    const cx1 = sourceX + dx * 0.25;
    const cy1 = sourceY + dy * 0.25 + droop;
    const cx2 = sourceX + dx * 0.75;
    const cy2 = sourceY + dy * 0.75 + droop;

    const d = `M ${sourceX},${sourceY} C ${cx1},${cy1} ${cx2},${cy2} ${targetX},${targetY}`;

    // midpoint of cubic bezier at t=0.5
    const midX = 0.125 * sourceX + 0.375 * cx1 + 0.375 * cx2 + 0.125 * targetX;
    const midY = 0.125 * sourceY + 0.375 * cy1 + 0.375 * cy2 + 0.125 * targetY;

    return (
        <>
            <path
                id={id}
                d={d}
                fill="none"
                style={style}
                markerEnd={markerEnd as string}
            />
            {label && (
                <g transform={`translate(${midX},${midY})`}>
                    <rect
                        x="-22"
                        y="-8"
                        width="44"
                        height="16"
                        rx="3"
                        fill="rgba(0,0,0,0.7)"
                        opacity="0.9"
                    />
                    <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                            fontSize: 9,
                            fill: '#a0a0c0',
                            fontStyle: 'italic',
                            fontFamily: 'serif'
                        }}
                    >
                        {label as string}
                    </text>
                </g>
            )}
        </>
    );
}

const nodeTypes = { ideaCard: IdeaCardNode };
const edgeTypes = { string: StringEdge };

const GRID_COL_W = 270;
const GRID_ROW_H = 230;

// Paper color palettes per group — warm, physical, light
const PAPER_PALETTES = [
    { bg: '#fef9ec', border: '#d4b96a', stack: '#f5e8c0' }, // cream
    { bg: '#eff7ff', border: '#9bbcd8', stack: '#d8ecf7' }, // sky blue
    { bg: '#f4fdf6', border: '#88c9a2', stack: '#c8ecd6' }, // mint
    { bg: '#fdf4ff', border: '#c49ad4', stack: '#e8ccf0' }, // lavender
    { bg: '#fff8f0', border: '#d4956a', stack: '#f5d8b8' }, // peach
    { bg: '#f8fff0', border: '#9dc46a', stack: '#d8edbc' } // lime
];

// Seeded pseudo-random rotation per idea id
function seedRotation(id: number): number {
    const s = ((id * 7919 + 31337) % 1000) / 1000; // 0..1
    return s * 7 - 3.5; // -3.5 to +3.5 degrees
}

function layoutIdeas(
    ideas: AppIdea[]
): Record<number, { x: number; y: number }> {
    const positioned: Record<number, { x: number; y: number }> = {};
    const groups: Record<string, AppIdea[]> = {};

    for (const idea of ideas) {
        if (idea.pos_x !== 0 || idea.pos_y !== 0) {
            positioned[idea.id] = { x: idea.pos_x, y: idea.pos_y };
        } else {
            const g = idea.group_name || '__ungrouped__';
            groups[g] = groups[g] || [];
            groups[g].push(idea);
        }
    }

    const groupNames = Object.keys(groups);
    groupNames.forEach((group, gi) => {
        const items = groups[group];
        items.forEach((idea, i) => {
            const col = i % 4;
            const row = Math.floor(i / 4);
            positioned[idea.id] = {
                x: gi * (GRID_COL_W * 4 + 80) + col * GRID_COL_W,
                y: row * GRID_ROW_H + 60
            };
        });
    });

    return positioned;
}

// Custom canvas controls — uses useReactFlow so must live inside ReactFlow context
function CanvasControls({
    locked,
    setLocked
}: {
    locked: boolean;
    setLocked: (v: boolean) => void;
}) {
    const { zoomIn, zoomOut, fitView } = useReactFlow();

    const btn =
        'cursor-pointer flex items-center justify-center w-8 h-8 rounded-md text-foreground hover:bg-muted transition-colors';

    return (
        <TooltipProvider delayDuration={400}>
            <div className="flex flex-col gap-0.5 p-1 rounded-xl bg-card border border-border shadow-md">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            className={btn}
                            onClick={() => zoomIn({ duration: 200 })}
                        >
                            <ZoomIn size={15} strokeWidth={2} />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Zoom in</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            className={btn}
                            onClick={() => zoomOut({ duration: 200 })}
                        >
                            <ZoomOut size={15} strokeWidth={2} />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Zoom out</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            className={btn}
                            onClick={() =>
                                fitView({ duration: 300, padding: 0.15 })
                            }
                        >
                            <Maximize2 size={14} strokeWidth={2} />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Fit view</TooltipContent>
                </Tooltip>

                <div className="my-0.5 h-px bg-border mx-1" />

                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            className={`${btn} ${locked ? 'text-amber-500' : ''}`}
                            onClick={() => setLocked(!locked)}
                        >
                            {locked ? (
                                <Lock size={14} strokeWidth={2} />
                            ) : (
                                <Unlock size={14} strokeWidth={2} />
                            )}
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        {locked ? 'Unlock canvas' : 'Lock canvas'}
                    </TooltipContent>
                </Tooltip>
            </div>
        </TooltipProvider>
    );
}

export default function AppIdeasPage() {
    const { trackPageView } = useAppTracking('appideas');
    useEffect(() => {
        trackPageView();
    }, [trackPageView]);
    const [ideas, setIdeas] = useState<AppIdea[]>([]);
    const [connections, setConnections] = useState<AppIdeaConnection[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingIdea, setEditingIdea] = useState<AppIdea | null>(null);
    const [stageFilter, setStageFilter] = useState<Stage | 'all'>('all');
    const [groupFilter, setGroupFilter] = useState<string | 'all'>('all');
    const [showFilters, setShowFilters] = useState(false);
    const [showEdges, setShowEdges] = useState(true);
    const [locked, setLocked] = useState(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

    // Assign group colors
    const groupColorMap = useMemo(() => {
        const map: Record<string, string> = {};
        const groups = [
            ...new Set(ideas.map(i => i.group_name).filter(Boolean) as string[])
        ];
        groups.forEach((g, i) => {
            map[g] = GROUP_COLORS[i % GROUP_COLORS.length];
        });
        return map;
    }, [ideas]);

    const groups = useMemo(
        () => [
            ...new Set(ideas.map(i => i.group_name).filter(Boolean) as string[])
        ],
        [ideas]
    );

    // Group to palette index map
    const groupPaletteMap = useMemo(() => {
        const map: Record<string, number> = {};
        const gs = [
            ...new Set(ideas.map(i => i.group_name).filter(Boolean) as string[])
        ];
        gs.forEach((g, i) => {
            map[g] = i % PAPER_PALETTES.length;
        });
        return map;
    }, [ideas]);

    // Build React Flow nodes
    const buildNodes = useCallback(
        (
            ideasList: AppIdea[],
            stageF: Stage | 'all',
            groupF: string | 'all'
        ) => {
            const positions = layoutIdeas(ideasList);
            return ideasList.map(idea => {
                const paletteIdx =
                    idea.group_name !== null && idea.group_name !== undefined
                        ? (groupPaletteMap[idea.group_name] ?? 0)
                        : 0;
                const palette = PAPER_PALETTES[paletteIdx];
                return {
                    id: String(idea.id),
                    type: 'ideaCard',
                    position: positions[idea.id] || { x: 0, y: 0 },
                    data: {
                        ...idea,
                        tags:
                            typeof idea.tags === 'string'
                                ? JSON.parse(idea.tags)
                                : idea.tags,
                        color: idea.group_name
                            ? groupColorMap[idea.group_name]
                            : null,
                        rotation: seedRotation(idea.id),
                        paperColor: palette.bg,
                        paperBorder: palette.border,
                        stackColor: palette.stack,
                        isFiltered:
                            (stageF !== 'all' && idea.stage !== stageF) ||
                            (groupF !== 'all' && idea.group_name !== groupF),
                        onEdit: (i: AppIdea) => {
                            setEditingIdea(i);
                            setShowModal(true);
                        },
                        onDelete: async (id: number) => {
                            await fetch(`/app/api/app-ideas/${id}`, {
                                method: 'DELETE'
                            });
                            setIdeas(prev => prev.filter(x => x.id !== id));
                        }
                    }
                } as Node;
            });
        },
        [groupColorMap, groupPaletteMap]
    );

    // Build React Flow edges - droopy string/thread look
    const buildEdges = useCallback((conns: AppIdeaConnection[]) => {
        return conns.map(
            c =>
                ({
                    id: `e${c.id}`,
                    source: String(c.source_id),
                    target: String(c.target_id),
                    label: c.label || undefined,
                    type: 'string',
                    animated: false,
                    style: {
                        stroke: '#7c6fcd',
                        strokeWidth: 1.5,
                        opacity: 0.55,
                        strokeDasharray: '5 4'
                    },
                    markerEnd: {
                        type: MarkerType.Arrow,
                        width: 12,
                        height: 12,
                        color: '#7c6fcd'
                    }
                }) as Edge
        );
    }, []);

    const fetchData = useCallback(async () => {
        try {
            const r = await fetch('/app/api/app-ideas');
            const d = await r.json();
            const parsedIdeas = d.ideas.map((i: AppIdea) => ({
                ...i,
                tags: typeof i.tags === 'string' ? JSON.parse(i.tags) : i.tags
            }));
            setIdeas(parsedIdeas);
            setConnections(d.connections);
        } catch (e) {
            console.error('Failed to fetch app ideas', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Rebuild nodes when ideas data changes (initial load, create, edit, delete)
    useEffect(() => {
        setNodes(buildNodes(ideas, stageFilter, groupFilter));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ideas, buildNodes, setNodes]);

    // When filters change, only patch the isFiltered flag — never touch positions
    useEffect(() => {
        setNodes(prev =>
            prev.map(node => {
                const idea = ideas.find(i => String(i.id) === node.id);
                if (!idea) return node;
                const isFiltered =
                    (stageFilter !== 'all' && idea.stage !== stageFilter) ||
                    (groupFilter !== 'all' && idea.group_name !== groupFilter);
                return node.data.isFiltered === isFiltered
                    ? node
                    : { ...node, data: { ...node.data, isFiltered } };
            })
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stageFilter, groupFilter]);

    useEffect(() => {
        setEdges(buildEdges(connections));
    }, [connections, buildEdges, setEdges]);

    // Debounced position save on drag
    const handleNodesChange = useCallback(
        (changes: NodeChange[]) => {
            onNodesChange(changes);
            const moves = changes.filter(
                c => c.type === 'position' && c.dragging === false
            );
            if (moves.length === 0) return;

            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => {
                moves.forEach(c => {
                    if (c.type !== 'position' || !c.position) return;
                    fetch(`/app/api/app-ideas/${c.id}/position`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            pos_x: c.position.x,
                            pos_y: c.position.y
                        })
                    }).catch(console.error);
                });
            }, 400);
        },
        [onNodesChange]
    );

    // Add connection on drag
    const onConnect = useCallback(
        async (params: Connection) => {
            const r = await fetch('/app/api/app-ideas/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_id: Number(params.source),
                    target_id: Number(params.target)
                })
            });
            const conn = await r.json();
            setConnections(prev => [...prev, conn]);
            setEdges(eds =>
                addEdge(
                    {
                        ...params,
                        type: 'string',
                        style: {
                            stroke: '#7c6fcd',
                            strokeWidth: 1.5,
                            opacity: 0.55,
                            strokeDasharray: '5 4'
                        }
                    },
                    eds
                )
            );
        },
        [setEdges]
    );

    const handleSave = async (data: Partial<AppIdea>) => {
        if (editingIdea) {
            const r = await fetch(`/app/api/app-ideas/${editingIdea.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...editingIdea, ...data })
            });
            const updated = await r.json();
            setIdeas(prev =>
                prev.map(i =>
                    i.id === updated.id
                        ? {
                              ...updated,
                              tags:
                                  typeof updated.tags === 'string'
                                      ? JSON.parse(updated.tags)
                                      : updated.tags
                          }
                        : i
                )
            );
        } else {
            const pos = {
                pos_x: Math.random() * 400,
                pos_y: Math.random() * 400
            };
            const r = await fetch('/app/api/app-ideas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, ...pos })
            });
            const created = await r.json();
            setIdeas(prev => [
                ...prev,
                {
                    ...created,
                    tags:
                        typeof created.tags === 'string'
                            ? JSON.parse(created.tags)
                            : created.tags
                }
            ]);
        }
        setShowModal(false);
        setEditingIdea(null);
    };

    const headerActions = (
        <div className="flex items-center gap-2">
            {/* Stage filter pills — hidden on mobile */}
            <div className="hidden md:flex items-center gap-1.5">
                <button
                    onClick={() => setStageFilter('all')}
                    className={`cursor-pointer px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                        stageFilter === 'all'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-accent'
                    }`}
                >
                    All
                </button>
                {(Object.keys(STAGE_META) as Stage[]).map(s => {
                    const m = STAGE_META[s];
                    const count = ideas.filter(i => i.stage === s).length;
                    if (count === 0) return null;
                    return (
                        <button
                            key={s}
                            onClick={() =>
                                setStageFilter(stageFilter === s ? 'all' : s)
                            }
                            className={`cursor-pointer flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                                stageFilter === s
                                    ? `${m.bg} ${m.color} ${m.border}`
                                    : 'border-transparent text-muted-foreground hover:bg-accent'
                            }`}
                        >
                            <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ background: m.dot }}
                            />
                            {m.label}
                            <span className="opacity-60">{count}</span>
                        </button>
                    );
                })}
            </div>

            {/* Lines toggle */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        onClick={() => setShowEdges(v => !v)}
                        className={`cursor-pointer p-1.5 rounded-lg border transition-all ${
                            showEdges
                                ? 'bg-accent text-foreground border-border'
                                : 'text-muted-foreground border-transparent hover:bg-accent/50'
                        }`}
                    >
                        <GitBranch size={15} />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                    {showEdges ? 'Hide connections' : 'Show connections'}
                </TooltipContent>
            </Tooltip>

            {/* Filter toggle — mobile only */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`cursor-pointer p-1.5 rounded-lg md:hidden transition-colors ${showFilters ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                    >
                        <Filter size={16} />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Filter by stage</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        onClick={() => {
                            setEditingIdea(null);
                            setShowModal(true);
                        }}
                        className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                    >
                        <Plus size={14} />
                        <span className="hidden sm:inline">Add idea</span>
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Add a new idea</TooltipContent>
            </Tooltip>
        </div>
    );

    return (
        <TooltipProvider delayDuration={400}>
            <AppLayout
                icon={<Lightbulb size={20} />}
                iconClassName="bg-violet-500/10 text-violet-500"
                title="App Ideas"
                subtitle={`${ideas.length} idea${ideas.length === 1 ? '' : 's'} on the canvas`}
                actions={headerActions}
            >
                <div className="flex flex-col h-full">
                    {/* Mobile filter bar */}
                    {showFilters && (
                        <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto shrink-0 bg-background/90 border-b border-border">
                            <button
                                onClick={() => setStageFilter('all')}
                                className={`cursor-pointer whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-medium transition-all ${stageFilter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                            >
                                All stages
                            </button>
                            {(Object.keys(STAGE_META) as Stage[]).map(s => {
                                const m = STAGE_META[s];
                                return (
                                    <button
                                        key={s}
                                        onClick={() =>
                                            setStageFilter(
                                                stageFilter === s ? 'all' : s
                                            )
                                        }
                                        className={`cursor-pointer whitespace-nowrap flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${stageFilter === s ? `${m.bg} ${m.color} ${m.border}` : 'border-transparent text-muted-foreground hover:bg-accent'}`}
                                    >
                                        <span
                                            className="w-1.5 h-1.5 rounded-full"
                                            style={{ background: m.dot }}
                                        />
                                        {m.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Group filter (secondary bar) */}
                    {groups.length > 0 && (
                        <div className="flex items-center gap-1.5 px-4 py-1.5 overflow-x-auto shrink-0 bg-background/60 border-b border-border/50">
                            <span className="text-xs text-muted-foreground/50 shrink-0">
                                Group:
                            </span>
                            <button
                                onClick={() => setGroupFilter('all')}
                                className={`cursor-pointer whitespace-nowrap px-2 py-0.5 rounded-full text-xs transition-all ${groupFilter === 'all' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'}`}
                            >
                                All
                            </button>
                            {groups.map(g => (
                                <button
                                    key={g}
                                    onClick={() =>
                                        setGroupFilter(
                                            groupFilter === g ? 'all' : g
                                        )
                                    }
                                    className={`cursor-pointer whitespace-nowrap flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all ${groupFilter === g ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'}`}
                                >
                                    <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ background: groupColorMap[g] }}
                                    />
                                    {g}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Canvas */}
                    <div className="flex-1 relative">
                        {loading ? (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <RefreshCw
                                    size={20}
                                    className="animate-spin text-muted-foreground"
                                />
                            </div>
                        ) : ideas.length === 0 ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
                                <div className="text-4xl">💡</div>
                                <div>
                                    <p className="font-semibold text-base mb-1">
                                        No ideas yet
                                    </p>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        Start capturing your app ideas on the
                                        canvas
                                    </p>
                                    <button
                                        onClick={() => setShowModal(true)}
                                        className="cursor-pointer px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                                    >
                                        Add first idea
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <ReactFlow
                                nodes={nodes}
                                edges={showEdges ? edges : []}
                                onNodesChange={handleNodesChange}
                                onEdgesChange={onEdgesChange}
                                onConnect={onConnect}
                                nodeTypes={nodeTypes}
                                edgeTypes={edgeTypes}
                                fitView
                                fitViewOptions={{ padding: 0.15 }}
                                minZoom={0.1}
                                maxZoom={2}
                                proOptions={{ hideAttribution: true }}
                                selectionOnDrag={!locked}
                                selectionMode={SelectionMode.Partial}
                                multiSelectionKeyCode="Shift"
                                nodesDraggable={!locked}
                                nodesConnectable={!locked}
                                panOnDrag={!locked}
                                onNodeDoubleClick={(_, node) => {
                                    const idea = ideas.find(
                                        i => String(i.id) === node.id
                                    );
                                    if (idea) {
                                        setEditingIdea(idea);
                                        setShowModal(true);
                                    }
                                }}
                                style={{ background: 'hsl(var(--background))' }}
                            >
                                <Background
                                    variant={BackgroundVariant.Dots}
                                    gap={28}
                                    size={1}
                                    color="rgba(255,255,255,0.06)"
                                />
                                <Panel position="bottom-left">
                                    <CanvasControls
                                        locked={locked}
                                        setLocked={setLocked}
                                    />
                                </Panel>
                                <MiniMap
                                    style={{
                                        background: 'hsl(var(--card))',
                                        border: '1px solid hsl(var(--border))',
                                        borderRadius: '10px'
                                    }}
                                    nodeColor={n => {
                                        const idea = ideas.find(
                                            i => String(i.id) === n.id
                                        );
                                        if (!idea) return 'hsl(var(--muted))';
                                        const paletteIdx = idea.group_name
                                            ? (groupPaletteMap[
                                                  idea.group_name
                                              ] ?? 0)
                                            : 0;
                                        return PAPER_PALETTES[paletteIdx]
                                            .border;
                                    }}
                                    maskColor="rgba(0,0,0,0.5)"
                                />
                                <Panel position="bottom-center">
                                    <div className="text-xs text-muted-foreground/40 pb-2 italic select-none tracking-wide">
                                        drag cards · shift+drag to select many ·
                                        draw connections between handles
                                    </div>
                                </Panel>
                            </ReactFlow>
                        )}
                    </div>

                    {/* Modal */}
                    {showModal && (
                        <IdeaModal
                            idea={editingIdea}
                            onSave={handleSave}
                            onClose={() => {
                                setShowModal(false);
                                setEditingIdea(null);
                            }}
                        />
                    )}
                </div>
            </AppLayout>
        </TooltipProvider>
    );
}
