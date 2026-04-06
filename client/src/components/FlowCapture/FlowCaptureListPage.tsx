import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
    ArrowRight,
    GitBranch,
    Layers,
    Loader2,
    Plus,
    Trash2,
} from 'lucide-react';
import { AppLayout } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { APPS } from '@/lib/appRegistry';
import { useAppTracking } from '@/components/Analytics/AnalyticsProvider';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Session {
    id: number;
    name: string;
    chunk_count: number;
    created_at: string;
    updated_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    return `${mo}mo ago`;
}

// ── Component ──────────────────────────────────────────────────────────────────

const app = APPS.find((a) => a.id === 'flow-capture')!;

export default function FlowCaptureListPage() {
    const navigate = useNavigate();
    const { trackPageView, trackAction } = useAppTracking('flow-capture');

    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<number | null>(null);

    useEffect(() => { trackPageView(); }, [trackPageView]);

    const loadSessions = useCallback(async () => {
        try {
            const res = await fetch('/app/api/flow-capture/sessions', { credentials: 'include' });
            if (res.ok) setSessions(await res.json());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadSessions(); }, [loadSessions]);

    const createSession = useCallback(async () => {
        setCreating(true);
        try {
            const name = `Session ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            const res = await fetch('/app/api/flow-capture/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name }),
            });
            if (!res.ok) return;
            const session: Session = await res.json();
            trackAction('flow_created', { sessionId: session.id });
            navigate(`/flow-capture/${session.id}`);
        } finally {
            setCreating(false);
        }
    }, [navigate]);

    const deleteSession = useCallback(async (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        setDeletingId(id);
        try {
            await fetch(`/app/api/flow-capture/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
            setSessions((prev) => prev.filter((s) => s.id !== id));
        } finally {
            setDeletingId(null);
        }
    }, []);

    return (
        <AppLayout
            icon={<app.icon size={20} />}
            iconClassName={app.color}
            title="Flow Capture"
            subtitle="Speak or write your flow — AI renders it as a live diagram"
            actions={
                <Button onClick={createSession} disabled={creating} className="gap-2 cursor-pointer">
                    {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                    New Session
                </Button>
            }
        >
            <div className="h-full overflow-y-auto">
                <div className="max-w-2xl mx-auto px-6 py-8">

                    {/* Loading */}
                    {loading && (
                        <div className="flex items-center justify-center py-20 text-muted-foreground">
                            <Loader2 size={20} className="animate-spin" />
                        </div>
                    )}

                    {/* Empty state */}
                    {!loading && sessions.length === 0 && (
                        <div className="flex flex-col items-center justify-center gap-5 py-20 text-center">
                            <div className={`p-5 rounded-2xl ${app.color}`}>
                                <GitBranch size={36} />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-foreground">No sessions yet</h2>
                                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                                    Start a session to capture a conversation and watch it become a diagram in real time.
                                </p>
                            </div>
                            <Button onClick={createSession} disabled={creating} size="lg" className="gap-2 cursor-pointer">
                                {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                Start your first session
                            </Button>
                        </div>
                    )}

                    {/* Session list */}
                    {!loading && sessions.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
                                {sessions.length} session{sessions.length !== 1 ? 's' : ''}
                            </p>
                            {sessions.map((session) => (
                                <div
                                    key={session.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => navigate(`/flow-capture/${session.id}`)}
                                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/flow-capture/${session.id}`)}
                                    className="w-full group flex items-center gap-4 rounded-xl border bg-card hover:bg-accent/50 px-5 py-4 text-left transition-colors cursor-pointer"
                                >
                                    {/* Icon */}
                                    <div className={`p-2.5 rounded-lg shrink-0 ${app.color}`}>
                                        <Layers size={16} />
                                    </div>

                                    {/* Name + meta */}
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm text-foreground truncate">
                                            {session.name}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 tabular-nums">
                                                {session.chunk_count} segment{session.chunk_count !== 1 ? 's' : ''}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {timeAgo(session.updated_at)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={(e) => deleteSession(e, session.id)}
                                            disabled={deletingId === session.id}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                                            title="Delete session"
                                        >
                                            {deletingId === session.id
                                                ? <Loader2 size={13} className="animate-spin" />
                                                : <Trash2 size={13} />
                                            }
                                        </button>
                                        <ArrowRight
                                            size={15}
                                            className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
