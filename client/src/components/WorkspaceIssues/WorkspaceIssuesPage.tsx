import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppTracking } from '@/components/Analytics/AnalyticsProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AlertCircle, BotMessageSquare, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Clock, Columns3, ImagePlus, LayoutList, Loader2, Mic, MicOff, Plus, Search, Square, SquareCheck, TriangleAlert, X, XCircle } from 'lucide-react';
import { AppLayout } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { APPS } from '@/lib/appRegistry';

// ── Types ──────────────────────────────────────────────────────────────────────
type Status = 'open' | 'in-progress' | 'done' | 'wont-fix';
type Priority = 'low' | 'medium' | 'high' | 'critical';
type Category = 'bug' | 'feature' | 'improvement' | 'docs' | 'other';
type AppTarget = string;
type AgentStatus = 'queued' | 'working' | 'done' | 'failed' | null;

interface Issue {
    id: number;
    title: string;
    description: string | null;
    status: Status;
    priority: Priority;
    category: Category;
    app: AppTarget;
    attachments: string; // JSON string of URL[]
    created_at: string;
    updated_at: string;
    agent_status: AgentStatus;
    agent_log: string | null;
    agent_branch: string | null;
    batch_id: number | null;
}

interface DispatchBatch {
    id: number;
    issue_ids: string;
    status: 'working' | 'syncing' | 'done' | 'failed';
    sync_report: string | null;
    created_at: string;
    updated_at: string;
    issues: Array<{ id: number; title: string; agent_status: AgentStatus; agent_log: string | null; agent_branch: string | null }>;
}

// ── Metadata ───────────────────────────────────────────────────────────────────
const STATUS_META: Record<Status, { label: string; icon: React.ReactNode; color: string }> = {
    'open': { label: 'Open', icon: <CircleDot className="h-3 w-3" />, color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
    'in-progress': { label: 'In Progress', icon: <Clock className="h-3 w-3" />, color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' },
    'done': { label: 'Done', icon: <CheckCircle2 className="h-3 w-3" />, color: 'text-green-500 bg-green-500/10 border-green-500/20' },
    'wont-fix': { label: "Won't Fix", icon: <XCircle className="h-3 w-3" />, color: 'text-muted-foreground bg-muted/30 border-border' },
};

const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
    'low': { label: 'Low', color: 'text-muted-foreground bg-muted/30 border-border' },
    'medium': { label: 'Medium', color: 'text-sky-500 bg-sky-500/10 border-sky-500/20' },
    'high': { label: 'High', color: 'text-orange-500 bg-orange-500/10 border-orange-500/20' },
    'critical': { label: 'Critical', color: 'text-red-500 bg-red-500/10 border-red-500/20' },
};

const CATEGORY_META: Record<Category, { label: string }> = {
    'bug': { label: 'Bug' },
    'feature': { label: 'Feature' },
    'improvement': { label: 'Improvement' },
    'docs': { label: 'Docs' },
    'other': { label: 'Other' },
};

const AGENT_STATUS_META: Record<NonNullable<AgentStatus>, { label: string; color: string; pulse?: boolean }> = {
    'queued':  { label: 'Queued',   color: 'text-violet-500 bg-violet-500/10 border-violet-500/20' },
    'working': { label: 'Working',  color: 'text-amber-500 bg-amber-500/10 border-amber-500/20', pulse: true },
    'done':    { label: 'Done',     color: 'text-green-500 bg-green-500/10 border-green-500/20' },
    'failed':  { label: 'Failed',   color: 'text-red-500 bg-red-500/10 border-red-500/20' },
};

// Registry IDs → issue app IDs (for entries where they differ)
const REGISTRY_TO_ISSUE_ID: Record<string, string> = {
    appideas: 'app-ideas',
    imagegen: 'image-studio',
    'deep-research': 'research',
    dbviewer: 'db-viewer',
};

// Derived from appRegistry — new apps appear here automatically
const APP_META: Record<string, { label: string }> = {
    all: { label: 'General' },
    ...Object.fromEntries(
        APPS.map(app => {
            const id = REGISTRY_TO_ISSUE_ID[app.id] ?? app.id;
            return [id, { label: app.name }];
        })
    ),
};

// ── Empty form ─────────────────────────────────────────────────────────────────
const EMPTY_FORM = {
    title: '',
    description: '',
    status: 'open' as Status,
    priority: 'medium' as Priority,
    category: 'improvement' as Category,
    app: 'all' as AppTarget,
    attachments: [] as string[],
};

// ── Voice hook ─────────────────────────────────────────────────────────────────
function useVoiceInput(onTranscript: (text: string) => void) {
    const [listening, setListening] = useState(false);
    const recRef = useRef<SpeechRecognition | null>(null);
    const supported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

    const stop = useCallback(() => {
        recRef.current?.stop();
        setListening(false);
    }, []);

    const toggle = useCallback(() => {
        if (!supported) return;
        if (listening) { stop(); return; }
        const SR = (window.SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition: typeof SpeechRecognition }).webkitSpeechRecognition);
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = false;
        rec.lang = 'en-US';
        rec.onresult = (e: SpeechRecognitionEvent) => {
            const transcript = Array.from(e.results)
                .slice(e.resultIndex)
                .map(r => r[0].transcript)
                .join(' ');
            onTranscript(transcript);
        };
        rec.onerror = () => setListening(false);
        rec.onend = () => setListening(false);
        rec.start();
        recRef.current = rec;
        setListening(true);
    }, [listening, supported, stop, onTranscript]);

    useEffect(() => () => recRef.current?.stop(), []);

    return { listening, toggle, stop, supported };
}

