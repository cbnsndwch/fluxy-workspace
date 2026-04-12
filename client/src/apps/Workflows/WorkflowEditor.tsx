// oxlint-disable no-console
import { useCallback, useEffect, useRef, useState } from 'react';
let _nodeIdCounter = 0;
const nextNodeId = () => ++_nodeIdCounter;
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    MiniMap,
    Panel,
    useNodesState,
    useEdgesState,
    useReactFlow,
    addEdge,
    BackgroundVariant,
    MarkerType,
    type Node,
    type Edge,
    type Connection
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    ArrowLeft,
    Play,
    Loader2,
    ZoomIn,
    ZoomOut,
    Maximize2,
    Trash2,
    Download,
    Copy
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip';

import { NODE_REGISTRY } from './nodeRegistry';
import { workflowNodeTypes } from './nodes/WorkflowNodes';
import NodePalette from './panels/NodePalette';
import NodeProperties from './panels/NodeProperties';
import WorkflowRunner from './panels/WorkflowRunner';
import { WorkflowActionsContext } from './workflowContext';

import type {
    Workflow,
    WorkflowNodeType,
    WorkflowRun,
    WorkflowRunNode
} from './types';

interface Props {
    workflowId: string;
    onBack: () => void;
}

// Inner canvas component — has access to ReactFlow context
function EditorCanvas({
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeClick,
    onPaneClick,
    onDropNode
}: {
    nodes: Node[];
    edges: Edge[];
    onNodesChange: Parameters<typeof ReactFlow>[0]['onNodesChange'];
    onEdgesChange: Parameters<typeof ReactFlow>[0]['onEdgesChange'];
    onConnect: (c: Connection) => void;
    onNodeClick: (node: Node) => void;
    onPaneClick: () => void;
    onDropNode: (
        type: WorkflowNodeType,
        position: { x: number; y: number }
    ) => void;
}) {
    const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();

    const onDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            const type = e.dataTransfer.getData(
                'workflow/nodeType'
            ) as WorkflowNodeType;
            if (!type || !NODE_REGISTRY[type]) return;
            const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            onDropNode(type, pos);
        },
        [screenToFlowPosition, onDropNode]
    );

    const onDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }, []);

    const btn =
        'cursor-pointer flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors';

    return (
        <div
            className="flex-1 relative"
            onDrop={onDrop}
            onDragOver={onDragOver}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={workflowNodeTypes}
                defaultEdgeOptions={{
                    animated: false,
                    style: { stroke: '#94a3b8', strokeWidth: 1.5 },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        width: 12,
                        height: 12,
                        color: '#94a3b8'
                    }
                }}
                connectionLineStyle={{ stroke: '#94a3b8', strokeWidth: 1.5 }}
                connectionRadius={30}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.2}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
                onNodeClick={(_, node) => onNodeClick(node)}
                onPaneClick={onPaneClick}
                deleteKeyCode={null}
                multiSelectionKeyCode="Shift"
                selectionKeyCode="Shift"
                style={{ background: 'hsl(var(--background))' }}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={24}
                    size={1}
                    color="rgba(255,255,255,0.05)"
                />
                <Panel position="bottom-left">
                    <div className="flex flex-col gap-0.5 p-1 rounded-xl bg-card border border-border shadow-md">
                        <button
                            className={btn}
                            onClick={() => zoomIn({ duration: 200 })}
                        >
                            <ZoomIn size={13} />
                        </button>
                        <button
                            className={btn}
                            onClick={() => zoomOut({ duration: 200 })}
                        >
                            <ZoomOut size={13} />
                        </button>
                        <div className="my-0.5 h-px bg-border mx-1" />
                        <button
                            className={btn}
                            onClick={() =>
                                fitView({ duration: 300, padding: 0.2 })
                            }
                        >
                            <Maximize2 size={12} />
                        </button>
                    </div>
                </Panel>
                <MiniMap
                    style={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 10
                    }}
                    maskColor="rgba(0,0,0,0.5)"
                />
                {nodes.length === 0 && (
                    <Panel position="top-center">
                        <div className="mt-16 text-center pointer-events-none select-none">
                            <p className="text-sm text-muted-foreground/40">
                                Drag nodes from the left panel onto the canvas
                            </p>
                        </div>
                    </Panel>
                )}
            </ReactFlow>
        </div>
    );
}

