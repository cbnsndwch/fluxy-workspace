import { DiffEditor, Editor } from '@monaco-editor/react';
import {
    History,
    GitBranch,
    RefreshCw,
    CheckCircle2,
    AlertCircle,
    FolderGit2,
    ChevronRight,
    Circle,
    Plus,
    Minus,
    FileEdit,
    Columns2,
    List
} from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';

import { AppLayout } from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    TooltipProvider
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GitCommit {
    sha: string;
    shortSha: string;
    subject: string;
    authorName: string;
    authorEmail: string;
    date: string;
    parents: string[];
}

interface GitFileChange {
    code: string;
    path: string;
    oldPath?: string;
}

interface GitStatus {
    branch: string;
    upstream: string | null;
    ahead: number;
    behind: number;
    staged: GitFileChange[];
    unstaged: GitFileChange[];
    untracked: string[];
    isClean: boolean;
}

interface GitBranchInfo {
    name: string;
    isCurrent: boolean;
    isRemote: boolean;
    shortSha: string;
    subject: string;
    upstream: string | null;
    upstreamTrack: string | null;
}

interface GitWorktree {
    path: string;
    branch: string | null;
    sha: string;
    isMain: boolean;
    isBare: boolean;
    isLocked: boolean;
}

interface CommitDetail {
    sha: string;
    shortSha: string;
    subject: string;
    body: string;
    authorName: string;
    authorEmail: string;
    date: string;
    parents: string[];
    stats: string;
    diff: string;
    truncated: boolean;
}

// ── Diff Parsing ──────────────────────────────────────────────────────────────

interface FileDiff {
    path: string;
    oldPath?: string;
    status: 'added' | 'deleted' | 'modified';
    original: string;
    modified: string;
}

type FileSidebarEntry =
    | { kind: 'diff'; file: FileDiff }
    | { kind: 'untracked'; path: string };

function guessLang(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        json: 'json',
        md: 'markdown',
        css: 'css',
        scss: 'scss',
        html: 'html',
        xml: 'xml',
        py: 'python',
        rs: 'rust',
        go: 'go',
        java: 'java',
        sh: 'shell',
        sql: 'sql',
        yaml: 'yaml',
        yml: 'yaml',
        toml: 'ini'
    };
    return map[ext] ?? 'plaintext';
}