// ── Issue Modal ────────────────────────────────────────────────────────────────
function IssueModal({ issue, onClose, onSave }: {
    issue: Partial<Issue> | null;
    onClose: () => void;
    onSave: () => void;
}) {
    const isNew = !issue?.id;
    const defaultStatus = (issue as Partial<Issue> & { _defaultStatus?: Status })?._defaultStatus;
    const [form, setForm] = useState(issue?.id ? {
        title: issue.title ?? '',
        description: issue.description ?? '',
        status: (issue.status ?? 'open') as Status,
        priority: (issue.priority ?? 'medium') as Priority,
        category: (issue.category ?? 'improvement') as Category,
        app: (issue.app ?? 'all') as AppTarget,
        attachments: (() => { try { return JSON.parse(issue.attachments ?? '[]'); } catch { return []; } })() as string[],
    } : { ...EMPTY_FORM, status: defaultStatus ?? EMPTY_FORM.status, attachments: [] as string[] });
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const voiceTitle = useVoiceInput((text) => {
        setForm(f => ({ ...f, title: f.title ? f.title + ' ' + text : text }));
    });
    const voiceDesc = useVoiceInput((text) => {
        setForm(f => ({ ...f, description: f.description ? f.description + ' ' + text : text }));
    });

    const toggleTitleVoice = () => { voiceDesc.stop(); voiceTitle.toggle(); };
    const toggleDescVoice = () => { voiceTitle.stop(); voiceDesc.toggle(); };

    const handleSave = async () => {
        if (!form.title.trim()) return;
        setSaving(true);
        try {
            const url = isNew ? '/app/api/issues' : `/app/api/issues/${issue!.id}`;
            const method = isNew ? 'POST' : 'PUT';
            await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
            onSave();
        } finally {
            setSaving(false);
        }
    };

    const handleFiles = useCallback(async (files: FileList | null) => {
        if (!files?.length) return;
        setUploading(true);
        try {
            const newUrls: string[] = [];
            for (const file of Array.from(files)) {
                const b64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                const res = await fetch('/app/api/issues/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: b64, name: file.name }),
                });
                const { url } = await res.json();
                newUrls.push(url);
            }
            setForm(f => ({ ...f, attachments: [...f.attachments, ...newUrls] }));
        } finally {
            setUploading(false);
        }
    }, []);

    const removeAttachment = (url: string) => {
        setForm(f => ({ ...f, attachments: f.attachments.filter(a => a !== url) }));
    };

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = Array.from(items)
            .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
            .map(i => i.getAsFile())
            .filter(Boolean) as File[];
        if (!files.length) return;
        e.preventDefault();
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        handleFiles(dt.files);
    }, [handleFiles]);

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-xl" onPaste={handlePaste}>
                <DialogHeader>
                    <DialogTitle>{isNew ? 'New issue' : 'Edit issue'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                    {/* Title + voice */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground">Title</label>
                            {voiceTitle.supported && (
                                <button
                                    type="button"
                                    onClick={toggleTitleVoice}
                                    className={cn(
                                        'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors',
                                        voiceTitle.listening
                                            ? 'bg-red-500/10 border-red-500/30 text-red-500 animate-pulse'
                                            : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                                    )}
                                >
                                    {voiceTitle.listening ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                                    {voiceTitle.listening ? 'Stop' : 'Dictate'}
                                </button>
                            )}
                        </div>
                        <Input
                            placeholder="Issue title"
                            value={form.title}
                            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && handleSave()}
                            autoFocus
                        />
                    </div>

                    {/* Description + voice */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground">Description</label>
                            {voiceDesc.supported && (
                                <button
                                    type="button"
                                    onClick={toggleDescVoice}
                                    className={cn(
                                        'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors',
                                        voiceDesc.listening
                                            ? 'bg-red-500/10 border-red-500/30 text-red-500 animate-pulse'
                                            : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                                    )}
                                >
                                    {voiceDesc.listening ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                                    {voiceDesc.listening ? 'Stop' : 'Dictate'}
                                </button>
                            )}
                        </div>
                        <Textarea
                            placeholder="Describe the issue… (optional)"
                            value={form.description}
                            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                            onPaste={handlePaste}
                            rows={3}
                            className="resize-none"
                        />
                    </div>

                    {/* Attachments */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground">Screenshots / Images</label>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground/50">or paste</span>
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploading}
                                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
                                >
                                    <ImagePlus className="h-3 w-3" />
                                    {uploading ? 'Uploading…' : 'Add image'}
                                </button>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={e => handleFiles(e.target.files)}
                            />
                        </div>
                        {form.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {form.attachments.map(url => (
                                    <div key={url} className="relative group">
                                        <img
                                            src={url}
                                            alt=""
                                            className="h-16 w-16 object-cover rounded-md border border-border"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeAttachment(url)}
                                            className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                                        >
                                            <X className="h-2.5 w-2.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Selects grid */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">App</label>
                            <Select value={form.app} onValueChange={v => setForm(f => ({ ...f, app: v as AppTarget }))}>
                                <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(APP_META).map(([k, v]) => (
                                        <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Category</label>
                            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as Category }))}>
                                <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(CATEGORY_META).map(([k, v]) => (
                                        <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Priority</label>
                            <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as Priority }))}>
                                <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(PRIORITY_META).map(([k, v]) => (
                                        <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Status</label>
                            <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as Status }))}>
                                <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(STATUS_META).map(([k, v]) => (
                                        <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                        <Button onClick={handleSave} disabled={!form.title.trim() || saving}>
                            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Delete Confirm ─────────────────────────────────────────────────────────────
function DeleteConfirm({ issue, onClose, onDeleted }: { issue: Issue; onClose: () => void; onDeleted: () => void }) {
    const [deleting, setDeleting] = useState(false);
    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader><DialogTitle>Delete issue?</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">"{issue.title}" will be permanently deleted.</p>
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={onClose} disabled={deleting}>Cancel</Button>
                    <Button variant="destructive" disabled={deleting} onClick={async () => {
                        setDeleting(true);
                        await fetch(`/app/api/issues/${issue.id}`, { method: 'DELETE' });
                        onDeleted();
                    }}>
                        {deleting ? 'Deleting…' : 'Delete'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Attachment lightbox ────────────────────────────────────────────────────────
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);
    return (
        <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <img src={url} alt="" className="max-w-full max-h-full rounded-lg object-contain" onClick={e => e.stopPropagation()} />
            <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white">
                <X className="h-6 w-6" />
            </button>
        </div>
    );
}

// ── Priority sort order ────────────────────────────────────────────────────────
const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Status[] = ['open', 'in-progress', 'done', 'wont-fix'];

// ── Issue Row ──────────────────────────────────────────────────────────────────
function IssueRow({ issue, onEdit, onDelete, onLightbox, selectMode, selected, onSelect }: {
    issue: Issue;
    onEdit: (issue: Issue) => void;
    onDelete: (issue: Issue) => void;
    onLightbox: (url: string) => void;
    selectMode: boolean;
    selected: boolean;
    onSelect: (id: number) => void;
}) {
    const p = PRIORITY_META[issue.priority];
    const c = CATEGORY_META[issue.category];
    const a = APP_META[issue.app ?? 'all'] ?? { label: issue.app ?? 'General' };
    const attachments: string[] = (() => { try { return JSON.parse(issue.attachments ?? '[]'); } catch { return []; } })();
    const agent = issue.agent_status ? AGENT_STATUS_META[issue.agent_status] : null;

    return (
        <div
            className={cn(
                'flex items-center gap-3 px-5 py-2.5 hover:bg-muted/30 cursor-pointer group transition-colors border-b border-border/40 last:border-0',
                selected && 'bg-violet-500/5 hover:bg-violet-500/10',
            )}
            onClick={() => selectMode ? onSelect(issue.id) : onEdit(issue)}
        >
            {/* Select checkbox or priority bar */}
            {selectMode ? (
                <div className="text-muted-foreground shrink-0" onClick={e => { e.stopPropagation(); onSelect(issue.id); }}>
                    {selected
                        ? <SquareCheck className="h-4 w-4 text-violet-500" />
                        : <Square className="h-4 w-4" />
                    }
                </div>
            ) : (
                <div className={cn('w-1 self-stretch rounded-full shrink-0', {
                    'bg-red-500': issue.priority === 'critical',
                    'bg-orange-500': issue.priority === 'high',
                    'bg-sky-500': issue.priority === 'medium',
                    'bg-muted-foreground/30': issue.priority === 'low',
                })} />
            )}

            {/* Content */}
            <div className="flex-1 min-w-0 py-0.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-muted-foreground/60 font-normal text-[11px] shrink-0">#{issue.id}</span>
                    <span className="text-sm font-medium leading-snug">{issue.title}</span>
                    {agent && (
                        <span className={cn(
                            'flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border',
                            agent.color,
                            agent.pulse && 'animate-pulse',
                        )}>
                            {issue.agent_status === 'working' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <BotMessageSquare className="h-2.5 w-2.5" />}
                            Sebastian {agent.label}
                        </span>
                    )}
                </div>
                {issue.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{issue.description}</p>
                )}
                {issue.agent_log && (
                    <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-1 italic">{issue.agent_log}</p>
                )}
                {attachments.length > 0 && (
                    <div className="flex gap-1 mt-1.5" onClick={e => e.stopPropagation()}>
                        {attachments.map(url => (
                            <img
                                key={url}
                                src={url}
                                alt=""
                                className="h-7 w-7 object-cover rounded border border-border cursor-zoom-in"
                                onClick={() => onLightbox(url)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Meta tags */}
            <div className="flex items-center gap-1.5 shrink-0">
                {issue.app && issue.app !== 'all' && (
                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border border-border/60 bg-muted/20">
                        {a.label}
                    </span>
                )}
                <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', p.color)}>
                    {p.label}
                </span>
                <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border border-border/60 bg-muted/20">
                    {c.label}
                </span>
                {!selectMode && (
                    <button
                        className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        onClick={e => { e.stopPropagation(); onDelete(issue); }}
                    >
                        <XCircle className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
}

// ── Status Group ───────────────────────────────────────────────────────────────
function StatusGroup({ status, issues, onEdit, onDelete, onLightbox, defaultOpen = true, selectMode, selectedIds, onSelect }: {
    status: Status;
    issues: Issue[];
    onEdit: (i: Issue) => void;
    onDelete: (i: Issue) => void;
    onLightbox: (url: string) => void;
    defaultOpen?: boolean;
    selectMode: boolean;
    selectedIds: Set<number>;
    onSelect: (id: number) => void;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const s = STATUS_META[status];

    if (issues.length === 0) return null;

    return (
        <div className="border-b border-border/50 last:border-0">
            {/* Group header */}
            <button
                className="flex items-center gap-2 w-full px-5 py-2.5 hover:bg-muted/20 transition-colors text-left"
                onClick={() => setOpen(o => !o)}
            >
                <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-150', open && 'rotate-90')} />
                <div className={cn('flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border', s.color)}>
                    {s.icon}
                    {s.label}
                </div>
                <span className="text-xs text-muted-foreground">{issues.length}</span>
            </button>

            {/* Issues */}
            {open && (
                <div className="pl-4">
                    {issues.map(issue => (
                        <IssueRow
                            key={issue.id}
                            issue={issue}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onLightbox={onLightbox}
                            selectMode={selectMode}
                            selected={selectedIds.has(issue.id)}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Kanban Card ────────────────────────────────────────────────────────────────
function KanbanCard({ issue, onEdit, onDelete, selectMode, selected, onSelect }: {
    issue: Issue;
    onEdit: (i: Issue) => void;
    onDelete: (i: Issue) => void;
    selectMode: boolean;
    selected: boolean;
    onSelect: (id: number) => void;
}) {
    const p = PRIORITY_META[issue.priority];
    const c = CATEGORY_META[issue.category];
    const a = APP_META[issue.app ?? 'all'] ?? { label: issue.app ?? 'General' };
    const attachments: string[] = (() => { try { return JSON.parse(issue.attachments ?? '[]'); } catch { return []; } })();
    const [dragging, setDragging] = useState(false);
    const agent = issue.agent_status ? AGENT_STATUS_META[issue.agent_status] : null;

    return (
        <div
            draggable={!selectMode}
            onDragStart={e => { e.dataTransfer.setData('issueId', String(issue.id)); setDragging(true); }}
            onDragEnd={() => setDragging(false)}
            className={cn(
                'group relative bg-background border rounded-lg p-3 transition-all',
                selectMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing hover:shadow-sm',
                dragging && 'opacity-40 scale-95',
                selected ? 'border-violet-500/50 bg-violet-500/5' : 'border-border/60 hover:border-border',
            )}
            onClick={() => selectMode ? onSelect(issue.id) : onEdit(issue)}
        >
            {/* Priority bar across the top */}
            <div className={cn('absolute top-0 left-3 right-3 h-0.5 rounded-full', {
                'bg-red-500': issue.priority === 'critical',
                'bg-orange-500': issue.priority === 'high',
                'bg-sky-500': issue.priority === 'medium',
                'bg-muted-foreground/20': issue.priority === 'low',
            })} />

            {/* Select indicator */}
            {selectMode && (
                <div className="absolute top-2 right-2 z-10">
                    {selected
                        ? <SquareCheck className="h-4 w-4 text-violet-500" />
                        : <Square className="h-4 w-4 text-muted-foreground/40" />
                    }
                </div>
            )}

            <div className="mt-1 space-y-2">
                {/* Title + id */}
                <div>
                    <p className="text-sm font-medium leading-snug">
                        <span className="text-muted-foreground/60 font-normal mr-1">#{issue.id}</span>
                        {issue.title}
                    </p>
                    {issue.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{issue.description}</p>
                    )}
                    {agent && (
                        <span className={cn(
                            'inline-flex items-center gap-1 mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border',
                            agent.color,
                            agent.pulse && 'animate-pulse',
                        )}>
                            {issue.agent_status === 'working' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <BotMessageSquare className="h-2.5 w-2.5" />}
                            Sebastian {agent.label}
                        </span>
                    )}
                    {issue.agent_log && (
                        <p className="text-xs text-muted-foreground/60 mt-0.5 line-clamp-1 italic">{issue.agent_log}</p>
                    )}
                </div>

                {/* Full-width hero image */}
                {attachments.length > 0 && (
                    <div className="relative rounded-md overflow-hidden border border-border/60 -mx-0.5" onClick={e => e.stopPropagation()}>
                        <img
                            src={attachments[0]}
                            alt=""
                            className="w-full object-cover max-h-48"
                        />
                        {attachments.length > 1 && (
                            <div className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                                +{attachments.length - 1} more
                            </div>
                        )}
                    </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1 flex-wrap">
                        <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', p.color)}>{p.label}</span>
                        <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border border-border/60 bg-muted/20">{c.label}</span>
                        {issue.app && issue.app !== 'all' && (
                            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border border-border/60 bg-muted/20">{a.label}</span>
                        )}
                    </div>
                    {!selectMode && (
                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive ml-0.5"
                                onClick={e => { e.stopPropagation(); onDelete(issue); }}
                            >
                                <XCircle className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Kanban Column ──────────────────────────────────────────────────────────────
function KanbanColumn({ status, issues, onEdit, onDelete, onNewInStatus, onDrop, selectMode, selectedIds, onSelect }: {
    status: Status;
    issues: Issue[];
    onEdit: (i: Issue) => void;
    onDelete: (i: Issue) => void;
    onNewInStatus: (status: Status) => void;
    onDrop: (issueId: number, newStatus: Status) => void;
    selectMode: boolean;
    selectedIds: Set<number>;
    onSelect: (id: number) => void;
}) {
    const s = STATUS_META[status];
    const [dragOver, setDragOver] = useState(false);
    const dragCounter = useRef(0);

    return (
        <div
            className={cn(
                'flex flex-col min-w-0 flex-1 rounded-xl border overflow-hidden transition-colors',
                dragOver
                    ? 'bg-muted/40 border-border/80 ring-1 ring-border/40'
                    : 'bg-muted/20 border-border/40',
            )}
            onDragEnter={e => { e.preventDefault(); dragCounter.current++; setDragOver(true); }}
            onDragLeave={() => { dragCounter.current--; if (dragCounter.current === 0) setDragOver(false); }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
                e.preventDefault();
                dragCounter.current = 0;
                setDragOver(false);
                const id = Number(e.dataTransfer.getData('issueId'));
                if (id) onDrop(id, status);
            }}
        >
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40 shrink-0">
                <div className={cn('flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border', s.color)}>
                    {s.icon}
                    {s.label}
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">{issues.length}</span>
                    {status === 'open' || status === 'in-progress' ? (
                        <button
                            className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => onNewInStatus(status)}
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </button>
                    ) : null}
                </div>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {issues.length === 0 ? (
                    <div className={cn(
                        'flex items-center justify-center h-16 text-xs rounded-lg border-2 border-dashed transition-colors',
                        dragOver ? 'border-border text-muted-foreground/60' : 'border-transparent text-muted-foreground/40',
                    )}>
                        {dragOver ? 'Drop here' : 'Empty'}
                    </div>
                ) : (
                    issues.map(issue => (
                        <KanbanCard
                            key={issue.id}
                            issue={issue}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            selectMode={selectMode}
                            selected={selectedIds.has(issue.id)}
                            onSelect={onSelect}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

// ── Dispatch Batches Panel ─────────────────────────────────────────────────────
const BATCH_STATUS_META: Record<DispatchBatch['status'], { label: string; color: string }> = {
    'working':  { label: 'Agents working',    color: 'text-amber-500' },
    'syncing':  { label: 'Syncing branches',  color: 'text-violet-500' },
    'done':     { label: 'Done',              color: 'text-green-500' },
    'failed':   { label: 'Failed',            color: 'text-red-500' },
};

function DispatchBatchesPanel() {
    const [open, setOpen] = useState(true);
    const { data: batches = [] } = useQuery<DispatchBatch[]>({
        queryKey: ['dispatch-batches'],
        queryFn: async () => {
            const res = await fetch('/app/api/dispatch-batches');
            return res.json();
        },
        refetchInterval: 5000,
    });

    const active = batches.filter(b => b.status === 'working' || b.status === 'syncing');
    if (batches.length === 0) return null;

    return (
        <div className="border-t border-border/50 shrink-0">
            <button
                className="flex items-center gap-2 w-full px-5 py-2 hover:bg-muted/20 transition-colors text-left"
                onClick={() => setOpen(o => !o)}
            >
                <BotMessageSquare className="h-3.5 w-3.5 text-violet-500" />
                <span className="text-xs font-medium text-muted-foreground flex-1">
                    Agent Dispatch
                    {active.length > 0 && (
                        <span className="ml-1.5 text-amber-500 animate-pulse">● {active.length} active</span>
                    )}
                </span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="px-5 pb-3 space-y-2">
                    {batches.map(batch => {
                        const sm = BATCH_STATUS_META[batch.status];
                        return (
                            <div key={batch.id} className="rounded-lg border border-border/60 bg-muted/10 p-2.5 text-xs space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-muted-foreground">Batch #{batch.id}</span>
                                    <span className={cn('font-medium', sm.color, batch.status === 'working' && 'animate-pulse')}>
                                        {sm.label}
                                    </span>
                                </div>
                                <div className="space-y-1">
                                    {batch.issues.map(issue => {
                                        const as_ = issue.agent_status ? AGENT_STATUS_META[issue.agent_status] : null;
                                        return (
                                            <div key={issue.id} className="flex items-start gap-2">
                                                <span className="text-muted-foreground/60 shrink-0">#{issue.id}</span>
                                                <span className="text-muted-foreground flex-1 line-clamp-1">{issue.title}</span>
                                                {as_ && (
                                                    <span className={cn('shrink-0 font-medium', as_.color)}>
                                                        {issue.agent_status === 'working' && <Loader2 className="h-2.5 w-2.5 inline animate-spin mr-0.5" />}
                                                        {as_.label}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                {batch.sync_report && (
                                    <details className="mt-1">
                                        <summary className="cursor-pointer text-muted-foreground/70 hover:text-muted-foreground">Sync report</summary>
                                        <pre className="mt-1 text-[10px] whitespace-pre-wrap text-muted-foreground/70 leading-relaxed">{batch.sync_report}</pre>
                                    </details>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Loader ─────────────────────────────────────────────────────────────────────
export async function loader() {
    const res = await fetch('/app/api/issues');
    const data = await res.json();
    const issues = Array.isArray(data) ? data : [];
    queryClient.setQueryData(['issues'], issues);
    return null;
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function WorkspaceIssuesPage() {
    const qc = useQueryClient();
    const { trackPageView } = useAppTracking('issues');
    useEffect(() => { trackPageView(); }, [trackPageView]);

    const { data: issues = [], isLoading: loading } = useQuery<Issue[]>({
        queryKey: ['issues'],
        queryFn: async () => {
            const res = await fetch('/app/api/issues');
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        },
        // Poll faster when there are active agents
        refetchInterval: (query) => {
            const data = query.state.data as Issue[] | undefined;
            const hasActive = data?.some(i => i.agent_status === 'queued' || i.agent_status === 'working');
            return hasActive ? 5000 : false;
        },
    });

    const [search, setSearch] = useState(() => localStorage.getItem('issues_search') ?? '');
    const [filterStatus, setFilterStatus] = useState<Status | 'all'>(() => (localStorage.getItem('issues_filterStatus') as Status | 'all') ?? 'all');
    const [filterPriority, setFilterPriority] = useState<Priority | 'all'>(() => (localStorage.getItem('issues_filterPriority') as Priority | 'all') ?? 'all');
    const [filterCategory, setFilterCategory] = useState<Category | 'all'>(() => (localStorage.getItem('issues_filterCategory') as Category | 'all') ?? 'all');
    const [filterApp, setFilterApp] = useState<AppTarget | 'all'>(() => (localStorage.getItem('issues_filterApp') as AppTarget | 'all') ?? 'all');
    const [filterAgentActive, setFilterAgentActive] = useState(() => localStorage.getItem('issues_filterAgentActive') === 'true');
    const [viewMode, setViewMode] = useState<'list' | 'kanban'>(() => (localStorage.getItem('issues_viewMode') as 'list' | 'kanban') ?? 'list');

    // Write state to localStorage in the event handlers — no useEffect needed
    const persistSearch = (v: string) => { setSearch(v); localStorage.setItem('issues_search', v); };
    const persistFilterStatus = (v: Status | 'all') => { setFilterStatus(v); localStorage.setItem('issues_filterStatus', v); };
    const persistFilterPriority = (v: Priority | 'all') => { setFilterPriority(v); localStorage.setItem('issues_filterPriority', v); };
    const persistFilterCategory = (v: Category | 'all') => { setFilterCategory(v); localStorage.setItem('issues_filterCategory', v); };
    const persistFilterApp = (v: AppTarget | 'all') => { setFilterApp(v); localStorage.setItem('issues_filterApp', v); };
    const toggleFilterAgentActive = () => setFilterAgentActive(v => { const next = !v; localStorage.setItem('issues_filterAgentActive', String(next)); return next; });
    const persistViewMode = (v: 'list' | 'kanban') => { setViewMode(v); localStorage.setItem('issues_viewMode', v); };

    const [modal, setModal] = useState<'new' | (Partial<Issue> & { _defaultStatus?: Status }) | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Issue | null>(null);
    const [lightbox, setLightbox] = useState<string | null>(null);

    // ── Selection & Dispatch ──────────────────────────────────────────────────
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [dispatching, setDispatching] = useState(false);

    const toggleSelectMode = () => {
        setSelectMode(m => !m);
        setSelectedIds(new Set());
    };

    const toggleSelect = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleDispatch = async () => {
        if (!selectedIds.size || dispatching) return;
        setDispatching(true);
        try {
            await fetch('/app/api/issues/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ issueIds: Array.from(selectedIds) }),
            });
            setSelectedIds(new Set());
            setSelectMode(false);
            qc.invalidateQueries({ queryKey: ['issues'] });
            qc.invalidateQueries({ queryKey: ['dispatch-batches'] });
        } finally {
            setDispatching(false);
        }
    };

    const openNewWithStatus = (status: Status) => setModal({ _defaultStatus: status } as Partial<Issue> & { _defaultStatus: Status });

    const dropMutation = useMutation({
        mutationFn: ({ issueId, newStatus }: { issueId: number; newStatus: Status }) =>
            fetch(`/app/api/issues/${issueId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            }),
        onMutate: ({ issueId, newStatus }) => {
            const prev = qc.getQueryData<Issue[]>(['issues']);
            qc.setQueryData<Issue[]>(['issues'], old =>
                old?.map(i => i.id === issueId ? { ...i, status: newStatus } : i) ?? []
            );
            return { prev };
        },
        onError: (_, __, ctx) => qc.setQueryData(['issues'], ctx?.prev),
        onSettled: () => qc.invalidateQueries({ queryKey: ['issues'] }),
    });

    const handleDrop = (issueId: number, newStatus: Status) => {
        dropMutation.mutate({ issueId, newStatus });
    };

    const filtered = issues
        .filter(i => {
            if (filterStatus !== 'all' && i.status !== filterStatus) return false;
            if (filterPriority !== 'all' && i.priority !== filterPriority) return false;
            if (filterCategory !== 'all' && i.category !== filterCategory) return false;
            if (filterApp !== 'all' && i.app !== filterApp) return false;
            if (filterAgentActive && i.agent_status !== 'queued' && i.agent_status !== 'working') return false;
            if (search && !i.title.toLowerCase().includes(search.toLowerCase()) &&
                !(i.description ?? '').toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

    const grouped = STATUS_ORDER.reduce<Record<Status, Issue[]>>((acc, status) => {
        acc[status] = filtered.filter(i => i.status === status);
        return acc;
    }, {} as Record<Status, Issue[]>);

    const openCount = issues.filter(i => i.status === 'open').length;
    const inProgressCount = issues.filter(i => i.status === 'in-progress').length;
    const doneCount = issues.filter(i => i.status === 'done').length;

    return (
        <AppLayout
            icon={<TriangleAlert size={18} />}
            iconClassName="bg-amber-500/10 text-amber-500"
            title="Workspace Improvements"
            subtitle={`${openCount} open · ${inProgressCount} in progress · ${doneCount} done`}
            actions={
                <>
                    {selectMode && selectedIds.size > 0 && (
                        <Button
                            size="sm"
                            variant="default"
                            className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white cursor-pointer"
                            onClick={handleDispatch}
                            disabled={dispatching}
                        >
                            {dispatching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BotMessageSquare className="h-3.5 w-3.5" />}
                            {dispatching ? 'Dispatching…' : `Dispatch ${selectedIds.size} to Sebastian`}
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant={selectMode ? 'secondary' : 'ghost'}
                        className="gap-1.5 cursor-pointer"
                        onClick={toggleSelectMode}
                        title={selectMode ? 'Exit select mode' : 'Select issues to dispatch'}
                    >
                        {selectMode ? <X className="h-3.5 w-3.5" /> : <SquareCheck className="h-3.5 w-3.5" />}
                        {selectMode ? 'Cancel' : 'Select'}
                    </Button>
                    <div className="flex items-center border border-border rounded-md overflow-hidden">
                        <button
                            className={cn('px-2 py-1.5 transition-colors cursor-pointer', viewMode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}
                            onClick={() => persistViewMode('list')}
                            title="List view"
                        >
                            <LayoutList className="h-3.5 w-3.5" />
                        </button>
                        <button
                            className={cn('px-2 py-1.5 transition-colors border-l border-border cursor-pointer', viewMode === 'kanban' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}
                            onClick={() => persistViewMode('kanban')}
                            title="Kanban view"
                        >
                            <Columns3 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    {!selectMode && (
                        <Button size="sm" onClick={() => setModal('new')} className="gap-1.5 cursor-pointer">
                            <Plus className="h-4 w-4" />New issue
                        </Button>
                    )}
                </>
            }
        >
        <div className="flex flex-col h-full overflow-hidden">
            {/* Filters */}
            <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border/50 shrink-0 flex-wrap">
                <div className="relative flex-1 min-w-36">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={e => persistSearch(e.target.value)}
                        placeholder="Search issues…"
                        className="pl-8 h-8 text-xs"
                    />
                </div>
                <Select value={filterApp} onValueChange={v => persistFilterApp(v as AppTarget | 'all')}>
                    <SelectTrigger className="h-8 text-xs w-28"><SelectValue placeholder="App" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all" className="text-xs">All apps</SelectItem>
                        {Object.entries(APP_META).filter(([k]) => k !== 'all').map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={v => setFilterStatus(v as Status | 'all')}>
                    <SelectTrigger className="h-8 text-xs w-28"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all" className="text-xs">All statuses</SelectItem>
                        {Object.entries(STATUS_META).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={filterPriority} onValueChange={v => setFilterPriority(v as Priority | 'all')}>
                    <SelectTrigger className="h-8 text-xs w-28"><SelectValue placeholder="Priority" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all" className="text-xs">All priorities</SelectItem>
                        {Object.entries(PRIORITY_META).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={filterCategory} onValueChange={v => setFilterCategory(v as Category | 'all')}>
                    <SelectTrigger className="h-8 text-xs w-28"><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all" className="text-xs">All categories</SelectItem>
                        {Object.entries(CATEGORY_META).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={toggleFilterAgentActive}
                                className={cn('h-8 gap-1.5 text-xs', filterAgentActive && 'bg-violet-500/10 text-violet-500 border-violet-500/30')}
                            >
                                <BotMessageSquare className={cn('h-3.5 w-3.5', filterAgentActive && 'animate-pulse')} />
                                Agent active
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Show only issues being worked by an agent</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            {/* Issue list / kanban */}
            {loading ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <AlertCircle className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                        {issues.length === 0 ? 'No issues yet. Create one!' : 'No issues match the filters.'}
                    </p>
                </div>
            ) : viewMode === 'list' ? (
                <div className="flex-1 overflow-y-auto">
                    {STATUS_ORDER.map(status => (
                        <StatusGroup
                            key={status}
                            status={status}
                            issues={grouped[status]}
                            onEdit={setModal}
                            onDelete={setDeleteTarget}
                            onLightbox={setLightbox}
                            defaultOpen={status === 'open' || status === 'in-progress'}
                            selectMode={selectMode}
                            selectedIds={selectedIds}
                            onSelect={toggleSelect}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex-1 overflow-hidden p-4">
                    <div className="flex gap-3 h-full overflow-x-auto">
                        {STATUS_ORDER.map(status => (
                            <KanbanColumn
                                key={status}
                                status={status}
                                issues={grouped[status]}
                                onEdit={setModal}
                                onDelete={setDeleteTarget}
                                onNewInStatus={openNewWithStatus}
                                onDrop={handleDrop}
                                selectMode={selectMode}
                                selectedIds={selectedIds}
                                onSelect={toggleSelect}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Modals */}
            {modal && (
                <IssueModal
                    issue={modal === 'new' ? {} : modal}
                    onClose={() => setModal(null)}
                    onSave={() => { setModal(null); qc.invalidateQueries({ queryKey: ['issues'] }); }}
                />
            )}

            {deleteTarget && (
                <DeleteConfirm
                    issue={deleteTarget}
                    onClose={() => setDeleteTarget(null)}
                    onDeleted={() => { setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['issues'] }); }}
                />
            )}
            {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
        </div>
        <DispatchBatchesPanel />
        </AppLayout>
    );
}
