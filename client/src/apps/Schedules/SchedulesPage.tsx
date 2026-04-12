import {
    Clock,
    Plus,
    Pencil,
    Trash2,
    RefreshCw,
    Terminal,
    ChevronDown,
    ChevronRight,
    Play,
    Cpu,
    FolderGit2,
    FileText,
    AlertCircle,
    CheckCircle2,
    Loader2,
    Timer,
    Repeat,
    Zap,
    FilePlus,
    Save,
    X
} from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';

import { AppLayout } from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CronEntry {
    id: string;
    schedule: string;
    task: string;
    enabled: boolean;
    oneShot?: boolean;
    nextRun?: string | null;
}

interface CronRun {
    id: number;
    cron_id: string;
    started_at: string;
    finished_at: string | null;
    status: 'running' | 'done' | 'error';
    stdout: string;
    stderr: string;
    exit_code: number | null;
    trigger: 'scheduled' | 'manual';
}

interface Process {
    pid: string;
    user: string;
    cpu: string;
    mem: string;
    stat: string;
    started: string;
    time: string;
    command: string;
}

interface Worktree {
    name: string;
    fullPath: string;
    mtime: string;
    size: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSchedule(expr: string): string {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return expr;
    const [min, hour, dom, month, dow] = parts;

    // Every N minutes
    const everyMin = min.match(/^\*\/(\d+)$/);
    if (
        everyMin &&
        hour === '*' &&
        dom === '*' &&
        month === '*' &&
        dow === '*'
    ) {
        const n = Number(everyMin[1]);
        return n === 1 ? 'Every minute' : `Every ${n} minutes`;
    }
    // Every N hours
    const everyHr = hour.match(/^\*\/(\d+)$/);
    if (min === '0' && everyHr && dom === '*' && month === '*' && dow === '*') {
        const n = Number(everyHr[1]);
        return n === 1 ? 'Every hour' : `Every ${n} hours`;
    }
    // Daily at time
    if (
        /^\d+$/.test(min) &&
        /^\d+$/.test(hour) &&
        dom === '*' &&
        month === '*' &&
        dow === '*'
    ) {
        const h = hour.padStart(2, '0');
        const m = min.padStart(2, '0');
        return `Daily at ${h}:${m}`;
    }
    // Specific weekday
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (
        /^\d+$/.test(min) &&
        /^\d+$/.test(hour) &&
        dom === '*' &&
        month === '*' &&
        /^\d+$/.test(dow)
    ) {
        const h = hour.padStart(2, '0');
        const m = min.padStart(2, '0');
        return `${days[Number(dow)]} at ${h}:${m}`;
    }
    return expr;
}

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function timeUntil(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return 'now';
    const s = Math.floor(diff / 1000);
    if (s < 60) return `in ${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `in ${h}h ${m % 60}m`;
    return `in ${Math.floor(h / 24)}d`;
}

function duration(start: string, end: string | null): string {
    if (!end) return '…';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const statusBadge = (status: CronRun['status']) => {
    if (status === 'done')
        return (
            <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[10px]">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Done
            </Badge>
        );
    if (status === 'error')
        return (
            <Badge className="bg-red-500/10 text-red-500 border-0 text-[10px]">
                <AlertCircle className="h-3 w-3 mr-1" />
                Error
            </Badge>
        );
    return (
        <Badge className="bg-blue-500/10 text-blue-500 border-0 text-[10px]">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Running
        </Badge>
    );
};

// ── Cron Form Dialog ──────────────────────────────────────────────────────────

interface CronFormProps {
    open: boolean;
    onClose: () => void;
    initial?: CronEntry | null;
    onSave: (
        data: Omit<CronEntry, 'enabled'> & { enabled: boolean }
    ) => Promise<void>;
}

function CronFormDialog({ open, onClose, initial, onSave }: CronFormProps) {
    const [id, setId] = useState('');
    const [schedule, setSchedule] = useState('*/30 * * * *');
    const [task, setTask] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [oneShot, setOneShot] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const isEdit = Boolean(initial);

    useEffect(() => {
        if (open) {
            setId(initial?.id ?? '');
            setSchedule(initial?.schedule ?? '*/30 * * * *');
            setTask(initial?.task ?? '');
            setEnabled(initial?.enabled ?? true);
            setOneShot(initial?.oneShot ?? false);
            setError('');
        }
    }, [open, initial]);

    const handleSave = async () => {
        if (!id.trim() || !schedule.trim() || !task.trim()) {
            setError('ID, schedule, and task are all required.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            await onSave({
                id: id.trim(),
                schedule: schedule.trim(),
                task: task.trim(),
                enabled,
                oneShot
            });
            onClose();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={v => !v && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit ? 'Edit Cron' : 'New Cron'}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label>
                            ID{' '}
                            <span className="text-muted-foreground text-xs">
                                (unique slug)
                            </span>
                        </Label>
                        <Input
                            value={id}
                            onChange={e => setId(e.target.value)}
                            placeholder="my-daily-task"
                            disabled={isEdit}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>
                            Schedule{' '}
                            <span className="text-muted-foreground text-xs">
                                (cron expression)
                            </span>
                        </Label>
                        <Input
                            value={schedule}
                            onChange={e => setSchedule(e.target.value)}
                            placeholder="*/30 * * * *"
                            className="font-mono text-sm"
                        />
                        {schedule && (
                            <p className="text-xs text-muted-foreground pl-0.5">
                                → {formatSchedule(schedule)}
                            </p>
                        )}
                    </div>
                    <div className="space-y-1.5">
                        <Label>Task description</Label>
                        <Textarea
                            value={task}
                            onChange={e => setTask(e.target.value)}
                            placeholder="What should Sebastian do when this fires?"
                            rows={3}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={enabled}
                                onCheckedChange={setEnabled}
                                id="enabled-toggle"
                            />
                            <Label
                                htmlFor="enabled-toggle"
                                className="cursor-pointer"
                            >
                                Enabled
                            </Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={oneShot}
                                onCheckedChange={setOneShot}
                                id="oneshot-toggle"
                            />
                            <Label
                                htmlFor="oneshot-toggle"
                                className="cursor-pointer"
                            >
                                One-shot{' '}
                                <span className="text-muted-foreground text-xs">
                                    (auto-delete after run)
                                </span>
                            </Label>
                        </div>
                    </div>
                    {error && <p className="text-xs text-red-500">{error}</p>}
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={onClose}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving && (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        {isEdit ? 'Save changes' : 'Create cron'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Run Detail ────────────────────────────────────────────────────────────────

function RunDetail({ run }: { run: CronRun }) {
    const hasOutput = run.stdout || run.stderr;
    return (
        <div className="text-xs space-y-2">
            <div className="flex items-center gap-3 text-muted-foreground">
                <span>Started {timeAgo(run.started_at)}</span>
                <span>·</span>
                <span>
                    Duration: {duration(run.started_at, run.finished_at)}
                </span>
                {run.exit_code !== null && (
                    <>
                        <span>·</span>
                        <span>Exit: {run.exit_code}</span>
                    </>
                )}
                <span>·</span>
                <span className="capitalize">{run.trigger}</span>
            </div>
            {hasOutput ? (
                <div className="space-y-2">
                    {run.stdout && (
                        <div>
                            <p className="text-muted-foreground font-medium mb-1">
                                stdout
                            </p>
                            <pre className="bg-muted/50 rounded p-2 text-[10px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                                {run.stdout}
                            </pre>
                        </div>
                    )}
                    {run.stderr && (
                        <div>
                            <p className="text-red-400 font-medium mb-1">
                                stderr
                            </p>
                            <pre className="bg-red-950/20 rounded p-2 text-[10px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed text-red-300">
                                {run.stderr}
                            </pre>
                        </div>
                    )}
                </div>
            ) : (
                <p className="text-muted-foreground italic">
                    No output captured.
                </p>
            )}
        </div>
    );
}

// ── Task File Panel ───────────────────────────────────────────────────────────

function TaskFilePanel({ cronId }: { cronId: string }) {
    const [content, setContent] = useState<string | null>(null);
    const [exists, setExists] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        const res = await fetch(
            `/app/api/schedules/taskfile/${encodeURIComponent(cronId)}`
        );
        if (res.ok) {
            const data = await res.json();
            setExists(data.exists);
            setContent(data.content);
        }
    }, [cronId]);

    useEffect(() => {
        load();
        setOpen(false);
        setEditing(false);
    }, [load]);

    const handleEdit = () => {
        setDraft(content ?? '');
        setEditing(true);
        setOpen(true);
    };

    const handleCreate = () => {
        setDraft(
            `# ${cronId}\n\nDescribe the steps Sebastian should follow when this cron fires.\n`
        );
        setEditing(true);
        setOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await fetch(
                `/app/api/schedules/taskfile/${encodeURIComponent(cronId)}`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: draft })
                }
            );
            await load();
            setEditing(false);
            setOpen(true); // stay open to show saved content
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="px-5 py-3 border-b border-border/50 shrink-0">
            <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Task file
                    {exists && (
                        <span className="font-mono text-[10px] text-muted-foreground/60">
                            tasks/{cronId}.md
                        </span>
                    )}
                </p>
                <div className="flex items-center gap-1">
                    {exists && !editing && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] gap-1 cursor-pointer"
                            onClick={() => {
                                setOpen(o => !o);
                            }}
                        >
                            {open ? (
                                <ChevronDown className="h-3 w-3" />
                            ) : (
                                <ChevronRight className="h-3 w-3" />
                            )}
                            {open ? 'Hide' : 'View'}
                        </Button>
                    )}
                    {exists ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] gap-1 cursor-pointer"
                            onClick={handleEdit}
                        >
                            <Pencil className="h-3 w-3" /> Edit
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] gap-1 cursor-pointer text-muted-foreground"
                            onClick={handleCreate}
                        >
                            <FilePlus className="h-3 w-3" /> Create task file
                        </Button>
                    )}
                </div>
            </div>

            {!exists && !editing && (
                <p className="text-xs text-muted-foreground/60 italic">
                    No task file — Sebastian uses the task description above
                    when this fires.
                </p>
            )}

            {/* Viewer */}
            {exists && open && !editing && content !== null && (
                <pre className="mt-1 bg-muted/40 rounded-lg p-3 text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto border border-border/40">
                    {content}
                </pre>
            )}

            {/* Editor */}
            {editing && (
                <div className="mt-1 space-y-2">
                    <Textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        className="font-mono text-[11px] leading-relaxed min-h-48 resize-y"
                        placeholder="Write step-by-step instructions for Sebastian..."
                    />
                    <div className="flex items-center gap-2 justify-end">
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-3 text-xs cursor-pointer"
                            onClick={() => {
                                setEditing(false);
                                setOpen(exists);
                            }}
                            disabled={saving}
                        >
                            <X className="h-3 w-3 mr-1" /> Cancel
                        </Button>
                        <Button
                            size="sm"
                            className="h-7 px-3 text-xs cursor-pointer"
                            onClick={handleSave}
                            disabled={saving}
                        >
                            {saving ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                                <Save className="h-3 w-3 mr-1" />
                            )}
                            Save
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Crons Tab ─────────────────────────────────────────────────────────────────

function CronsTab() {
    const [crons, setCrons] = useState<CronEntry[]>([]);
    const [runs, setRuns] = useState<CronRun[]>([]);
    const [selected, setSelected] = useState<CronEntry | null>(null);
    const [editTarget, setEditTarget] = useState<CronEntry | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [expandedRun, setExpandedRun] = useState<number | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [, setTick] = useState(0);

    const loadCrons = useCallback(async () => {
        const res = await fetch('/app/api/schedules/crons');
        if (res.ok) {
            const data = await res.json();
            setCrons(data);
            setSelected(prev =>
                prev
                    ? (data.find((c: CronEntry) => c.id === prev.id) ?? prev)
                    : prev
            );
        }
    }, []);

    const loadRuns = useCallback(async (cronId?: string) => {
        const url = cronId
            ? `/app/api/schedules/runs?cronId=${encodeURIComponent(cronId)}&limit=20`
            : '/app/api/schedules/runs?limit=20';
        const res = await fetch(url);
        if (res.ok) setRuns(await res.json());
    }, []);

    useEffect(() => {
        loadCrons();
        loadRuns();
    }, [loadCrons, loadRuns]);

    // Re-render every 30s so countdowns stay accurate; also refetch nextRun
    useEffect(() => {
        const tick = setInterval(() => setTick(t => t + 1), 30_000);
        const refetch = setInterval(() => loadCrons(), 30_000);
        return () => {
            clearInterval(tick);
            clearInterval(refetch);
        };
    }, [loadCrons]);

    const handleSelect = (cron: CronEntry) => {
        setSelected(cron);
        setExpandedRun(null);
        loadRuns(cron.id);
    };

    const handleToggle = async (cron: CronEntry) => {
        const res = await fetch(`/app/api/schedules/crons/${cron.id}/toggle`, {
            method: 'PATCH'
        });
        if (res.ok) {
            const updated = await res.json();
            setCrons(prev => prev.map(c => (c.id === cron.id ? updated : c)));
            if (selected?.id === cron.id) setSelected(updated);
        }
    };

    const handleSave = async (data: CronEntry) => {
        const isEdit = Boolean(editTarget);
        const res = await fetch(
            isEdit
                ? `/app/api/schedules/crons/${data.id}`
                : '/app/api/schedules/crons',
            {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }
        );
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Save failed');
        }
        await loadCrons();
        setEditTarget(null);
    };

    const handleDelete = async (id: string) => {
        const res = await fetch(`/app/api/schedules/crons/${id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await loadCrons();
            if (selected?.id === id) {
                setSelected(null);
                setRuns([]);
            }
            setDeleteConfirm(null);
        }
    };

    const selectedRuns = selected
        ? runs.filter(r => r.cron_id === selected.id)
        : runs;

    return (
        <div className="flex h-full">
            {/* ── Left: Cron list ───────────────────────────────────────── */}
            <div className="w-72 shrink-0 border-r border-border/50 flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                    <span className="text-sm font-medium text-muted-foreground">
                        {crons.length} cron{crons.length !== 1 ? 's' : ''}
                    </span>
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 cursor-pointer"
                        onClick={() => {
                            setEditTarget(null);
                            setShowForm(true);
                        }}
                    >
                        <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                </div>
                <ScrollArea className="flex-1">
                    {crons.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                            No crons yet.
                            <br />
                            <button
                                className="text-primary hover:underline mt-1 cursor-pointer"
                                onClick={() => {
                                    setEditTarget(null);
                                    setShowForm(true);
                                }}
                            >
                                Add one
                            </button>
                        </div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {crons.map(cron => (
                                <button
                                    key={cron.id}
                                    className={cn(
                                        'w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer',
                                        selected?.id === cron.id
                                            ? 'bg-sidebar-accent text-foreground'
                                            : 'hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground'
                                    )}
                                    onClick={() => handleSelect(cron)}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div
                                            className={cn(
                                                'h-1.5 w-1.5 rounded-full shrink-0',
                                                cron.enabled
                                                    ? 'bg-emerald-500'
                                                    : 'bg-muted-foreground/40'
                                            )}
                                        />
                                        <span className="text-sm font-medium truncate">
                                            {cron.id}
                                        </span>
                                        {cron.oneShot && (
                                            <Zap className="h-3 w-3 shrink-0 text-amber-500" />
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 pl-3.5">
                                        <p className="text-[10px] text-muted-foreground font-mono">
                                            {formatSchedule(cron.schedule)}
                                        </p>
                                        {cron.enabled &&
                                            timeUntil(cron.nextRun) && (
                                                <span className="text-[10px] text-emerald-500/80">
                                                    · {timeUntil(cron.nextRun)}
                                                </span>
                                            )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </div>

            {/* ── Right: Detail ─────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {selected ? (
                    <>
                        {/* Header */}
                        <div className="flex items-start justify-between px-5 py-4 border-b border-border/50 shrink-0">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-base font-semibold">
                                        {selected.id}
                                    </h2>
                                    {selected.oneShot && (
                                        <Badge className="bg-amber-500/10 text-amber-500 border-0 text-[10px]">
                                            <Zap className="h-3 w-3 mr-1" />
                                            One-shot
                                        </Badge>
                                    )}
                                    <Badge
                                        className={cn(
                                            'border-0 text-[10px]',
                                            selected.enabled
                                                ? 'bg-emerald-500/10 text-emerald-500'
                                                : 'bg-muted text-muted-foreground'
                                        )}
                                    >
                                        {selected.enabled
                                            ? 'Enabled'
                                            : 'Disabled'}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <p className="text-xs text-muted-foreground font-mono">
                                        {selected.schedule} ·{' '}
                                        {formatSchedule(selected.schedule)}
                                    </p>
                                    {selected.enabled &&
                                        timeUntil(selected.nextRun) && (
                                            <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[10px]">
                                                <Timer className="h-3 w-3 mr-1" />
                                                Next{' '}
                                                {timeUntil(selected.nextRun)}
                                            </Badge>
                                        )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-4">
                                <Switch
                                    checked={selected.enabled}
                                    onCheckedChange={() =>
                                        handleToggle(selected)
                                    }
                                    className="cursor-pointer"
                                />
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 cursor-pointer"
                                    onClick={() => {
                                        setEditTarget(selected);
                                        setShowForm(true);
                                    }}
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-red-500 hover:text-red-400 cursor-pointer"
                                    onClick={() =>
                                        setDeleteConfirm(selected.id)
                                    }
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>

                        {/* Task description */}
                        <div className="px-5 py-3 border-b border-border/50 shrink-0">
                            <p className="text-xs font-medium text-muted-foreground mb-1">
                                Task
                            </p>
                            <p className="text-sm leading-relaxed">
                                {selected.task}
                            </p>
                        </div>

                        {/* Task file */}
                        <TaskFilePanel cronId={selected.id} />

                        {/* Run history */}
                        <div className="flex-1 overflow-hidden flex flex-col">
                            <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/50 shrink-0">
                                <p className="text-xs font-medium text-muted-foreground">
                                    Run history{' '}
                                    <span className="ml-1">
                                        ({selectedRuns.length})
                                    </span>
                                </p>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 w-6 p-0 cursor-pointer"
                                    onClick={() => loadRuns(selected.id)}
                                >
                                    <RefreshCw className="h-3 w-3" />
                                </Button>
                            </div>
                            <ScrollArea className="flex-1">
                                {selectedRuns.length === 0 ? (
                                    <p className="px-5 py-6 text-sm text-muted-foreground text-center">
                                        No runs recorded yet.
                                    </p>
                                ) : (
                                    <div className="p-3 space-y-1">
                                        {selectedRuns.map(run => (
                                            <div
                                                key={run.id}
                                                className="rounded-lg border border-border/40 overflow-hidden"
                                            >
                                                <button
                                                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors cursor-pointer"
                                                    onClick={() =>
                                                        setExpandedRun(
                                                            expandedRun ===
                                                                run.id
                                                                ? null
                                                                : run.id
                                                        )
                                                    }
                                                >
                                                    <div className="shrink-0">
                                                        {expandedRun ===
                                                        run.id ? (
                                                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                                        ) : (
                                                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    {statusBadge(run.status)}
                                                    <span className="text-xs text-muted-foreground flex-1 text-left">
                                                        {timeAgo(
                                                            run.started_at
                                                        )}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground font-mono">
                                                        {duration(
                                                            run.started_at,
                                                            run.finished_at
                                                        )}
                                                    </span>
                                                </button>
                                                {expandedRun === run.id && (
                                                    <div className="px-3 pb-3 pt-1 border-t border-border/40">
                                                        <RunDetail run={run} />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
                        <Clock className="h-10 w-10 opacity-20" />
                        <p className="text-sm">Select a cron to view details</p>
                    </div>
                )}
            </div>

            {/* Dialogs */}
            <CronFormDialog
                open={showForm}
                onClose={() => {
                    setShowForm(false);
                    setEditTarget(null);
                }}
                initial={editTarget}
                onSave={handleSave}
            />

            <Dialog
                open={Boolean(deleteConfirm)}
                onOpenChange={v => !v && setDeleteConfirm(null)}
            >
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Delete cron?</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        This will permanently remove{' '}
                        <span className="font-mono text-foreground">
                            {deleteConfirm}
                        </span>{' '}
                        from CRONS.json. Run history is preserved.
                    </p>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteConfirm(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() =>
                                deleteConfirm && handleDelete(deleteConfirm)
                            }
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// ── Runs Tab (all runs across crons) ──────────────────────────────────────────

function RunsTab() {
    const [runs, setRuns] = useState<CronRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<number | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await fetch('/app/api/schedules/runs?limit=100');
        if (res.ok) setRuns(await res.json());
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    if (loading)
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 shrink-0">
                <span className="text-sm text-muted-foreground">
                    {runs.length} recent run{runs.length !== 1 ? 's' : ''}
                </span>
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 cursor-pointer"
                    onClick={load}
                >
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </Button>
            </div>
            <ScrollArea className="flex-1">
                {runs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                        <Timer className="h-8 w-8 opacity-20" />
                        <p className="text-sm">No runs recorded yet.</p>
                        <p className="text-xs">
                            Runs are logged when cron agents report back.
                        </p>
                    </div>
                ) : (
                    <div className="p-4 space-y-1.5">
                        {runs.map(run => (
                            <div
                                key={run.id}
                                className="rounded-lg border border-border/40 overflow-hidden"
                            >
                                <button
                                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
                                    onClick={() =>
                                        setExpanded(
                                            expanded === run.id ? null : run.id
                                        )
                                    }
                                >
                                    <div className="shrink-0">
                                        {expanded === run.id ? (
                                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                        ) : (
                                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                        )}
                                    </div>
                                    {statusBadge(run.status)}
                                    <span className="text-sm font-medium font-mono flex-1 text-left truncate">
                                        {run.cron_id}
                                    </span>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                        {timeAgo(run.started_at)}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground font-mono shrink-0 w-14 text-right">
                                        {duration(
                                            run.started_at,
                                            run.finished_at
                                        )}
                                    </span>
                                </button>
                                {expanded === run.id && (
                                    <div className="px-4 pb-3 pt-1 border-t border-border/40">
                                        <RunDetail run={run} />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}

// ── Processes Tab ─────────────────────────────────────────────────────────────

function ProcessesTab() {
    const [data, setData] = useState<{
        processes: Process[];
        worktrees: Worktree[];
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [expandedPid, setExpandedPid] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await fetch('/app/api/schedules/processes');
        if (res.ok) setData(await res.json());
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    if (loading)
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );

    const { processes = [], worktrees = [] } = data ?? {};

    return (
        <div className="flex h-full">
            {/* Processes */}
            <div className="flex-1 flex flex-col border-r border-border/50">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 shrink-0">
                    <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">
                            Running processes
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                            {processes.length}
                        </Badge>
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 cursor-pointer"
                        onClick={load}
                    >
                        <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </Button>
                </div>
                <ScrollArea className="flex-1">
                    {processes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                            <Cpu className="h-8 w-8 opacity-20" />
                            <p className="text-sm">
                                No relevant processes running.
                            </p>
                        </div>
                    ) : (
                        <div className="p-3 space-y-1">
                            {processes.map(proc => (
                                <div
                                    key={proc.pid}
                                    className="rounded-lg border border-border/40 overflow-hidden"
                                >
                                    <button
                                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
                                        onClick={() =>
                                            setExpandedPid(
                                                expandedPid === proc.pid
                                                    ? null
                                                    : proc.pid
                                            )
                                        }
                                    >
                                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                        <span className="font-mono text-xs text-muted-foreground w-12 shrink-0">
                                            {proc.pid}
                                        </span>
                                        <span className="text-xs font-mono text-muted-foreground w-10 shrink-0">
                                            {proc.cpu}%
                                        </span>
                                        <span className="text-xs text-muted-foreground flex-1 text-left truncate">
                                            {proc.command.split('/').pop() ??
                                                proc.command}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                            {proc.started}
                                        </span>
                                    </button>
                                    {expandedPid === proc.pid && (
                                        <div className="px-3 pb-2.5 pt-1 border-t border-border/40">
                                            <div className="flex gap-4 text-[10px] text-muted-foreground mb-1.5">
                                                <span>CPU: {proc.cpu}%</span>
                                                <span>MEM: {proc.mem}%</span>
                                                <span>STAT: {proc.stat}</span>
                                                <span>TIME: {proc.time}</span>
                                                <span>USER: {proc.user}</span>
                                            </div>
                                            <pre className="text-[10px] font-mono text-muted-foreground bg-muted/50 rounded p-1.5 whitespace-pre-wrap break-all">
                                                {proc.command}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </div>

            {/* Worktrees */}
            <div className="w-72 shrink-0 flex flex-col">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border/50 shrink-0">
                    <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                        Active worktrees
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                        {worktrees.length}
                    </Badge>
                </div>
                <ScrollArea className="flex-1">
                    {worktrees.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                            <FolderGit2 className="h-7 w-7 opacity-20" />
                            <p className="text-xs text-center">
                                No active worktrees.
                                <br />
                                Agent worktrees appear here while running.
                            </p>
                        </div>
                    ) : (
                        <div className="p-3 space-y-1.5">
                            {worktrees.map(wt => (
                                <div
                                    key={wt.name}
                                    className="rounded-lg border border-border/40 px-3 py-2.5"
                                >
                                    <p className="text-xs font-medium truncate">
                                        {wt.name}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                        Modified {timeAgo(wt.mtime)}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5 opacity-60">
                                        {wt.fullPath}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </div>
        </div>
    );
}

// ── Logs Tab ──────────────────────────────────────────────────────────────────

function LogsTab() {
    const [content, setContent] = useState('');
    const [lines, setLines] = useState(0);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        const res = await fetch('/app/api/schedules/logs/backend?tail=500');
        if (res.ok) {
            const data = await res.json();
            setContent(data.content);
            setLines(data.lines);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // Auto-scroll to bottom when content updates
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [content]);

    // Auto-refresh
    useEffect(() => {
        if (!autoRefresh) return;
        const id = setInterval(load, 3000);
        return () => clearInterval(id);
    }, [autoRefresh, load]);

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 shrink-0">
                <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">.backend.log</span>
                    {lines > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                            {lines} lines
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={autoRefresh}
                            onCheckedChange={setAutoRefresh}
                            id="auto-refresh"
                            className="cursor-pointer"
                        />
                        <Label
                            htmlFor="auto-refresh"
                            className="text-xs cursor-pointer text-muted-foreground"
                        >
                            Auto-refresh
                        </Label>
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 cursor-pointer"
                        onClick={load}
                    >
                        <RefreshCw
                            className={cn(
                                'h-3.5 w-3.5',
                                loading && 'animate-spin'
                            )}
                        />{' '}
                        Refresh
                    </Button>
                </div>
            </div>
            <ScrollArea className="flex-1">
                <div className="p-4">
                    {content ? (
                        <pre className="text-[11px] font-mono leading-5 whitespace-pre-wrap text-muted-foreground">
                            {content}
                        </pre>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                            <Terminal className="h-8 w-8 opacity-20" />
                            <p className="text-sm">No log content yet.</p>
                        </div>
                    )}
                    <div ref={bottomRef} />
                </div>
            </ScrollArea>
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SchedulesPage() {
    return (
        <AppLayout
            icon={<Clock size={20} />}
            iconClassName="bg-violet-500/10 text-violet-500"
            title="Schedules"
            subtitle="Manage cron jobs, monitor background processes, and review logs"
        >
            <Tabs defaultValue="crons" className="flex flex-col h-full">
                <div className="px-6 border-b border-border/50 shrink-0">
                    <TabsList className="h-9 bg-transparent gap-1 -mb-px">
                        <TabsTrigger
                            value="crons"
                            className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none cursor-pointer"
                        >
                            <Repeat className="h-3.5 w-3.5 mr-1.5" />
                            Crons
                        </TabsTrigger>
                        <TabsTrigger
                            value="runs"
                            className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none cursor-pointer"
                        >
                            <Play className="h-3.5 w-3.5 mr-1.5" />
                            Run history
                        </TabsTrigger>
                        <TabsTrigger
                            value="processes"
                            className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none cursor-pointer"
                        >
                            <Cpu className="h-3.5 w-3.5 mr-1.5" />
                            Processes
                        </TabsTrigger>
                        <TabsTrigger
                            value="logs"
                            className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none cursor-pointer"
                        >
                            <Terminal className="h-3.5 w-3.5 mr-1.5" />
                            Backend log
                        </TabsTrigger>
                    </TabsList>
                </div>
                <div className="flex-1 overflow-hidden">
                    <TabsContent
                        value="crons"
                        className="h-full mt-0 data-[state=active]:flex data-[state=active]:flex-col"
                    >
                        <CronsTab />
                    </TabsContent>
                    <TabsContent
                        value="runs"
                        className="h-full mt-0 data-[state=active]:flex data-[state=active]:flex-col"
                    >
                        <RunsTab />
                    </TabsContent>
                    <TabsContent
                        value="processes"
                        className="h-full mt-0 data-[state=active]:flex data-[state=active]:flex-col"
                    >
                        <ProcessesTab />
                    </TabsContent>
                    <TabsContent
                        value="logs"
                        className="h-full mt-0 data-[state=active]:flex data-[state=active]:flex-col"
                    >
                        <LogsTab />
                    </TabsContent>
                </div>
            </Tabs>
        </AppLayout>
    );
}
