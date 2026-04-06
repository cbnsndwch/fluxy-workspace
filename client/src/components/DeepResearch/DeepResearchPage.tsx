import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useAppTracking } from '@/components/Analytics/AnalyticsProvider';
import { useLoaderData } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    Archive, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Circle,
    Clock, Download, Loader2, Plus, RefreshCw, SearchIcon, Share2, Link, Trash2, X, Repeat2,
    FlaskConical,
} from 'lucide-react';
import { AppLayout } from '@/components/ui/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

type DetailLevel = 'brief' | 'standard' | 'deep';
type TopicStatus = 'idle' | 'queued' | 'in_progress' | 'completed' | 'failed';
type RevisitInterval = 'daily' | 'weekly' | 'twice_monthly' | 'monthly' | 'quarterly' | 'yearly';

interface ResearchTopic {
    id: number;
    title: string;
    description: string | null;
    detail_level: DetailLevel;
    status: TopicStatus;
    ongoing: number;
    revisit_interval: RevisitInterval | null;
    last_researched_at: string | null;
    next_revisit_at: string | null;
    session_count: number;
    latest_session_id: number | null;
    latest_session_status: string | null;
    latest_session_completed_at: string | null;
    created_at: string;
}

interface Finding {
    id: number;
    session_id: number;
    type: string;
    content: string;
    source_url: string | null;
    source_title: string | null;
    created_at: string;
}

interface Report {
    id: number;
    session_id: number;
    content: string;
    share_token: string | null;
    created_at: string;
}