function parseDiff(raw: string): FileDiff[] {
    const files: FileDiff[] = [];
    const sections = raw.split(/(?=^diff --git )/m).filter(s => s.trim());
    for (const section of sections) {
        const lines = section.split('\n');
        const match = lines[0].match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (!match) continue;
        const oldPath = match[1];
        const newPath = match[2];
        let status: FileDiff['status'] = 'modified';
        const origLines: string[] = [];
        const modLines: string[] = [];
        let inHunk = false;
        for (const line of lines.slice(1)) {
            if (line.startsWith('new file mode')) {
                status = 'added';
                continue;
            }
            if (line.startsWith('deleted file mode')) {
                status = 'deleted';
                continue;
            }
            if (/^(index |--- |\+\+\+ |Binary )/.test(line)) continue;
            if (line.startsWith('@@')) {
                inHunk = true;
                continue;
            }
            if (!inHunk || line.startsWith('\\')) continue;
            if (line.startsWith('-')) {
                origLines.push(line.slice(1));
                continue;
            }
            if (line.startsWith('+')) {
                modLines.push(line.slice(1));
                continue;
            }
            // context line
            origLines.push(line.slice(1));
            modLines.push(line.slice(1));
        }
        files.push({
            path: newPath,
            oldPath: oldPath !== newPath ? oldPath : undefined,
            status,
            original: origLines.join('\n'),
            modified: modLines.join('\n')
        });
    }
    return files;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
    const d = new Date(isoDate);
    const diffMs = Date.now() - d.getTime();
    const m = Math.floor(diffMs / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

function changeIcon(code: string): {
    icon: typeof Plus;
    className: string;
    label: string;
} {
    switch (code.toUpperCase()) {
        case 'A':
            return {
                icon: Plus,
                className: 'text-emerald-400',
                label: 'Added'
            };
        case 'D':
            return { icon: Minus, className: 'text-red-400', label: 'Deleted' };
        case 'R':
            return {
                icon: FileEdit,
                className: 'text-blue-400',
                label: 'Renamed'
            };
        case 'C':
            return {
                icon: FileEdit,
                className: 'text-blue-400',
                label: 'Copied'
            };
        default:
            return {
                icon: FileEdit,
                className: 'text-amber-400',
                label: 'Modified'
            };
    }
}

function avatarColor(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++)
        hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    const palette = [
        'bg-blue-500',
        'bg-violet-500',
        'bg-emerald-500',
        'bg-amber-500',
        'bg-rose-500',
        'bg-cyan-500',
        'bg-pink-500'
    ];
    return palette[Math.abs(hash) % palette.length];
}

function initials(name: string): string {
    return name
        .split(' ')
        .map(p => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CommitRow({
    commit,
    isSelected,
    onClick
}: {
    commit: GitCommit;
    isSelected: boolean;
    onClick: () => void;
}) {
    const isMerge = commit.parents.length > 1;
    return (
        <button
            onClick={onClick}
            className={cn(
                'w-full text-left px-4 py-3 border-b border-border/40 hover:bg-accent/50 transition-colors cursor-pointer',
                isSelected && 'bg-blue-500/10 border-l-2 border-l-blue-500'
            )}
        >
            <div className="flex items-start gap-3">
                <div
                    className={cn(
                        'w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5',
                        avatarColor(commit.authorEmail)
                    )}
                >
                    {initials(commit.authorName)}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        {isMerge && (
                            <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 h-4 border-blue-500/40 text-blue-400"
                            >
                                merge
                            </Badge>
                        )}
                        <span className="text-sm font-medium truncate leading-snug">
                            {commit.subject}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <code className="font-mono text-blue-400/80">
                            {commit.shortSha}
                        </code>
                        <span>·</span>
                        <span className="truncate">{commit.authorName}</span>
                        <span>·</span>
                        <span className="shrink-0">
                            {relativeTime(commit.date)}
                        </span>
                    </div>
                </div>
            </div>
        </button>
    );
}

function MonacoDiffView({
    diff,
    splitView,
    untrackedFiles = []
}: {
    diff: string;
    splitView: boolean;
    untrackedFiles?: string[];
}) {
    const files = useMemo(() => parseDiff(diff), [diff]);

    const allEntries = useMemo(
        (): FileSidebarEntry[] => [
            ...files.map(f => ({ kind: 'diff' as const, file: f })),
            ...untrackedFiles.map(p => ({
                kind: 'untracked' as const,
                path: p
            }))
        ],
        [files, untrackedFiles]
    );

    const [selectedIdx, setSelectedIdx] = useState(0);

    if (!diff && untrackedFiles.length === 0)
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No diff available
            </div>
        );

    if (splitView && allEntries.length > 0) {
        const entry = allEntries[selectedIdx] ?? allEntries[0];
        return (
            <div className="flex h-full overflow-hidden">
                {/* File list sidebar */}
                <div className="w-52 shrink-0 border-r border-border/50 overflow-y-auto bg-background/30">
                    {/* Diff files */}
                    {files.map((f, i) => (
                        <button
                            key={i}
                            onClick={() => setSelectedIdx(i)}
                            className={cn(
                                'w-full text-left px-3 py-2 border-b border-border/30 hover:bg-accent/40 transition-colors cursor-pointer',
                                i === selectedIdx && 'bg-blue-500/10'
                            )}
                        >
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <span
                                    className={cn(
                                        'text-[10px] font-bold shrink-0',
                                        f.status === 'added' &&
                                            'text-emerald-400',
                                        f.status === 'deleted' &&
                                            'text-red-400',
                                        f.status === 'modified' &&
                                            'text-amber-400'
                                    )}
                                >
                                    {f.status === 'added'
                                        ? 'A'
                                        : f.status === 'deleted'
                                          ? 'D'
                                          : 'M'}
                                </span>
                                <span
                                    className={cn(
                                        'text-xs font-mono truncate',
                                        i === selectedIdx
                                            ? 'text-blue-300'
                                            : 'text-foreground'
                                    )}
                                >
                                    {f.path.split('/').at(-1)}
                                </span>
                            </div>
                            <div className="text-[10px] text-muted-foreground/50 font-mono truncate pl-3.5">
                                {f.path}
                            </div>
                        </button>
                    ))}
                    {/* Untracked files */}
                    {untrackedFiles.length > 0 && (
                        <>
                            {files.length > 0 && (
                                <div className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-widest px-3 py-1.5 border-b border-border/20">
                                    Untracked
                                </div>
                            )}
                            {untrackedFiles.map((p, i) => {
                                const idx = files.length + i;
                                return (
                                    <button
                                        key={`ut-${i}`}
                                        onClick={() => setSelectedIdx(idx)}
                                        className={cn(
                                            'w-full text-left px-3 py-2 border-b border-border/30 hover:bg-accent/40 transition-colors cursor-pointer',
                                            idx === selectedIdx &&
                                                'bg-emerald-500/10'
                                        )}
                                    >
                                        <div className="flex items-center gap-1.5 mb-0.5">
                                            <span className="text-[10px] font-bold shrink-0 text-muted-foreground/50">
                                                ?
                                            </span>
                                            <span
                                                className={cn(
                                                    'text-xs font-mono truncate',
                                                    idx === selectedIdx
                                                        ? 'text-emerald-300'
                                                        : 'text-muted-foreground/70'
                                                )}
                                            >
                                                {p.split('/').at(-1)}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-muted-foreground/40 font-mono truncate pl-3.5">
                                            {p}
                                        </div>
                                    </button>
                                );
                            })}
                        </>
                    )}
                </div>
                {/* Monaco panel */}
                <div className="flex-1 min-w-0">
                    {entry.kind === 'untracked' ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                            <Plus size={24} className="opacity-20" />
                            <span className="text-sm">
                                New untracked file — not yet staged
                            </span>
                            <code className="text-xs opacity-40 font-mono">
                                {entry.path}
                            </code>
                        </div>
                    ) : (
                        <DiffEditor
                            key={entry.file.path}
                            height="100%"
                            original={entry.file.original}
                            modified={entry.file.modified}
                            language={guessLang(entry.file.path)}
                            theme="vs-dark"
                            options={{
                                renderSideBySide: true,
                                readOnly: true,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                fontSize: 12,
                                lineNumbers: 'on',
                                wordWrap: 'off',
                                renderLineHighlight: 'none',
                                diffWordWrap: 'off'
                            }}
                        />
                    )}
                </div>
            </div>
        );
    }

    // Unified mode — Monaco Editor with diff syntax highlighting
    if (!diff)
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                {untrackedFiles.length > 0
                    ? 'Only untracked files — no diff to display'
                    : 'No diff available'}
            </div>
        );
    return (
        <Editor
            height="100%"
            value={diff}
            language="diff"
            theme="vs-dark"
            options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                lineNumbers: 'on',
                wordWrap: 'off',
                renderLineHighlight: 'none'
            }}
        />
    );
}

