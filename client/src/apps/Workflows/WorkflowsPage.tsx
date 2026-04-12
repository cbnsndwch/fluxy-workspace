import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Plus,
    Play,
    Pencil,
    Trash2,
    Workflow,
    Clock,
    Upload,
    Copy
} from 'lucide-react';
// oxlint-disable no-console
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useAppTracking } from '@/apps/Analytics/AnalyticsProvider';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { queryClient } from '@/lib/queryClient';

import WorkflowEditor from './WorkflowEditor';

import type { Workflow as WorkflowType } from './types';

function WorkflowCard({
    workflow,
    onEdit,
    onDelete,
    onOpen,
    onDuplicate
}: {
    workflow: WorkflowType;
    onEdit: (w: WorkflowType) => void;
    onDelete: (id: string) => void;
    onOpen: (id: string) => void;
    onDuplicate: (w: WorkflowType) => void;
}) {
    return (
        <div className="group relative flex flex-col gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-md transition-all">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                    <Workflow size={18} />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm text-foreground truncate">
                        {workflow.name}
                    </h3>
                    {workflow.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {workflow.description}
                        </p>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                <Clock size={10} />
                <span>
                    Updated {new Date(workflow.updated_at).toLocaleDateString()}
                </span>
            </div>

            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    className="flex-1 h-7 gap-1.5 cursor-pointer text-xs"
                    onClick={() => onOpen(workflow.id)}
                >
                    <Play size={12} />
                    Open
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground"
                    title="Duplicate"
                    onClick={() => onDuplicate(workflow)}
                >
                    <Copy size={13} />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground"
                    onClick={() => onEdit(workflow)}
                >
                    <Pencil size={13} />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                    onClick={() => onDelete(workflow.id)}
                >
                    <Trash2 size={13} />
                </Button>
            </div>
        </div>
    );
}

function WorkflowFormDialog({
    open,
    onClose,
    onSave,
    initial
}: {
    open: boolean;
    onClose: () => void;
    onSave: (name: string, description: string) => void;
    initial?: WorkflowType | null;
}) {
    const [name, setName] = useState(initial?.name || '');
    const [desc, setDesc] = useState(initial?.description || '');

    return (
        <Dialog open={open} onOpenChange={v => !v && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>
                        {initial ? 'Edit Workflow' : 'New Workflow'}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                            Name
                        </label>
                        <Input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="My workflow"
                            onKeyDown={e =>
                                e.key === 'Enter' &&
                                name.trim() &&
                                onSave(name, desc)
                            }
                            autoFocus
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                            Description (optional)
                        </label>
                        <Textarea
                            value={desc}
                            onChange={e => setDesc(e.target.value)}
                            placeholder="What does this workflow do?"
                            rows={2}
                            className="resize-none text-sm"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => name.trim() && onSave(name, desc)}
                        disabled={!name.trim()}
                    >
                        {initial ? 'Save' : 'Create'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

async function fetchWorkflows(): Promise<WorkflowType[]> {
    const r = await fetch('/app/api/workflows');
    const data = await r.json();
    return Array.isArray(data) ? data : [];
}

export async function loader() {
    const data = await fetchWorkflows();
    queryClient.setQueryData(['workflows'], data);
    return null;
}

interface WorkflowExport {
    version: string;
    name: string;
    description?: string | null;
    nodes: unknown[];
    edges: unknown[];
}

export default function WorkflowsPage() {
    const { id } = useParams<{ id?: string }>();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const [dialogOpen, setDialogOpen] = useState(false);
    const { trackPageView } = useAppTracking('workflows');
    useEffect(() => {
        trackPageView();
    }, [trackPageView]);
    const [editing, setEditing] = useState<WorkflowType | null>(null);
    const importInputRef = useRef<HTMLInputElement>(null);

    const { data: workflows = [], isLoading: loading } = useQuery({
        queryKey: ['workflows'],
        queryFn: fetchWorkflows
    });

    const updateMutation = useMutation({
        mutationFn: ({
            wfId,
            name,
            description,
            nodes,
            edges
        }: {
            wfId: string;
            name: string;
            description: string;
            nodes: unknown;
            edges: unknown;
        }) =>
            fetch(`/app/api/workflows/${wfId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, nodes, edges })
            }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] })
    });

    const createMutation = useMutation({
        mutationFn: (data: { name: string; description: string }) =>
            fetch('/app/api/workflows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }).then(r => r.json() as Promise<WorkflowType>),
        onSuccess: wf => {
            qc.invalidateQueries({ queryKey: ['workflows'] });
            navigate(`/workflows/${wf.id}`);
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (wfId: string) =>
            fetch(`/app/api/workflows/${wfId}`, { method: 'DELETE' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] })
    });

    const handleCreate = useCallback(
        async (name: string, description: string) => {
            if (editing) {
                await updateMutation.mutateAsync({
                    wfId: editing.id,
                    name,
                    description,
                    nodes: editing.nodes,
                    edges: editing.edges
                });
            } else {
                await createMutation.mutateAsync({ name, description });
            }
            setDialogOpen(false);
            setEditing(null);
        },
        [editing, updateMutation, createMutation]
    );

    const handleDelete = useCallback(
        (wfId: string) => {
            deleteMutation.mutate(wfId);
        },
        [deleteMutation]
    );

    const handleDuplicate = useCallback(
        async (wf: WorkflowType) => {
            const newWf = await createMutation.mutateAsync({
                name: `Copy of ${wf.name}`,
                description: wf.description ?? ''
            });
            await updateMutation.mutateAsync({
                wfId: newWf.id,
                name: newWf.name,
                description: newWf.description ?? '',
                nodes: wf.nodes,
                edges: wf.edges
            });
            navigate(`/workflows/${newWf.id}`);
        },
        [createMutation, updateMutation, navigate]
    );

    const handleImportFile = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            // Reset input so the same file can be re-imported
            e.target.value = '';

            try {
                const text = await file.text();
                const data: WorkflowExport = JSON.parse(text);

                if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
                    alert('Invalid workflow file — missing nodes or edges.');
                    return;
                }

                const wfName =
                    data.name ||
                    file.name.replace(/\.[^.]+$/, '') ||
                    'Imported Workflow';
                const r = await fetch('/app/api/workflows', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: wfName,
                        description: data.description ?? null
                    })
                });
                const wf: WorkflowType = await r.json();

                // Write nodes + edges into the new workflow
                await fetch(`/app/api/workflows/${wf.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: wfName,
                        description: data.description ?? null,
                        nodes: JSON.stringify(data.nodes),
                        edges: JSON.stringify(data.edges)
                    })
                });

                navigate(`/workflows/${wf.id}`);
            } catch {
                alert(
                    'Failed to import workflow — make sure it is a valid JSON file.'
                );
            }
        },
        [navigate]
    );

    // If we have an ID param, show the editor
    if (id) {
        return (
            <WorkflowEditor
                workflowId={id}
                onBack={() => navigate('/workflows')}
            />
        );
    }

    // Otherwise show the list
    return (
        <AppLayout
            icon={<Workflow size={18} />}
            iconClassName="bg-orange-500/10 text-orange-500"
            title="Workflows"
            subtitle={`${workflows.length} workflow${workflows.length !== 1 ? 's' : ''}`}
            actions={
                <>
                    <input
                        ref={importInputRef}
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={handleImportFile}
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
                        onClick={() => importInputRef.current?.click()}
                    >
                        <Upload size={14} />
                        Import
                    </Button>
                    <Button
                        size="sm"
                        className="gap-1.5 cursor-pointer"
                        onClick={() => {
                            setEditing(null);
                            setDialogOpen(true);
                        }}
                    >
                        <Plus size={14} />
                        New workflow
                    </Button>
                </>
            }
        >
            <div className="overflow-y-auto h-full p-5">
                {loading ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                        Loading…
                    </div>
                ) : workflows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-4 text-center">
                        <div className="p-4 rounded-full bg-muted">
                            <Workflow
                                size={28}
                                className="text-muted-foreground"
                            />
                        </div>
                        <div>
                            <p className="font-semibold text-sm mb-1">
                                No workflows yet
                            </p>
                            <p className="text-xs text-muted-foreground mb-4">
                                Build your first automated workflow
                            </p>
                            <Button
                                size="sm"
                                className="gap-1.5 cursor-pointer"
                                onClick={() => setDialogOpen(true)}
                            >
                                <Plus size={14} />
                                Create workflow
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl">
                        {workflows.map(w => (
                            <WorkflowCard
                                key={w.id}
                                workflow={w}
                                onOpen={wfId => navigate(`/workflows/${wfId}`)}
                                onEdit={wf => {
                                    setEditing(wf);
                                    setDialogOpen(true);
                                }}
                                onDelete={handleDelete}
                                onDuplicate={handleDuplicate}
                            />
                        ))}
                    </div>
                )}
            </div>

            <WorkflowFormDialog
                key={editing?.id ?? 'new'}
                open={dialogOpen}
                onClose={() => {
                    setDialogOpen(false);
                    setEditing(null);
                }}
                onSave={handleCreate}
                initial={editing}
            />
        </AppLayout>
    );
}