function EditorInner({ workflowId, onBack }: Props) {
    const [workflow, setWorkflow] = useState<Workflow | null>(null);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [showRunner, setShowRunner] = useState(false);
    const [lastRun, setLastRun] = useState<WorkflowRun | null>(null);
    const [runNodes, setRunNodes] = useState<WorkflowRunNode[]>([]);

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nameRef = useRef(name);
    nameRef.current = name;

    // Clipboard for copy/paste
    const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] }>({
        nodes: [],
        edges: []
    });
    const pasteCountRef = useRef(0);

    // Load workflow
    useEffect(() => {
        fetch(`/app/api/workflows/${workflowId}`)
            .then(r => r.json())
            .then((wf: Workflow) => {
                setWorkflow(wf);
                setName(wf.name);
                setNodes(JSON.parse(wf.nodes || '[]'));
                setEdges(
                    (JSON.parse(wf.edges || '[]') as Edge[]).map(
                        ({ animated: _a, ...e }) => ({
                            ...e,
                            style: { stroke: '#94a3b8', strokeWidth: 1.5 },
                            markerEnd: {
                                type: MarkerType.ArrowClosed,
                                width: 12,
                                height: 12,
                                color: '#94a3b8'
                            }
                        })
                    )
                );
            })
            .catch(console.error);
    }, [workflowId, setNodes, setEdges]);

    // Auto-save nodes + edges (debounced) — reads latest via ref pattern
    // Strip transient run-time properties before persisting
    const scheduleSave = useCallback(() => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            setNodes(nds => {
                setEdges(eds => {
                    const cleanEdges = eds.map(
                        ({ animated: _a, ...rest }) => rest
                    );
                    fetch(`/app/api/workflows/${workflowId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: nameRef.current,
                            nodes: JSON.stringify(nds),
                            edges: JSON.stringify(cleanEdges)
                        })
                    }).catch(console.error);
                    return eds;
                });
                return nds;
            });
        }, 800);
    }, [workflowId, setNodes, setEdges]);

    const handleNodesChange = useCallback(
        (changes: Parameters<typeof onNodesChange>[0]) => {
            onNodesChange(changes);
            scheduleSave();
        },
        [onNodesChange, scheduleSave]
    );

    const handleEdgesChange = useCallback(
        (changes: Parameters<typeof onEdgesChange>[0]) => {
            onEdgesChange(changes);
            scheduleSave();
        },
        [onEdgesChange, scheduleSave]
    );

    const onConnect = useCallback(
        (params: Connection) => {
            setEdges(eds => addEdge(params, eds));
            scheduleSave();
        },
        [setEdges, scheduleSave]
    );

    const onDropNode = useCallback(
        (type: WorkflowNodeType, position: { x: number; y: number }) => {
            const node: Node = {
                id: `${type}-${Date.now()}`,
                type,
                position,
                data: { ...NODE_REGISTRY[type].defaultConfig }
            };
            setNodes(nds => [...nds, node]);
            scheduleSave();
        },
        [setNodes, scheduleSave]
    );

    // Save name
    const saveName = useCallback(async () => {
        if (!workflow || nameRef.current === workflow.name) return;
        setSaving(true);
        await fetch(`/app/api/workflows/${workflowId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: nameRef.current,
                nodes: workflow.nodes,
                edges: workflow.edges
            })
        });
        setWorkflow(prev => (prev ? { ...prev, name: nameRef.current } : prev));
        setSaving(false);
    }, [workflow, workflowId]);

    // Run workflow via SSE
    const handleRun = useCallback(async () => {
        setRunning(true);
        setShowRunner(true);
        setRunNodes([]);
        // Reset all edge animations at the start of a run
        setEdges(eds => eds.map(e => ({ ...e, animated: false })));

        const es = new EventSource(
            `/app/api/workflows/${workflowId}/run/stream`
        );

        es.onmessage = ev => {
            try {
                const data = JSON.parse(ev.data);

                if (
                    data.type === 'done' ||
                    data.type === 'run_complete' ||
                    data.type === 'run_error'
                ) {
                    es.close();
                    setRunning(false);
                    if (data.run_id) {
                        fetch(`/app/api/workflow-runs/${data.run_id}`)
                            .then(r => r.json())
                            .then(
                                ({
                                    run,
                                    nodes: rn
                                }: {
                                    run: WorkflowRun;
                                    nodes: WorkflowRunNode[];
                                }) => {
                                    setLastRun(run);
                                    setRunNodes(rn);
                                    const statusMap: Record<
                                        string,
                                        WorkflowRunNode
                                    > = {};
                                    for (const n of rn)
                                        statusMap[n.node_id] = n;
                                    setNodes(nds =>
                                        nds.map(n => ({
                                            ...n,
                                            data: {
                                                ...n.data,
                                                runStatus:
                                                    statusMap[n.id]?.status ??
                                                    undefined
                                            }
                                        }))
                                    );
                                    // Animate edges where data actually flowed through:
                                    // an edge was traversed if its target node was executed (success or error, not skipped)
                                    const executedNodes = new Set(
                                        rn
                                            .filter(
                                                n =>
                                                    n.status === 'success' ||
                                                    n.status === 'error'
                                            )
                                            .map(n => n.node_id)
                                    );
                                    setEdges(eds =>
                                        eds.map(e => ({
                                            ...e,
                                            animated: executedNodes.has(
                                                e.target
                                            )
                                        }))
                                    );
                                }
                            )
                            .catch(console.error);
                    }
                } else if (data.node_id) {
                    // Live status update
                    setNodes(nds =>
                        nds.map(n =>
                            n.id === data.node_id
                                ? {
                                      ...n,
                                      data: {
                                          ...n.data,
                                          runStatus: data.status
                                      }
                                  }
                                : n
                        )
                    );
                    setRunNodes(prev => {
                        const idx = prev.findIndex(
                            n => n.node_id === data.node_id
                        );
                        const updated: WorkflowRunNode = {
                            id: idx >= 0 ? prev[idx].id : nextNodeId(),
                            run_id: 0,
                            node_id: data.node_id,
                            node_type:
                                nodes.find(n => n.id === data.node_id)?.type ||
                                '',
                            status: data.status,
                            input: null,
                            output:
                                data.output !== undefined
                                    ? JSON.stringify(data.output)
                                    : null,
                            error: data.error || null,
                            duration_ms: data.duration_ms ?? null,
                            executed_at: null
                        };
                        if (idx >= 0)
                            return prev.map((n, i) =>
                                i === idx ? updated : n
                            );
                        return [...prev, updated];
                    });
                }
            } catch {
                /* ignore */
            }
        };

        es.onerror = () => {
            es.close();
            setRunning(false);
        };
    }, [workflowId, nodes, setNodes, setEdges]);

    // Delete all selected nodes (multi-select)
    const deleteAllSelected = useCallback(() => {
        setNodes(nds => {
            const selectedIds = new Set(
                nds.filter(n => n.selected).map(n => n.id)
            );
            if (selectedIds.size === 0 && !selectedNodeId) return nds;
            if (selectedNodeId) selectedIds.add(selectedNodeId);
            setEdges(eds =>
                eds.filter(
                    e =>
                        !selectedIds.has(e.source) && !selectedIds.has(e.target)
                )
            );
            scheduleSave();
            return nds.filter(n => !selectedIds.has(n.id));
        });
        setSelectedNodeId(null);
    }, [selectedNodeId, setNodes, setEdges, scheduleSave]);

    // Copy selected nodes to clipboard
    const copySelected = useCallback(() => {
        setNodes(nds => {
            const selectedIds = new Set(
                nds
                    .filter(n => n.selected || n.id === selectedNodeId)
                    .map(n => n.id)
            );
            if (selectedIds.size === 0) return nds;
            const copiedNodes = nds.filter(n => selectedIds.has(n.id));
            setEdges(eds => {
                const copiedEdges = eds.filter(
                    e => selectedIds.has(e.source) && selectedIds.has(e.target)
                );
                clipboardRef.current = {
                    nodes: copiedNodes,
                    edges: copiedEdges
                };
                pasteCountRef.current = 0;
                return eds;
            });
            return nds;
        });
    }, [selectedNodeId, setNodes, setEdges]);

    // Paste from clipboard
    const pasteClipboard = useCallback(() => {
        const { nodes: cbNodes, edges: cbEdges } = clipboardRef.current;
        if (cbNodes.length === 0) return;

        pasteCountRef.current += 1;
        const offset = pasteCountRef.current * 30;

        // Build ID mapping: old ID → new ID
        const idMap: Record<string, string> = {};
        for (const n of cbNodes) {
            idMap[n.id] =
                `${n.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        }

        const newNodes: Node[] = cbNodes.map(n => ({
            ...n,
            id: idMap[n.id],
            position: { x: n.position.x + offset, y: n.position.y + offset },
            selected: true,
            data: { ...n.data, runStatus: undefined }
        }));

        const newEdges: Edge[] = cbEdges.map(e => ({
            ...e,
            id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            source: idMap[e.source] ?? e.source,
            target: idMap[e.target] ?? e.target
        }));

        setNodes(nds => [
            ...nds.map(n => ({ ...n, selected: false })),
            ...newNodes
        ]);
        setEdges(eds => [...eds, ...newEdges]);
        scheduleSave();
    }, [setNodes, setEdges, scheduleSave]);

    // Download workflow as JSON
    const downloadWorkflow = useCallback(() => {
        setNodes(nds => {
            setEdges(eds => {
                const data = {
                    version: '1.0',
                    name: nameRef.current,
                    description: workflow?.description ?? null,
                    nodes: nds,
                    edges: eds,
                    exportedAt: new Date().toISOString()
                };
                const blob = new Blob([JSON.stringify(data, null, 2)], {
                    type: 'application/json'
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${nameRef.current.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
                a.click();
                URL.revokeObjectURL(url);
                return eds;
            });
            return nds;
        });
    }, [workflow, setNodes, setEdges]);

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const inInput =
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable;

            if (!inInput && (e.key === 'Delete' || e.key === 'Backspace')) {
                e.preventDefault();
                deleteAllSelected();
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
                if (inInput) return;
                e.preventDefault();
                setNodes(nds => nds.map(n => ({ ...n, selected: true })));
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
                if (inInput) return;
                copySelected();
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
                if (inInput) return;
                pasteClipboard();
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [deleteAllSelected, copySelected, pasteClipboard, setNodes]);

    const handleNodeDataChange = useCallback(
        (id: string, data: Record<string, unknown>) => {
            setNodes(nds => nds.map(n => (n.id === id ? { ...n, data } : n)));
            scheduleSave();
        },
        [setNodes, scheduleSave]
    );

    const deleteNodeById = useCallback(
        (id: string) => {
            setNodes(nds => nds.filter(n => n.id !== id));
            setEdges(eds =>
                eds.filter(e => e.source !== id && e.target !== id)
            );
            setSelectedNodeId(prev => (prev === id ? null : prev));
            scheduleSave();
        },
        [setNodes, setEdges, scheduleSave]
    );

    const selectedNode = nodes.find(n => n.id === selectedNodeId) ?? null;
    const selectedCount = nodes.filter(n => n.selected).length;

    if (!workflow) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2
                    size={20}
                    className="animate-spin text-muted-foreground"
                />
            </div>
        );
    }

    return (
        <WorkflowActionsContext.Provider value={{ deleteNode: deleteNodeById }}>
            <TooltipProvider delayDuration={300}>
                <div className="flex flex-col h-full">
                    {/* Toolbar */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/80 shrink-0">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 cursor-pointer"
                                    onClick={onBack}
                                >
                                    <ArrowLeft size={15} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Back to workflows</TooltipContent>
                        </Tooltip>

                        <div className="h-4 w-px bg-border" />

                        <Input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onBlur={saveName}
                            onKeyDown={e => e.key === 'Enter' && saveName()}
                            className="h-7 text-sm font-semibold border-0 bg-transparent shadow-none focus-visible:ring-0 px-1 w-48"
                        />
                        {saving && (
                            <Loader2
                                size={12}
                                className="animate-spin text-muted-foreground"
                            />
                        )}

                        <div className="flex-1" />

                        {selectedCount > 0 && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground"
                                        onClick={copySelected}
                                    >
                                        <Copy size={14} />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    Copy selected ({selectedCount}) · Ctrl+C
                                </TooltipContent>
                            </Tooltip>
                        )}

                        {(selectedNodeId || selectedCount > 0) && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                        onClick={deleteAllSelected}
                                    >
                                        <Trash2 size={14} />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    Delete selected · Del
                                </TooltipContent>
                            </Tooltip>
                        )}

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground"
                                    onClick={downloadWorkflow}
                                >
                                    <Download size={14} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download as JSON</TooltipContent>
                        </Tooltip>

                        <Button
                            size="sm"
                            className="h-7 gap-1.5 cursor-pointer text-xs"
                            onClick={handleRun}
                            disabled={running || nodes.length === 0}
                        >
                            {running ? (
                                <Loader2 size={13} className="animate-spin" />
                            ) : (
                                <Play size={13} />
                            )}
                            {running ? 'Running…' : 'Run'}
                        </Button>
                    </div>

                    {/* Main area */}
                    <div className="flex flex-1 min-h-0">
                        <NodePalette />

                        <div className="flex-1 flex flex-col min-w-0">
                            <EditorCanvas
                                nodes={nodes}
                                edges={edges}
                                onNodesChange={handleNodesChange}
                                onEdgesChange={handleEdgesChange}
                                onConnect={onConnect}
                                onNodeClick={node => setSelectedNodeId(node.id)}
                                onPaneClick={() => setSelectedNodeId(null)}
                                onDropNode={onDropNode}
                            />
                            {showRunner && (
                                <WorkflowRunner
                                    run={lastRun}
                                    nodes={runNodes}
                                    isRunning={running}
                                />
                            )}
                        </div>

                        {selectedNode && (
                            <NodeProperties
                                node={selectedNode}
                                onChange={handleNodeDataChange}
                                onClose={() => setSelectedNodeId(null)}
                                onDelete={deleteAllSelected}
                            />
                        )}
                    </div>
                </div>
            </TooltipProvider>
        </WorkflowActionsContext.Provider>
    );
}

export default function WorkflowEditor(props: Props) {
    return (
        <ReactFlowProvider>
            <EditorInner {...props} />
        </ReactFlowProvider>
    );
}
