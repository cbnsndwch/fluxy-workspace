import {
    CheckCircle2,
    CircleDot,
    Clock,
    ImagePlus,
    Mic,
    MicOff,
    X,
    XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { APPS } from '@/lib/appRegistry';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────────────
export type Status = 'open' | 'in-progress' | 'done' | 'wont-fix';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type Category = 'bug' | 'feature' | 'improvement' | 'docs' | 'other';
export type AppTarget = string;
export type AgentStatus = 'queued' | 'working' | 'done' | 'failed' | null;

export interface Issue {
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

export interface DispatchBatch {
    id: number;
    issue_ids: string;
    status: 'working' | 'syncing' | 'done' | 'failed';
    sync_report: string | null;
    created_at: string;
    updated_at: string;
    issues: Array<{
        id: number;
        title: string;
        agent_status: AgentStatus;
        agent_log: string | null;
        agent_branch: string | null;
    }>;
}

// ── Metadata ────────────────────────────────────────────────────────────────────
export const STATUS_META: Record<
    Status,
    { label: string; icon: ReactNode; color: string }
> = {
    open: {
        label: 'Open',
        icon: <CircleDot className="h-3 w-3" />,
        color: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
    },
    'in-progress': {
        label: 'In Progress',
        icon: <Clock className="h-3 w-3" />,
        color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    },
    done: {
        label: 'Done',
        icon: <CheckCircle2 className="h-3 w-3" />,
        color: 'text-green-500 bg-green-500/10 border-green-500/20',
    },
    'wont-fix': {
        label: "Won't Fix",
        icon: <XCircle className="h-3 w-3" />,
        color: 'text-muted-foreground bg-muted/30 border-border',
    },
};

export const PRIORITY_META: Record<Priority, { label: string; color: string }> =
    {
        low: {
            label: 'Low',
            color: 'text-muted-foreground bg-muted/30 border-border',
        },
        medium: {
            label: 'Medium',
            color: 'text-sky-500 bg-sky-500/10 border-sky-500/20',
        },
        high: {
            label: 'High',
            color: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
        },
        critical: {
            label: 'Critical',
            color: 'text-red-500 bg-red-500/10 border-red-500/20',
        },
    };

export const CATEGORY_META: Record<Category, { label: string }> = {
    bug: { label: 'Bug' },
    feature: { label: 'Feature' },
    improvement: { label: 'Improvement' },
    docs: { label: 'Docs' },
    other: { label: 'Other' },
};

export const AGENT_STATUS_META: Record<
    NonNullable<AgentStatus>,
    { label: string; color: string; pulse?: boolean }
> = {
    queued: {
        label: 'Queued',
        color: 'text-violet-500 bg-violet-500/10 border-violet-500/20',
    },
    working: {
        label: 'Working',
        color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
        pulse: true,
    },
    done: {
        label: 'Done',
        color: 'text-green-500 bg-green-500/10 border-green-500/20',
    },
    failed: {
        label: 'Failed',
        color: 'text-red-500 bg-red-500/10 border-red-500/20',
    },
};

// Registry IDs → issue app IDs (for entries where they differ)
export const REGISTRY_TO_ISSUE_ID: Record<string, string> = {
    appideas: 'app-ideas',
    imagegen: 'image-studio',
    'deep-research': 'research',
    dbviewer: 'db-viewer',
};

// Derived from appRegistry — new apps appear here automatically
export const APP_META: Record<string, { label: string }> = {
    all: { label: 'General' },
    ...Object.fromEntries(
        APPS.map((app) => {
            const id = REGISTRY_TO_ISSUE_ID[app.id] ?? app.id;
            return [id, { label: app.name }];
        }),
    ),
};

// ── Empty form ───────────────────────────────────────────────────────────────────
export const EMPTY_FORM = {
    title: '',
    description: '',
    status: 'open' as Status,
    priority: 'medium' as Priority,
    category: 'improvement' as Category,
    app: 'all' as AppTarget,
    attachments: [] as string[],
};

// ── Voice hook ───────────────────────────────────────────────────────────────────
export function useVoiceInput(onTranscript: (text: string) => void) {
    const [listening, setListening] = useState(false);
    const recRef = useRef<SpeechRecognition | null>(null);
    const supported =
        typeof window !== 'undefined' &&
        ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

    const stop = useCallback(() => {
        recRef.current?.stop();
        setListening(false);
    }, []);

    const toggle = useCallback(() => {
        if (!supported) return;
        if (listening) {
            stop();
            return;
        }
        const SR =
            window.SpeechRecognition ??
            (
                window as unknown as {
                    webkitSpeechRecognition: typeof SpeechRecognition;
                }
            ).webkitSpeechRecognition;
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = false;
        rec.lang = 'en-US';
        rec.onresult = (e: SpeechRecognitionEvent) => {
            const transcript = Array.from(e.results)
                .slice(e.resultIndex)
                .map((r) => r[0].transcript)
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

// ── Issue Modal ─────────────────────────────────────────────────────────────────
export function IssueModal({
    issue,
    onClose,
    onSave,
}: {
    issue: Partial<Issue> | null;
    onClose: () => void;
    onSave: (saved: Issue) => void;
}) {
    const isNew = !issue?.id;
    const defaultStatus = (
        issue as Partial<Issue> & { _defaultStatus?: Status }
    )?._defaultStatus;
    const [form, setForm] = useState(
        issue?.id
            ? {
                  title: issue.title ?? '',
                  description: issue.description ?? '',
                  status: (issue.status ?? 'open') as Status,
                  priority: (issue.priority ?? 'medium') as Priority,
                  category: (issue.category ?? 'improvement') as Category,
                  app: (issue.app ?? 'all') as AppTarget,
                  attachments: (() => {
                      try {
                          return JSON.parse(issue.attachments ?? '[]');
                      } catch {
                          return [];
                      }
                  })() as string[],
              }
            : {
                  ...EMPTY_FORM,
                  status: defaultStatus ?? EMPTY_FORM.status,
                  // Respect a pre-supplied app (e.g. from ReportIssueAction) even on new issues
                  app: (issue?.app ?? EMPTY_FORM.app) as AppTarget,
                  attachments: [] as string[],
              },
    );
    const [saving, setSaving] = useState(false);
    const [savingToDocs, setSavingToDocs] = useState(false);
    const [savedToDocs, setSavedToDocs] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const voiceTitle = useVoiceInput((text) => {
        setForm((f) => ({
            ...f,
            title: f.title ? f.title + ' ' + text : text,
        }));
    });
    const voiceDesc = useVoiceInput((text) => {
        setForm((f) => ({
            ...f,
            description: f.description ? f.description + ' ' + text : text,
        }));
    });

    const toggleTitleVoice = () => {
        voiceDesc.stop();
        voiceTitle.toggle();
    };
    const toggleDescVoice = () => {
        voiceTitle.stop();
        voiceDesc.toggle();
    };

    const handleSave = async () => {
        if (!form.title.trim()) return;
        setSaving(true);
        try {
            const url = isNew
                ? '/app/api/issues'
                : `/app/api/issues/${issue!.id}`;
            const method = isNew ? 'POST' : 'PUT';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const saved: Issue = await res.json();
            onSave(saved);
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
                    reader.onload = () =>
                        resolve((reader.result as string).split(',')[1]);
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
            setForm((f) => ({
                ...f,
                attachments: [...f.attachments, ...newUrls],
            }));
        } finally {
            setUploading(false);
        }
    }, []);

    const removeAttachment = (url: string) => {
        setForm((f) => ({
            ...f,
            attachments: f.attachments.filter((a) => a !== url),
        }));
    };

    const handlePaste = useCallback(
        (e: React.ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const files = Array.from(items)
                .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
                .map((i) => i.getAsFile())
                .filter(Boolean) as File[];
            if (!files.length) return;
            e.preventDefault();
            const dt = new DataTransfer();
            files.forEach((f) => dt.items.add(f));
            handleFiles(dt.files);
        },
        [handleFiles],
    );

    const handleSaveToDocs = async () => {
        if (!form.description.trim()) return;
        const slug = form.title
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
        const docPath = `research/${slug}.md`;
        const content = `# ${form.title}\n\n${form.description}`;
        setSavingToDocs(true);
        try {
            await fetch(
                `/app/api/docs/file?path=${encodeURIComponent(docPath)}`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content }),
                },
            );
            setSavedToDocs(true);
            setTimeout(() => setSavedToDocs(false), 3000);
        } finally {
            setSavingToDocs(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                className="sm:max-w-xl flex flex-col max-h-[90vh]"
                onPaste={handlePaste}
            >
                <DialogHeader>
                    <DialogTitle>
                        {isNew ? 'New issue' : 'Edit issue'}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2 overflow-y-auto flex-1 min-h-0 pr-1">
                    {/* Title + voice */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground">
                                Title
                            </label>
                            {voiceTitle.supported && (
                                <button
                                    type="button"
                                    onClick={toggleTitleVoice}
                                    className={cn(
                                        'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors',
                                        voiceTitle.listening
                                            ? 'bg-red-500/10 border-red-500/30 text-red-500 animate-pulse'
                                            : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
                                    )}
                                >
                                    {voiceTitle.listening ? (
                                        <MicOff className="h-3 w-3" />
                                    ) : (
                                        <Mic className="h-3 w-3" />
                                    )}
                                    {voiceTitle.listening ? 'Stop' : 'Dictate'}
                                </button>
                            )}
                        </div>
                        <Input
                            placeholder="Issue title"
                            value={form.title}
                            onChange={(e) =>
                                setForm((f) => ({
                                    ...f,
                                    title: e.target.value,
                                }))
                            }
                            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                            autoFocus
                        />
                    </div>

                    {/* Description + voice */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground">
                                Description
                            </label>
                            <div className="flex items-center gap-1.5">
                                {!isNew && form.description.trim() && (
                                    <button
                                        type="button"
                                        onClick={handleSaveToDocs}
                                        disabled={savingToDocs}
                                        className={cn(
                                            'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50',
                                            savedToDocs
                                                ? 'bg-green-500/10 border-green-500/30 text-green-500'
                                                : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
                                        )}
                                    >
                                        {savedToDocs
                                            ? '✓ Saved'
                                            : savingToDocs
                                              ? 'Saving…'
                                              : '↗ Save to Docs'}
                                    </button>
                                )}
                                {voiceDesc.supported && (
                                    <button
                                        type="button"
                                        onClick={toggleDescVoice}
                                        className={cn(
                                            'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors',
                                            voiceDesc.listening
                                                ? 'bg-red-500/10 border-red-500/30 text-red-500 animate-pulse'
                                                : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
                                        )}
                                    >
                                        {voiceDesc.listening ? (
                                            <MicOff className="h-3 w-3" />
                                        ) : (
                                            <Mic className="h-3 w-3" />
                                        )}
                                        {voiceDesc.listening
                                            ? 'Stop'
                                            : 'Dictate'}
                                    </button>
                                )}
                            </div>
                        </div>
                        <Textarea
                            placeholder="Describe the issue… (optional)"
                            value={form.description}
                            onChange={(e) =>
                                setForm((f) => ({
                                    ...f,
                                    description: e.target.value,
                                }))
                            }
                            onPaste={handlePaste}
                            rows={10}
                            className="resize-none"
                        />
                    </div>

                    {/* Attachments */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground">
                                Screenshots / Images
                            </label>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground/50">
                                    or paste
                                </span>
                                <button
                                    type="button"
                                    onClick={() =>
                                        fileInputRef.current?.click()
                                    }
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
                                onChange={(e) => handleFiles(e.target.files)}
                            />
                        </div>
                        {form.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {form.attachments.map((url) => (
                                    <div key={url} className="relative group">
                                        <img
                                            src={url}
                                            alt=""
                                            className="h-16 w-16 object-cover rounded-md border border-border"
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                removeAttachment(url)
                                            }
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
                            <label className="text-xs font-medium text-muted-foreground">
                                App
                            </label>
                            <Select
                                value={form.app}
                                onValueChange={(v) =>
                                    setForm((f) => ({
                                        ...f,
                                        app: v as AppTarget,
                                    }))
                                }
                            >
                                <SelectTrigger className="h-8 text-xs w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(APP_META).map(([k, v]) => (
                                        <SelectItem
                                            key={k}
                                            value={k}
                                            className="text-xs"
                                        >
                                            {v.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">
                                Category
                            </label>
                            <Select
                                value={form.category}
                                onValueChange={(v) =>
                                    setForm((f) => ({
                                        ...f,
                                        category: v as Category,
                                    }))
                                }
                            >
                                <SelectTrigger className="h-8 text-xs w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(CATEGORY_META).map(
                                        ([k, v]) => (
                                            <SelectItem
                                                key={k}
                                                value={k}
                                                className="text-xs"
                                            >
                                                {v.label}
                                            </SelectItem>
                                        ),
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">
                                Priority
                            </label>
                            <Select
                                value={form.priority}
                                onValueChange={(v) =>
                                    setForm((f) => ({
                                        ...f,
                                        priority: v as Priority,
                                    }))
                                }
                            >
                                <SelectTrigger className="h-8 text-xs w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(PRIORITY_META).map(
                                        ([k, v]) => (
                                            <SelectItem
                                                key={k}
                                                value={k}
                                                className="text-xs"
                                            >
                                                {v.label}
                                            </SelectItem>
                                        ),
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">
                                Status
                            </label>
                            <Select
                                value={form.status}
                                onValueChange={(v) =>
                                    setForm((f) => ({
                                        ...f,
                                        status: v as Status,
                                    }))
                                }
                            >
                                <SelectTrigger className="h-8 text-xs w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(STATUS_META).map(
                                        ([k, v]) => (
                                            <SelectItem
                                                key={k}
                                                value={k}
                                                className="text-xs"
                                            >
                                                {v.label}
                                            </SelectItem>
                                        ),
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-border">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={!form.title.trim() || saving}
                    >
                        {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