interface Session {
    id: number;
    topic_id: number;
    status: string;
    current_step: string | null;
    error: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    findings_count?: number;
    report_id?: number | null;
    findings?: Finding[];
    report?: Report | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DETAIL_LABELS: Record<DetailLevel, { label: string; desc: string; color: string }> = {
    brief:    { label: 'Brief',    desc: 'up to 10 sources, ~400 words',   color: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
    standard: { label: 'Standard', desc: '10–50 sources, ~1200 words',      color: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
    deep:     { label: 'Deep',     desc: '50+ sources, 3000+ words',        color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
    idle:        { label: 'Idle',        icon: Circle,       color: 'text-muted-foreground' },
    queued:      { label: 'Queued',      icon: Clock,        color: 'text-yellow-400' },
    in_progress: { label: 'Researching', icon: Loader2,      color: 'text-blue-400' },
    completed:   { label: 'Completed',   icon: CheckCircle2, color: 'text-emerald-400' },
    failed:      { label: 'Failed',      icon: X,            color: 'text-red-400' },
    searching:   { label: 'Searching',   icon: SearchIcon,   color: 'text-blue-400' },
    synthesizing:{ label: 'Synthesizing',icon: BookOpen,     color: 'text-violet-400' },
};

const REVISIT_LABELS: Record<RevisitInterval, string> = {
    daily:         'Every day',
    weekly:        'Every week',
    twice_monthly: 'Twice a month',
    monthly:       'Once a month',
    quarterly:     'Once a quarter',
    yearly:        'Once a year',
};

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader(): Promise<ResearchTopic[]> {
    const res = await fetch('/app/api/research/topics');
    return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(dateStr: string | null) {
    if (!dateStr) return null;
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRelative(dateStr: string | null) {
    if (!dateStr) return null;
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'Z');
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return fmt(dateStr);
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DeepResearchPage() {
    const initialTopics = useLoaderData() as ResearchTopic[];
    const { trackPageView } = useAppTracking('deep-research');
    useEffect(() => { trackPageView(); }, [trackPageView]);
    const [topics, setTopics] = useState<ResearchTopic[]>(initialTopics);
    const [loading, setLoading] = useState(false);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [showNew, setShowNew] = useState(false);

    const loadTopics = () => {
        fetch('/app/api/research/topics')
            .then(r => r.json())
            .then(d => { setTopics(d); setLoading(false); })
            .catch(() => setLoading(false));
    };

    // Poll fast (4s) when something is active, slow (20s) otherwise
    const hasActive = topics.some(t => t.status === 'queued' || t.status === 'in_progress');
    useEffect(() => {
        const id = setInterval(loadTopics, hasActive ? 4_000 : 20_000);
        return () => clearInterval(id);
    }, [hasActive]);

    const selectedTopic = topics.find(t => t.id === selectedId) ?? null;

    const handleCreate = async (data: {
        title: string;
        description: string;
        detail_level: DetailLevel;
        ongoing: boolean;
        revisit_interval: RevisitInterval | null;
    }) => {
        const r = await fetch('/app/api/research/topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        const topic = await r.json();
        setShowNew(false);
        loadTopics();
        setSelectedId(topic.id);
    };

    const handleDelete = async (id: number) => {
        await fetch(`/app/api/research/topics/${id}`, { method: 'DELETE' });
        if (selectedId === id) setSelectedId(null);
        loadTopics();
    };

    const handleRequeue = async (id: number) => {
        await fetch(`/app/api/research/topics/${id}/queue`, { method: 'POST' });
        loadTopics();
    };

    const handleUpdate = async (id: number, patch: Partial<ResearchTopic>) => {
        await fetch(`/app/api/research/topics/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        loadTopics();
    };

    const ongoing = topics.filter(t => t.ongoing);
    const oneOff = topics.filter(t => !t.ongoing);

    const activeCount = topics.filter(t => t.status === 'queued' || t.status === 'in_progress').length;

    return (
        <AppLayout
            icon={<FlaskConical size={20} />}
            iconClassName="bg-violet-500/10 text-violet-500"
            title="Deep Research"
            subtitle={
                <>
                    {topics.length} topic{topics.length !== 1 ? 's' : ''}
                    {activeCount > 0 && <span className="text-violet-400"> · {activeCount} active</span>}
                </>
            }
            actions={
                <Button size="sm" onClick={() => setShowNew(true)} className="cursor-pointer gap-1.5">
                    <Plus className="h-4 w-4" /> New Topic
                </Button>
            }
        >
        <div className="flex h-full overflow-hidden">
            {/* ── Topic List ────────────────────────────────────────────── */}
            <div className={cn(
                'flex flex-col border-r border-border/50 transition-all duration-300',
                selectedId ? 'w-96 shrink-0' : 'flex-1'
            )}>
                {/* List */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                    ) : topics.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
                            <SearchIcon className="h-10 w-10 text-muted-foreground/30" />
                            <p className="text-sm text-muted-foreground">No research topics yet.</p>
                            <p className="text-xs text-muted-foreground/70">
                                Add a topic and Sebastian will scour the web for you.
                            </p>
                            <Button size="sm" variant="outline" onClick={() => setShowNew(true)} className="mt-1 cursor-pointer">
                                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Topic
                            </Button>
                        </div>
                    ) : (
                        <div className="p-4 space-y-6">
                            {ongoing.length > 0 && (
                                <TopicGroup
                                    label="Ongoing Research"
                                    icon={<Repeat2 className="h-3.5 w-3.5" />}
                                    topics={ongoing}
                                    selectedId={selectedId}
                                    onSelect={setSelectedId}
                                    onDelete={handleDelete}
                                    onRequeue={handleRequeue}
                                />
                            )}
                            {oneOff.length > 0 && (
                                <TopicGroup
                                    label={ongoing.length > 0 ? "One-off Topics" : "Topics"}
                                    topics={oneOff}
                                    selectedId={selectedId}
                                    onSelect={setSelectedId}
                                    onDelete={handleDelete}
                                    onRequeue={handleRequeue}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Detail Panel ──────────────────────────────────────────── */}
            {selectedTopic && (
                <TopicDetailPanel
                    topic={selectedTopic}
                    onClose={() => setSelectedId(null)}
                    onRequeue={handleRequeue}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                />
            )}

        </div>

        {/* ── New Topic Modal ────────────────────────────────────────── */}
        <NewTopicModal
            open={showNew}
            onClose={() => setShowNew(false)}
            onCreate={handleCreate}
        />
        </AppLayout>
    );
}

// ── Topic Group ───────────────────────────────────────────────────────────────

function TopicGroup({
    label, icon, topics, selectedId, onSelect, onDelete, onRequeue,
}: {
    label: string;
    icon?: React.ReactNode;
    topics: ResearchTopic[];
    selectedId: number | null;
    onSelect: (id: number) => void;
    onDelete: (id: number) => void;
    onRequeue: (id: number) => void;
}) {
    return (
        <div>
            <div className="flex items-center gap-1.5 px-1 mb-2">
                {icon && <span className="text-muted-foreground">{icon}</span>}
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
            </div>
            <div className="space-y-1.5">
                {topics.map(t => (
                    <TopicCard
                        key={t.id}
                        topic={t}
                        selected={selectedId === t.id}
                        onSelect={() => onSelect(t.id)}
                        onDelete={() => onDelete(t.id)}
                        onRequeue={() => onRequeue(t.id)}
                    />
                ))}
            </div>
        </div>
    );
}

// ── Topic Card ────────────────────────────────────────────────────────────────

function TopicCard({ topic, selected, onSelect, onDelete, onRequeue }: {
    topic: ResearchTopic;
    selected: boolean;
    onSelect: () => void;
    onDelete: () => void;
    onRequeue: () => void;
}) {
    const sc = STATUS_CONFIG[topic.status] ?? STATUS_CONFIG.idle;
    const StatusIcon = sc.icon;
    const dl = DETAIL_LABELS[topic.detail_level];
    const isActive = topic.status === 'queued' || topic.status === 'in_progress';

    return (
        <div
            onClick={onSelect}
            className={cn(
                'group relative flex flex-col gap-1.5 p-3 rounded-lg border cursor-pointer transition-all',
                selected
                    ? 'bg-sidebar-accent border-primary/40'
                    : 'bg-card border-border hover:border-primary/30 hover:bg-card/80'
            )}
        >
            <div className="flex items-start gap-2">
                <StatusIcon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', sc.color, isActive && 'animate-spin')} />
                <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-medium leading-snug truncate', selected && 'text-primary')}>{topic.title}</p>
                    {topic.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{topic.description}</p>
                    )}
                </div>
                {/* Action buttons */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {topic.status === 'completed' && (
                        <button
                            onClick={e => { e.stopPropagation(); onRequeue(); }}
                            title="Re-research"
                            className="p-1 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                        >
                            <RefreshCw className="h-3 w-3" />
                        </button>
                    )}
                    <button
                        onClick={e => { e.stopPropagation(); onDelete(); }}
                        title="Delete"
                        className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 cursor-pointer transition-colors"
                    >
                        <Trash2 className="h-3 w-3" />
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', dl.color)}>{dl.label}</span>
                {topic.ongoing ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1">
                        <Repeat2 className="h-2.5 w-2.5" />
                        {topic.revisit_interval ? REVISIT_LABELS[topic.revisit_interval] : 'Ongoing'}
                    </span>
                ) : null}
                {topic.session_count > 0 && (
                    <span className="text-[10px] text-muted-foreground/60">
                        {topic.session_count} session{topic.session_count !== 1 ? 's' : ''}
                    </span>
                )}
                {topic.last_researched_at && (
                    <span className="text-[10px] text-muted-foreground/60 ml-auto">
                        {fmtRelative(topic.last_researched_at)}
                    </span>
                )}
            </div>

            {isActive && topic.status === 'in_progress' && (
                <div className="h-0.5 bg-border/50 rounded-full overflow-hidden mt-0.5">
                    <div className="h-full bg-blue-400/60 rounded-full animate-pulse w-3/5" />
                </div>
            )}
        </div>
    );
}

// ── Topic Detail Panel ────────────────────────────────────────────────────────

function TopicDetailPanel({ topic, onClose, onRequeue, onUpdate, onDelete }: {
    topic: ResearchTopic;
    onClose: () => void;
    onRequeue: (id: number) => void;
    onUpdate: (id: number, patch: Partial<ResearchTopic>) => void;
    onDelete: (id: number) => void;
}) {
    const [tab, setTab] = useState<'report' | 'sessions' | 'settings'>('report');
    const [sessions, setSessions] = useState<Session[]>([]);
    const [selectedSession, setSelectedSession] = useState<Session | null>(null);
    const [sessionLoading, setSessionLoading] = useState(false);

    const loadSessions = () => {
        fetch(`/app/api/research/topics/${topic.id}/sessions`)
            .then(r => r.json())
            .then(setSessions)
            .catch(() => {});
    };

    const isActive = topic.status === 'queued' || topic.status === 'in_progress';

    useEffect(() => {
        loadSessions();
        // Poll fast while active so current_step updates feel live
        const id = setInterval(loadSessions, isActive ? 3_000 : 15_000);
        return () => clearInterval(id);
    }, [topic.id, isActive]);

    // Load the latest completed session's full data by default
    useEffect(() => {
        const latest = sessions.find(s => s.status === 'completed' && s.report_id);
        if (latest && (!selectedSession || selectedSession.topic_id !== topic.id)) {
            loadSessionDetail(latest.id);
        }
    }, [sessions]);

    const loadSessionDetail = (id: number) => {
        setSessionLoading(true);
        fetch(`/app/api/research/sessions/${id}`)
            .then(r => r.json())
            .then(s => { setSelectedSession(s); setSessionLoading(false); })
            .catch(() => setSessionLoading(false));
    };

    // Live current_step from the most recent active session
    const liveStep = isActive ? (sessions[0]?.current_step ?? null) : null;

    return (
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            {/* Panel header */}
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-border/50 shrink-0">
                <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold leading-snug">{topic.title}</h2>
                    {topic.description && (
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed line-clamp-2">{topic.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', DETAIL_LABELS[topic.detail_level].color)}>
                            {DETAIL_LABELS[topic.detail_level].label}
                        </span>
                        {topic.ongoing && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1">
                                <Repeat2 className="h-2.5 w-2.5" />
                                {topic.revisit_interval ? REVISIT_LABELS[topic.revisit_interval] : 'Ongoing'}
                            </span>
                        )}
                        {topic.next_revisit_at && (
                            <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                Next: {fmt(topic.next_revisit_at)}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {!isActive && (
                        <Button size="sm" variant="outline" className="cursor-pointer gap-1.5 h-8" onClick={() => onRequeue(topic.id)}>
                            <RefreshCw className="h-3.5 w-3.5" /> Re-research
                        </Button>
                    )}
                    {isActive && (
                        <div className="flex items-center gap-1.5 text-xs text-blue-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {liveStep ?? (topic.status === 'queued' ? 'Starting shortly…' : 'Researching…')}
                        </div>
                    )}
                    <Button size="icon" variant="ghost" onClick={onClose} className="h-8 w-8 cursor-pointer">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-0 border-b border-border/50 px-6 shrink-0">
                {(['report', 'sessions', 'settings'] as const).map(t => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={cn(
                            'cursor-pointer px-3 py-2.5 text-sm capitalize border-b-2 transition-colors',
                            tab === t
                                ? 'border-primary text-foreground font-medium'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        )}
                    >
                        {t}
                        {t === 'sessions' && sessions.length > 0 && (
                            <span className="ml-1.5 text-[10px] bg-muted text-muted-foreground px-1 py-0.5 rounded-full">
                                {sessions.length}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
                {tab === 'report' && (
                    <ReportTab
                        topic={topic}
                        sessions={sessions}
                        selectedSession={selectedSession}
                        loading={sessionLoading}
                        onSelectSession={loadSessionDetail}
                    />
                )}
                {tab === 'sessions' && (
                    <SessionsTab
                        sessions={sessions}
                        selectedSessionId={selectedSession?.id ?? null}
                        onSelect={id => { loadSessionDetail(id); setTab('report'); }}
                    />
                )}
                {tab === 'settings' && (
                    <SettingsTab topic={topic} onUpdate={onUpdate} onDelete={onDelete} onClose={onClose} />
                )}
            </div>
        </div>
    );
}

// ── Report Tab ────────────────────────────────────────────────────────────────

function ReportTab({ topic, sessions, selectedSession, loading, onSelectSession }: {
    topic: ResearchTopic;
    sessions: Session[];
    selectedSession: Session | null;
    loading: boolean;
    onSelectSession: (id: number) => void;
}) {
    // ── All hooks must come before any early returns ──────────────────────────
    const report = selectedSession?.report ?? null;
    const reportRef = useRef<HTMLDivElement>(null);

    const headings = useMemo(() => {
        if (!report) return [];
        const lines = report.content.split('\n');
        const result: { level: number; text: string; id: string }[] = [];
        const counts: Record<string, number> = {};
        for (const line of lines) {
            const m = line.match(/^(#{1,4})\s+(.+)$/);
            if (!m) continue;
            const level = m[1].length;
            const text = m[2].trim();
            const base = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-');
            counts[base] = (counts[base] ?? 0) + 1;
            const id = counts[base] > 1 ? `${base}-${counts[base] - 1}` : base;
            result.push({ level, text, id });
        }
        return result;
    }, [report?.content]);

    const mdHeadings = useMemo(() => {
        const slugCounts: Record<string, number> = {};
        const makeH = (level: number) => ({ children, ...props }: any) => {
            const text = String(children);
            const base = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-');
            slugCounts[base] = (slugCounts[base] ?? 0) + 1;
            const id = slugCounts[base] > 1 ? `${base}-${slugCounts[base] - 1}` : base;
            const Tag = `h${level}` as keyof JSX.IntrinsicElements;
            return <Tag id={id} {...props}>{children}</Tag>;
        };
        return { h1: makeH(1), h2: makeH(2), h3: makeH(3), h4: makeH(4) };
    }, [report?.content]);

    const [shareToken, setShareToken] = useState<string | null>(null);
    const [shareLoading, setShareLoading] = useState(false);
    const [showShareDialog, setShowShareDialog] = useState(false);

    useEffect(() => {
        if (report?.share_token) setShareToken(report.share_token);
    }, [report?.id]);

    // ── Derived values (safe after hooks) ─────────────────────────────────────
    const completedSessions = sessions.filter(s => s.status === 'completed' && s.report_id);
    const isActive = topic.status === 'queued' || topic.status === 'in_progress';

    // ── Early returns (after all hooks) ───────────────────────────────────────
    if (isActive && sessions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
                <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
                <p className="text-sm text-muted-foreground">Research is starting — this usually takes a couple of minutes.</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!report) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
                <BookOpen className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                    {completedSessions.length === 0
                        ? 'No report yet — research is in progress.'
                        : 'Select a session to view its report.'}
                </p>
            </div>
        );
    }

    const session = selectedSession!;

    const handleShare = () => {
        if (shareToken) { setShowShareDialog(true); return; }
        setShareLoading(true);
        fetch(`/app/api/research/reports/${report.id}/share`, { method: 'POST' })
            .then(r => r.json())
            .then(d => { setShareToken(d.token); setShowShareDialog(true); })
            .finally(() => setShareLoading(false));
    };

    const handleRevokeShare = () => {
        fetch(`/app/api/research/reports/${report.id}/share`, { method: 'DELETE' })
            .then(() => { setShareToken(null); setShowShareDialog(false); });
    };

    const shareUrl = shareToken ? `${window.location.origin}/share/${shareToken}` : null;

    const downloadMd = () => {
        const blob = new Blob([report.content], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${topic.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-research.md`;
        a.click();
    };

    const downloadPdf = () => {
        const sourceLinks = session.findings
            ?.filter((f, i, arr) => f.source_url && arr.findIndex(x => x.source_url === f.source_url) === i)
            .map((f, i) => `<div class="source"><span class="src-num">${i + 1}.</span><a href="${f.source_url}">${f.source_title || f.source_url}</a></div>`)
            .join('') ?? '';

        const bodyHtml = reportRef.current?.innerHTML ?? '';

        const printWindow = window.open('', '_blank', 'width=900,height=700');
        if (!printWindow) return;
        printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${topic.title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 16px; line-height: 1.75;
         color: #1a1a1a; background: #fff; max-width: 720px; margin: 48px auto; padding: 0 32px; }
  h1 { font-size: 26px; font-weight: 700; margin-bottom: 18px; line-height: 1.3; }
  h2 { font-size: 19px; font-weight: 600; margin-top: 36px; margin-bottom: 12px; line-height: 1.35;
       padding-bottom: 6px; border-bottom: 1px solid #e5e5e5; }
  h3 { font-size: 16px; font-weight: 600; margin-top: 24px; margin-bottom: 8px; }
  h4 { font-size: 14px; font-weight: 600; margin-top: 16px; margin-bottom: 6px; }
  p  { margin-bottom: 14px; }
  ul, ol { margin-bottom: 14px; padding-left: 24px; }
  li { margin-bottom: 6px; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  a  { color: #2563eb; text-decoration: underline; }
  code { font-family: 'Courier New', monospace; font-size: 13px;
         background: #f3f4f6; padding: 2px 5px; border-radius: 3px; }
  pre { background: #f3f4f6; border-radius: 6px; padding: 14px; overflow: auto;
        margin-bottom: 16px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #d1d5db; padding-left: 16px;
               color: #6b7280; font-style: italic; margin: 14px 0; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 24px 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px; }
  th { text-align: left; font-weight: 600; padding: 8px 12px; border-bottom: 2px solid #e5e5e5; }
  td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
  .sources-section { margin-top: 40px; padding-top: 24px; border-top: 2px solid #e5e5e5; }
  .sources-label { font-size: 11px; font-weight: 700; text-transform: uppercase;
                   letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 10px; }
  .source { display: flex; gap: 8px; font-size: 13px; color: #6b7280; margin-bottom: 5px; }
  .src-num { color: #d1d5db; min-width: 20px; }
  .source a { color: #6b7280; word-break: break-all; }
  @media print {
    body { margin: 0; padding: 24px 32px; max-width: 100%; }
    a { color: #1a1a1a; text-decoration: none; }
    .source a { color: #6b7280; }
  }
</style>
</head>
<body>
${bodyHtml}
${sourceLinks ? `<div class="sources-section"><div class="sources-label">Sources</div>${sourceLinks}</div>` : ''}
<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`);
        printWindow.document.close();
    };

    return (
        <div className="flex gap-8 px-8 py-6">
        <div className="flex-1 min-w-0 max-w-3xl">
            {/* Session selector (if multiple) */}
            {completedSessions.length > 1 && (
                <div className="flex items-center gap-2 mb-4">
                    <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Version:</span>
                    <div className="flex gap-1 flex-wrap">
                        {completedSessions.map((s, i) => (
                            <button
                                key={s.id}
                                onClick={() => onSelectSession(s.id)}
                                className={cn(
                                    'cursor-pointer text-[10px] px-2 py-0.5 rounded border transition-all',
                                    s.id === session.id
                                        ? 'bg-foreground/10 border-foreground/30 text-foreground'
                                        : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'
                                )}
                            >
                                {i === 0 ? 'Latest' : fmt(s.completed_at)}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Report meta */}
            <div className="flex items-center justify-between mb-5 gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    {session.completed_at && <span>Researched {fmt(session.completed_at)}</span>}
                    {session.findings && session.findings.length > 0 && (
                        <span>· {session.findings.length} finding{session.findings.length !== 1 ? 's' : ''}</span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={downloadMd}
                        className="cursor-pointer flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <Download className="h-3.5 w-3.5" /> .md
                    </button>
                    <button
                        onClick={downloadPdf}
                        className="cursor-pointer flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <Download className="h-3.5 w-3.5" /> .pdf
                    </button>
                    <button
                        onClick={handleShare}
                        disabled={shareLoading}
                        className={cn(
                            'cursor-pointer flex items-center gap-1.5 text-xs transition-colors',
                            shareToken ? 'text-emerald-400 hover:text-emerald-300' : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <Share2 className="h-3.5 w-3.5" />
                        {shareToken ? 'Shared' : 'Share'}
                    </button>
                </div>
            </div>

            <Separator className="mb-8" />

            {/* Rendered report */}
            <div ref={reportRef} className={cn(
                'prose prose-invert max-w-none',
                // Headings
                '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-0 [&_h1]:leading-tight',
                '[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:leading-snug',
                '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2',
                '[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-4 [&_h4]:mb-1.5',
                // Body
                '[&_p]:text-[15px] [&_p]:leading-[1.75] [&_p]:mb-4 [&_p]:text-foreground/90',
                // Lists
                '[&_ul]:text-[15px] [&_ul]:leading-[1.75] [&_ul]:mb-4 [&_ul]:pl-6',
                '[&_ol]:text-[15px] [&_ol]:leading-[1.75] [&_ol]:mb-4 [&_ol]:pl-6',
                '[&_li]:mb-2 [&_li]:text-foreground/90',
                // Inline
                '[&_strong]:font-semibold [&_strong]:text-foreground',
                '[&_em]:italic [&_em]:text-foreground/80',
                '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-primary/80',
                '[&_code]:text-[13px] [&_code]:bg-muted [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono',
                '[&_pre]:bg-muted [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:mb-4',
                // Blockquote
                '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic [&_blockquote]:my-4',
                // HR
                '[&_hr]:border-border/40 [&_hr]:my-6',
                // Tables
                '[&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_table]:mb-4',
                '[&_th]:text-left [&_th]:font-semibold [&_th]:py-2 [&_th]:px-3 [&_th]:border-b [&_th]:border-border',
                '[&_td]:py-2 [&_td]:px-3 [&_td]:border-b [&_td]:border-border/40',
            )}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdHeadings as any}>
                    {report.content}
                </ReactMarkdown>
            </div>

            {/* Sources */}
            {session.findings && session.findings.filter(f => f.source_url).length > 0 && (
                <div className="mt-8 pt-6 border-t border-border/40">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Sources</p>
                    <div className="space-y-1.5">
                        {session.findings
                            .filter((f, i, arr) => f.source_url && arr.findIndex(x => x.source_url === f.source_url) === i)
                            .map((f, i) => (
                                <a
                                    key={f.id}
                                    href={f.source_url!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-start gap-2 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer group"
                                >
                                    <span className="shrink-0 text-muted-foreground/40 group-hover:text-primary/50 mt-0.5">{i + 1}.</span>
                                    <span className="line-clamp-1">{f.source_title || f.source_url}</span>
                                </a>
                            ))}
                    </div>
                </div>
            )}
        </div>{/* end flex-1 */}

        {/* ToC sidebar */}
        {headings.filter(h => h.level <= 3).length >= 3 && (
            <nav className="hidden 2xl:block w-48 shrink-0">
                <div className="sticky top-6">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">On this page</p>
                    <ul className="space-y-1">
                        {headings.filter(h => h.level <= 3).map(h => (
                            <li key={h.id}>
                                <a
                                    href={`#${h.id}`}
                                    onClick={e => {
                                        e.preventDefault();
                                        document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }}
                                    className={cn(
                                        'block text-[11px] leading-relaxed cursor-pointer transition-colors text-muted-foreground hover:text-foreground',
                                        h.level === 1 ? 'pl-0 font-medium' : h.level === 2 ? 'pl-2' : 'pl-4 text-[10px]'
                                    )}
                                >
                                    {h.text}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            </nav>
        )}

        {/* Share dialog */}
        {showShareDialog && shareUrl && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowShareDialog(false)}>
                <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold">Share report</h3>
                        <button onClick={() => setShowShareDialog(false)} className="cursor-pointer text-muted-foreground hover:text-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">Anyone with this link can view the report without logging in.</p>
                    <div className="flex gap-2">
                        <input
                            readOnly
                            value={shareUrl}
                            className="flex-1 bg-muted rounded px-3 py-2 text-xs font-mono text-foreground border border-border"
                        />
                        <button
                            onClick={() => { navigator.clipboard.writeText(shareUrl); }}
                            className="cursor-pointer px-3 py-2 bg-primary text-primary-foreground text-xs rounded hover:bg-primary/90 transition-colors flex items-center gap-1.5"
                        >
                            <Link className="h-3.5 w-3.5" /> Copy
                        </button>
                    </div>
                    <button
                        onClick={handleRevokeShare}
                        className="cursor-pointer mt-4 text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                        Revoke access
                    </button>
                </div>
            </div>
        )}
        </div>
    );
}

// ── Sessions Tab ──────────────────────────────────────────────────────────────

function SessionsTab({ sessions, selectedSessionId, onSelect }: {
    sessions: Session[];
    selectedSessionId: number | null;
    onSelect: (id: number) => void;
}) {
    if (sessions.length === 0) {
        return (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                No sessions yet.
            </div>
        );
    }

    return (
        <div className="p-4 space-y-2">
            {sessions.map((s, i) => {
                const sc = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.idle;
                const StatusIcon = sc.icon;
                return (
                    <button
                        key={s.id}
                        onClick={() => s.status === 'completed' && s.report_id ? onSelect(s.id) : undefined}
                        className={cn(
                            'w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all',
                            s.id === selectedSessionId
                                ? 'bg-sidebar-accent border-primary/40'
                                : s.status === 'completed' && s.report_id
                                    ? 'bg-card border-border hover:border-primary/30 hover:bg-card/80 cursor-pointer'
                                    : 'bg-card/50 border-border/50 cursor-default'
                        )}
                    >
                        <StatusIcon className={cn('h-4 w-4 mt-0.5 shrink-0', sc.color,
                            (s.status === 'queued' || s.status === 'in_progress' || s.status === 'searching' || s.status === 'synthesizing') && 'animate-spin'
                        )} />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium">
                                    {i === 0 ? 'Latest' : `Run #${sessions.length - i}`}
                                    {i === 0 && sessions.length > 1 && <span className="text-xs text-muted-foreground ml-1">(current)</span>}
                                </span>
                                <span className={cn('text-xs', sc.color)}>{sc.label}</span>
                            </div>
                            {s.current_step && (
                                <p className="text-xs text-muted-foreground mt-0.5">{s.current_step}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
                                {s.completed_at ? (
                                    <span>{fmt(s.completed_at)}</span>
                                ) : s.started_at ? (
                                    <span>Started {fmtRelative(s.started_at)}</span>
                                ) : (
                                    <span>Created {fmtRelative(s.created_at)}</span>
                                )}
                                {(s.findings_count ?? 0) > 0 && (
                                    <span>· {s.findings_count} findings</span>
                                )}
                                {s.report_id && <span>· has report</span>}
                            </div>
                            {s.error && (
                                <p className="text-xs text-red-400 mt-1">{s.error}</p>
                            )}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab({ topic, onUpdate, onDelete, onClose }: {
    topic: ResearchTopic;
    onUpdate: (id: number, patch: Partial<ResearchTopic>) => void;
    onDelete: (id: number) => void;
    onClose: () => void;
}) {
    const [title, setTitle] = useState(topic.title);
    const [description, setDescription] = useState(topic.description ?? '');
    const [detailLevel, setDetailLevel] = useState<DetailLevel>(topic.detail_level);
    const [ongoing, setOngoing] = useState(topic.ongoing === 1);
    const [interval, setInterval] = useState<RevisitInterval>(topic.revisit_interval ?? 'weekly');
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const save = async () => {
        setSaving(true);
        await onUpdate(topic.id, {
            title,
            description: description || null,
            detail_level: detailLevel,
            ongoing: ongoing ? 1 : 0,
            revisit_interval: ongoing ? interval : null,
        } as any);
        setSaving(false);
    };

    return (
        <div className="p-6 space-y-5 max-w-lg">
            <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} />
            </div>

            <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="What should be researched? Add context, angles, specific questions…"
                    rows={3}
                />
            </div>

            <div className="space-y-1.5">
                <Label>Research depth</Label>
                <div className="grid grid-cols-3 gap-2">
                    {(Object.entries(DETAIL_LABELS) as [DetailLevel, typeof DETAIL_LABELS[DetailLevel]][]).map(([key, meta]) => (
                        <button
                            key={key}
                            onClick={() => setDetailLevel(key)}
                            className={cn(
                                'cursor-pointer flex flex-col gap-1 p-2.5 rounded-lg border text-left transition-all',
                                detailLevel === key
                                    ? 'border-primary/60 bg-primary/5'
                                    : 'border-border hover:border-primary/30'
                            )}
                        >
                            <span className={cn('text-xs font-semibold', meta.color.split(' ')[1])}>{meta.label}</span>
                            <span className="text-[10px] text-muted-foreground leading-relaxed">{meta.desc}</span>
                        </button>
                    ))}
                </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
                <div>
                    <Label>Keep research ongoing</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Sebastian will periodically revisit and update this topic.
                    </p>
                </div>
                <Switch checked={ongoing} onCheckedChange={setOngoing} className="cursor-pointer" />
            </div>

            {ongoing && (
                <div className="space-y-1.5">
                    <Label>Revisit every</Label>
                    <Select value={interval} onValueChange={v => setInterval(v as RevisitInterval)}>
                        <SelectTrigger className="cursor-pointer">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(Object.entries(REVISIT_LABELS) as [RevisitInterval, string][]).map(([key, label]) => (
                                <SelectItem key={key} value={key} className="cursor-pointer">{label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            <div className="flex items-center justify-between pt-2">
                <Button onClick={save} disabled={saving || !title.trim()} className="cursor-pointer">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                    Save changes
                </Button>

                {!confirmDelete ? (
                    <button
                        onClick={() => setConfirmDelete(true)}
                        className="cursor-pointer text-xs text-muted-foreground hover:text-red-400 transition-colors"
                    >
                        Delete topic
                    </button>
                ) : (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Sure?</span>
                        <button
                            onClick={() => { onDelete(topic.id); onClose(); }}
                            className="cursor-pointer text-xs text-red-400 hover:text-red-300 font-medium transition-colors"
                        >
                            Yes, delete
                        </button>
                        <button
                            onClick={() => setConfirmDelete(false)}
                            className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── New Topic Modal ───────────────────────────────────────────────────────────

function NewTopicModal({ open, onClose, onCreate }: {
    open: boolean;
    onClose: () => void;
    onCreate: (data: {
        title: string;
        description: string;
        detail_level: DetailLevel;
        ongoing: boolean;
        revisit_interval: RevisitInterval | null;
    }) => Promise<void>;
}) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [detailLevel, setDetailLevel] = useState<DetailLevel>('standard');
    const [ongoing, setOngoing] = useState(false);
    const [interval, setRevisitInterval] = useState<RevisitInterval>('weekly');
    const [saving, setSaving] = useState(false);
    const titleRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setTitle(''); setDescription(''); setDetailLevel('standard');
            setOngoing(false); setRevisitInterval('weekly');
            setTimeout(() => titleRef.current?.focus(), 50);
        }
    }, [open]);

    const submit = async () => {
        if (!title.trim()) return;
        setSaving(true);
        await onCreate({ title: title.trim(), description, detail_level: detailLevel, ongoing, revisit_interval: ongoing ? interval : null });
        setSaving(false);
    };

    return (
        <Dialog open={open} onOpenChange={v => !v && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>New Research Topic</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-1">
                    <div className="space-y-1.5">
                        <Label>Topic</Label>
                        <Input
                            ref={titleRef}
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="e.g. Rust vs Go for backend services"
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit()}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Add context, specific questions, angles to cover…"
                            rows={3}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Research depth</Label>
                        <div className="grid grid-cols-3 gap-2">
                            {(Object.entries(DETAIL_LABELS) as [DetailLevel, typeof DETAIL_LABELS[DetailLevel]][]).map(([key, meta]) => (
                                <button
                                    key={key}
                                    onClick={() => setDetailLevel(key)}
                                    className={cn(
                                        'cursor-pointer flex flex-col gap-0.5 p-2.5 rounded-lg border text-left transition-all',
                                        detailLevel === key
                                            ? 'border-primary/60 bg-primary/5'
                                            : 'border-border hover:border-primary/30'
                                    )}
                                >
                                    <span className={cn('text-xs font-semibold', meta.color.split(' ')[1])}>{meta.label}</span>
                                    <span className="text-[10px] text-muted-foreground">{meta.desc}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">Keep research ongoing</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Revisit and refresh on a schedule.</p>
                        </div>
                        <Switch checked={ongoing} onCheckedChange={setOngoing} className="cursor-pointer" />
                    </div>
                    {ongoing && (
                        <div className="space-y-1.5">
                            <Label>Revisit every</Label>
                            <Select value={interval} onValueChange={v => setRevisitInterval(v as RevisitInterval)}>
                                <SelectTrigger className="cursor-pointer">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {(Object.entries(REVISIT_LABELS) as [RevisitInterval, string][]).map(([key, label]) => (
                                        <SelectItem key={key} value={key} className="cursor-pointer">{label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                        <Button variant="outline" onClick={onClose} className="cursor-pointer">Cancel</Button>
                        <Button onClick={submit} disabled={saving || !title.trim()} className="cursor-pointer">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                            Start Research
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