function FileChangeRow({ change }: { change: GitFileChange }) {
    const { icon: Icon, className, label } = changeIcon(change.code);
    return (
        <div className="flex items-center gap-2 px-4 py-1.5 hover:bg-accent/30 rounded">
            <Icon size={12} className={cn(className, 'shrink-0')} />
            <span className="flex-1 font-mono text-xs truncate">
                {change.path}
            </span>
            {change.oldPath && (
                <span className="text-[10px] text-muted-foreground/50 truncate max-w-24">
                    {change.oldPath}
                </span>
            )}
            <span className={cn('text-[10px] shrink-0', className)}>
                {label}
            </span>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function GitViewerPage() {
    // ── URL-driven state ──────────────────────────────────────────────────────
    const { sha: urlSha } = useParams<{ sha?: string }>();
    const location = useLocation();
    const navigate = useNavigate();

    // Derive current tab from URL segment: /git-viewer/{tab}/...
    const segments = location.pathname.split('/').filter(Boolean);
    const tabSegment = segments[1] ?? 'log';
    const currentTab = ['branches', 'worktrees'].includes(tabSegment)
        ? tabSegment
        : 'log';

    // Derive selected item: null | '__uncommitted__' | sha string
    const selectedSha: string | null =
        urlSha ??
        (location.pathname.endsWith('/uncommitted') ? '__uncommitted__' : null);

    // ── Local state ───────────────────────────────────────────────────────────
    const [status, setStatus] = useState<GitStatus | null>(null);
    const [commits, setCommits] = useState<GitCommit[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [branches, setBranches] = useState<GitBranchInfo[]>([]);
    const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
    const [detail, setDetail] = useState<CommitDetail | null>(null);
    const [uncommittedDiff, setUncommittedDiff] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [splitView, setSplitView] = useState(true);

    // ── Sidebar data fetch ────────────────────────────────────────────────────
    const fetchAll = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [sRes, lRes, bRes, wRes] = await Promise.all([
                fetch('/app/api/git/status'),
                fetch('/app/api/git/log?limit=40&skip=0'),
                fetch('/app/api/git/branches'),
                fetch('/app/api/git/worktrees')
            ]);
            const [s, l, b, w] = await Promise.all([
                sRes.json(),
                lRes.json(),
                bRes.json(),
                wRes.json()
            ]);
            setStatus(s);
            setCommits(l.commits ?? []);
            setHasMore(l.hasMore ?? false);
            setBranches(Array.isArray(b) ? b : []);
            setWorktrees(Array.isArray(w) ? w : []);

            // Auto-select latest state on first load (only when no item is pre-selected in the URL)
            const path = window.location.pathname;
            if (path === '/git-viewer/log' || path === '/git-viewer') {
                if (!s.isClean) {
                    navigate('/git-viewer/log/uncommitted', { replace: true });
                } else if ((l.commits ?? []).length > 0) {
                    navigate(`/git-viewer/log/commit/${l.commits[0].sha}`, {
                        replace: true
                    });
                }
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [navigate]);

    // Runs once on mount (fetchAll is stable via useCallback + navigate is stable)
    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // ── Detail fetch — driven by URL selection ─────────────────────────────────
    // Syncing with an external data source (network) triggered by URL (external navigation).
    useEffect(() => {
        setDetail(null);
        setUncommittedDiff(null);
        if (!selectedSha) return;

        let cancelled = false;
        setDetailLoading(true);

        const url =
            selectedSha === '__uncommitted__'
                ? '/app/api/git/uncommitted'
                : `/app/api/git/commit/${selectedSha}`;

        fetch(url)
            .then(r => r.json())
            .then(data => {
                if (cancelled) return;
                if (selectedSha === '__uncommitted__') {
                    setUncommittedDiff(data.diff);
                } else {
                    setDetail(data);
                }
            })
            .catch(() => {
                /* error shown via null state */
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedSha]);

    // ── Load more commits ─────────────────────────────────────────────────────
    const loadMore = useCallback(async () => {
        if (loadingMore || !hasMore) return;
        setLoadingMore(true);
        try {
            const res = await fetch(
                `/app/api/git/log?limit=40&skip=${commits.length}`
            );
            const data = await res.json();
            setCommits(prev => [...prev, ...(data.commits ?? [])]);
            setHasMore(data.hasMore ?? false);
        } finally {
            setLoadingMore(false);
        }
    }, [commits.length, hasMore, loadingMore]);

    // ── Derived values ────────────────────────────────────────────────────────
    const totalChanges = status
        ? status.staged.length +
          status.unstaged.length +
          status.untracked.length
        : 0;
    const localBranches = branches.filter(b => !b.isRemote);
    const remoteBranches = branches.filter(b => b.isRemote);

    const subtitleParts: string[] = [];
    if (status?.branch) subtitleParts.push(status.branch);
    if (status?.upstream) subtitleParts.push(`→ ${status.upstream}`);
    if (status?.ahead) subtitleParts.push(`↑${status.ahead}`);
    if (status?.behind) subtitleParts.push(`↓${status.behind}`);

    return (
        <AppLayout
            icon={<History size={20} />}
            iconClassName="bg-lime-500/10 text-lime-500"
            title="Workspace Versions"
            subtitle={loading ? 'Loading…' : subtitleParts.join(' · ')}
            actions={
                <TooltipProvider>
                    <div className="flex items-center gap-2">
                        {status && (
                            <Badge
                                variant="outline"
                                className={cn(
                                    'gap-1 cursor-default',
                                    status.isClean
                                        ? 'border-emerald-500/40 text-emerald-400'
                                        : 'border-amber-500/40 text-amber-400'
                                )}
                            >
                                {status.isClean ? (
                                    <>
                                        <CheckCircle2 size={11} />
                                        Clean
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle size={11} />
                                        {totalChanges} change
                                        {totalChanges !== 1 ? 's' : ''}
                                    </>
                                )}
                            </Badge>
                        )}
                        {/* Split / Unified toggle */}
                        <div className="flex items-center rounded-md border border-border/50 overflow-hidden h-8">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setSplitView(false)}
                                        className={cn(
                                            'px-2 h-full flex items-center transition-colors cursor-pointer',
                                            !splitView
                                                ? 'bg-lime-500/20 text-lime-300'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
                                        )}
                                    >
                                        <List size={13} />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>Unified diff</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setSplitView(true)}
                                        className={cn(
                                            'px-2 h-full flex items-center transition-colors cursor-pointer',
                                            splitView
                                                ? 'bg-lime-500/20 text-lime-300'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
                                        )}
                                    >
                                        <Columns2 size={13} />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    Side-by-side diff
                                </TooltipContent>
                            </Tooltip>
                        </div>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={fetchAll}
                                    disabled={loading}
                                    className="h-8 w-8 p-0 cursor-pointer"
                                >
                                    <RefreshCw
                                        size={14}
                                        className={cn(
                                            loading && 'animate-spin'
                                        )}
                                    />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Refresh</TooltipContent>
                        </Tooltip>
                    </div>
                </TooltipProvider>
            }
        >
            {error ? (
                <div className="flex items-center justify-center h-full text-destructive text-sm gap-2">
                    <AlertCircle size={16} /> {error}
                </div>
            ) : (
                <div className="flex h-full">
                    {/* ── Left Panel ───────────────────────────────────── */}
                    <div className="w-80 shrink-0 flex flex-col border-r border-border/50">
                        <Tabs
                            value={currentTab}
                            onValueChange={tab =>
                                navigate(`/git-viewer/${tab}`)
                            }
                            className="flex flex-col h-full"
                        >
                            <TabsList className="w-full shrink-0 grid grid-cols-3 px-2 h-10">
                                <TabsTrigger
                                    value="log"
                                    className="text-xs cursor-pointer"
                                >
                                    Log
                                </TabsTrigger>
                                <TabsTrigger
                                    value="branches"
                                    className="text-xs cursor-pointer"
                                >
                                    Branches
                                </TabsTrigger>
                                <TabsTrigger
                                    value="worktrees"
                                    className="text-xs cursor-pointer"
                                >
                                    Worktrees
                                </TabsTrigger>
                            </TabsList>

                            {/* Log ── */}
                            <TabsContent
                                value="log"
                                className="flex-1 overflow-hidden flex flex-col m-0 mt-3"
                            >
                                {/* Uncommitted row — shown when dirty */}
                                {status && !status.isClean && (
                                    <button
                                        onClick={() =>
                                            navigate(
                                                '/git-viewer/log/uncommitted'
                                            )
                                        }
                                        className={cn(
                                            'w-full text-left px-4 py-3 border-b border-border/40 hover:bg-accent/50 transition-colors cursor-pointer',
                                            selectedSha === '__uncommitted__' &&
                                                'bg-amber-500/10 border-l-2 border-l-amber-500'
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center bg-amber-500/20">
                                                <AlertCircle
                                                    size={13}
                                                    className="text-amber-400"
                                                />
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-amber-300">
                                                    Uncommitted changes
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {[
                                                        status.staged.length > 0
                                                            ? `${status.staged.length} staged`
                                                            : '',
                                                        status.unstaged.length >
                                                        0
                                                            ? `${status.unstaged.length} modified`
                                                            : '',
                                                        status.untracked
                                                            .length > 0
                                                            ? `${status.untracked.length} untracked`
                                                            : ''
                                                    ]
                                                        .filter(Boolean)
                                                        .join(' · ')}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                )}

                                {/* Commit list */}
                                <div className="flex-1 overflow-y-auto">
                                    {loading ? (
                                        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                                            Loading…
                                        </div>
                                    ) : commits.length === 0 ? (
                                        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                                            No commits yet
                                        </div>
                                    ) : (
                                        <>
                                            {commits.map(c => (
                                                <CommitRow
                                                    key={c.sha}
                                                    commit={c}
                                                    isSelected={
                                                        selectedSha === c.sha
                                                    }
                                                    onClick={() =>
                                                        navigate(
                                                            `/git-viewer/log/commit/${c.sha}`
                                                        )
                                                    }
                                                />
                                            ))}
                                            {hasMore && (
                                                <button
                                                    onClick={loadMore}
                                                    disabled={loadingMore}
                                                    className="w-full py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors cursor-pointer"
                                                >
                                                    {loadingMore
                                                        ? 'Loading…'
                                                        : 'Load more commits ↓'}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </TabsContent>

                            {/* Branches ── */}
                            <TabsContent
                                value="branches"
                                className="flex-1 overflow-y-auto m-0 mt-3"
                            >
                                {localBranches.length > 0 && (
                                    <div className="px-3 mb-2">
                                        <div className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-2 py-1.5">
                                            Local
                                        </div>
                                        {localBranches.map(b => (
                                            <div
                                                key={b.name}
                                                className={cn(
                                                    'flex items-center gap-2 px-2 py-2 rounded-md text-sm hover:bg-accent/40 transition-colors',
                                                    b.isCurrent &&
                                                        'bg-blue-500/10'
                                                )}
                                            >
                                                {b.isCurrent ? (
                                                    <ChevronRight
                                                        size={13}
                                                        className="text-blue-400 shrink-0"
                                                    />
                                                ) : (
                                                    <Circle
                                                        size={7}
                                                        className="text-muted-foreground/30 shrink-0 ml-0.5 fill-current"
                                                    />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div
                                                        className={cn(
                                                            'font-mono text-xs truncate',
                                                            b.isCurrent
                                                                ? 'text-blue-300 font-semibold'
                                                                : ''
                                                        )}
                                                    >
                                                        {b.name}
                                                    </div>
                                                    {b.upstreamTrack && (
                                                        <div className="text-[10px] text-muted-foreground/50">
                                                            {b.upstreamTrack}
                                                        </div>
                                                    )}
                                                </div>
                                                <code className="text-[10px] text-muted-foreground/60 font-mono shrink-0">
                                                    {b.shortSha}
                                                </code>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {remoteBranches.length > 0 && (
                                    <div className="px-3 mt-3">
                                        <div className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-2 py-1.5">
                                            Remote
                                        </div>
                                        {remoteBranches.map(b => (
                                            <div
                                                key={b.name}
                                                className="flex items-center gap-2 px-2 py-2 rounded-md text-sm hover:bg-accent/40 transition-colors"
                                            >
                                                <GitBranch
                                                    size={11}
                                                    className="text-muted-foreground/40 shrink-0"
                                                />
                                                <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                                                    {b.name.replace(
                                                        'remotes/',
                                                        ''
                                                    )}
                                                </span>
                                                <code className="text-[10px] text-muted-foreground/50 font-mono shrink-0">
                                                    {b.shortSha}
                                                </code>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {branches.length === 0 && !loading && (
                                    <div className="text-center py-12 text-muted-foreground text-sm">
                                        No branches found
                                    </div>
                                )}
                            </TabsContent>

                            {/* Worktrees ── */}
                            <TabsContent
                                value="worktrees"
                                className="flex-1 overflow-y-auto m-0 mt-3 px-3"
                            >
                                {worktrees.length === 0 ? (
                                    <div className="text-center py-12 text-muted-foreground text-sm">
                                        No worktrees
                                    </div>
                                ) : (
                                    worktrees.map((wt, i) => (
                                        <div
                                            key={i}
                                            className="mb-2 p-3 rounded-lg border border-border/50 bg-card/50"
                                        >
                                            <div className="flex items-center gap-2 mb-1">
                                                <FolderGit2
                                                    size={13}
                                                    className={
                                                        wt.isMain
                                                            ? 'text-blue-400'
                                                            : 'text-muted-foreground/60'
                                                    }
                                                />
                                                <span className="text-xs font-semibold truncate">
                                                    {wt.isMain
                                                        ? 'main worktree'
                                                        : (wt.path
                                                              .split('/')
                                                              .at(-1) ??
                                                          wt.path)}
                                                </span>
                                                {wt.isLocked && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[9px] px-1 h-4 border-amber-500/40 text-amber-400"
                                                    >
                                                        locked
                                                    </Badge>
                                                )}
                                                {wt.isBare && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[9px] px-1 h-4 border-muted text-muted-foreground"
                                                    >
                                                        bare
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-muted-foreground font-mono truncate pl-5">
                                                {wt.path}
                                            </div>
                                            {wt.branch && (
                                                <div className="flex items-center gap-1 pl-5 mt-1">
                                                    <GitBranch
                                                        size={9}
                                                        className="text-muted-foreground/40 shrink-0"
                                                    />
                                                    <span className="text-[10px] font-mono text-muted-foreground">
                                                        {wt.branch}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground/40 ml-1">
                                                        @ {wt.sha}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </TabsContent>
                        </Tabs>
                    </div>

                    {/* ── Right Panel (detail / diff) ───────────────────── */}
                    <div className="flex-1 overflow-hidden flex flex-col">
                        {!selectedSha ? (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                                <History size={40} className="opacity-15" />
                                <span className="text-sm">
                                    Select a commit to view diff
                                </span>
                            </div>
                        ) : detailLoading ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                                Loading…
                            </div>
                        ) : selectedSha === '__uncommitted__' ? (
                            /* ── Uncommitted diff view ── */
                            <div className="flex flex-col h-full">
                                <div className="px-6 py-4 border-b border-border/50 shrink-0">
                                    <div className="flex items-center gap-2 mb-2">
                                        <AlertCircle
                                            size={15}
                                            className="text-amber-400"
                                        />
                                        <span className="font-semibold text-amber-300">
                                            Uncommitted changes
                                        </span>
                                    </div>
                                    {status && (
                                        <div className="flex flex-wrap gap-4 text-xs">
                                            {status.staged.length > 0 && (
                                                <span className="text-emerald-400">
                                                    {status.staged.length}{' '}
                                                    staged
                                                </span>
                                            )}
                                            {status.unstaged.length > 0 && (
                                                <span className="text-amber-400">
                                                    {status.unstaged.length}{' '}
                                                    modified
                                                </span>
                                            )}
                                            {status.untracked.length > 0 && (
                                                <span className="text-muted-foreground">
                                                    {status.untracked.length}{' '}
                                                    untracked
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* File list — only in unified mode; split mode uses MonacoDiffView's own sidebar */}
                                {!splitView &&
                                    status &&
                                    (status.staged.length > 0 ||
                                        status.unstaged.length > 0 ||
                                        status.untracked.length > 0) && (
                                        <div className="shrink-0 border-b border-border/50 overflow-y-auto max-h-52 py-2">
                                            {status.staged.length > 0 && (
                                                <>
                                                    <div className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-4 py-1">
                                                        Staged
                                                    </div>
                                                    {status.staged.map(
                                                        (f, i) => (
                                                            <FileChangeRow
                                                                key={i}
                                                                change={f}
                                                            />
                                                        )
                                                    )}
                                                </>
                                            )}
                                            {status.unstaged.length > 0 && (
                                                <>
                                                    <div className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-4 py-1 mt-1">
                                                        Modified
                                                    </div>
                                                    {status.unstaged.map(
                                                        (f, i) => (
                                                            <FileChangeRow
                                                                key={i}
                                                                change={f}
                                                            />
                                                        )
                                                    )}
                                                </>
                                            )}
                                            {status.untracked.length > 0 && (
                                                <>
                                                    <div className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-4 py-1 mt-1">
                                                        Untracked
                                                    </div>
                                                    {status.untracked.map(
                                                        (f, i) => (
                                                            <div
                                                                key={i}
                                                                className="flex items-center gap-2 px-4 py-1.5 hover:bg-accent/30 rounded"
                                                            >
                                                                <Plus
                                                                    size={12}
                                                                    className="text-muted-foreground/40 shrink-0"
                                                                />
                                                                <span className="font-mono text-xs truncate text-muted-foreground">
                                                                    {f}
                                                                </span>
                                                            </div>
                                                        )
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}

                                {/* Diff */}
                                <div className="flex-1 overflow-hidden">
                                    {uncommittedDiff !== null ? (
                                        <MonacoDiffView
                                            key="uncommitted"
                                            diff={uncommittedDiff}
                                            splitView={splitView}
                                            untrackedFiles={
                                                status?.untracked ?? []
                                            }
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                                            Loading diff…
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : detail ? (
                            /* ── Commit detail view ── */
                            <div className="flex flex-col h-full">
                                <div className="px-6 py-4 border-b border-border/50 shrink-0">
                                    <div className="flex items-start gap-3 mb-3">
                                        <div
                                            className={cn(
                                                'w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white',
                                                avatarColor(detail.authorEmail)
                                            )}
                                        >
                                            {initials(detail.authorName)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold leading-snug mb-1">
                                                {detail.subject}
                                            </div>
                                            {detail.body && (
                                                <p className="text-xs text-muted-foreground whitespace-pre-wrap mb-2">
                                                    {detail.body}
                                                </p>
                                            )}
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                <code className="font-mono text-blue-400/80">
                                                    {detail.sha.slice(0, 12)}
                                                </code>
                                                <span>{detail.authorName}</span>
                                                <span>
                                                    {new Date(
                                                        detail.date
                                                    ).toLocaleString()}
                                                </span>
                                                {detail.truncated && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[9px] px-1 h-4 border-amber-500/40 text-amber-400"
                                                    >
                                                        diff truncated
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {/* Stat summary — skip first line (it repeats the commit) */}
                                    {detail.stats && (
                                        <pre className="text-[11px] font-mono bg-muted/30 rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap leading-relaxed text-muted-foreground">
                                            {detail.stats
                                                .split('\n')
                                                .slice(1)
                                                .join('\n')
                                                .trim()}
                                        </pre>
                                    )}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <MonacoDiffView
                                        key={detail.sha}
                                        diff={detail.diff}
                                        splitView={splitView}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            )}
        </AppLayout>
    );
}
