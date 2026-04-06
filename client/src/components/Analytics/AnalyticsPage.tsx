import { useEffect, useState } from 'react';
import { BarChart2, Activity, Users, Zap } from 'lucide-react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    LineChart,
    Line,
    Cell,
} from 'recharts';
import { AppLayout } from '@/components/ui/app-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { APPS } from '@/lib/appRegistry';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewData {
    totalEvents: number;
    uniqueSessions: number;
    today: number;
    last7d: number;
    byApp: { app: string; count: number }[];
    byDay: { day: string; count: number }[];
    topEvents: { app: string; event: string; count: number }[];
}

interface FeedEvent {
    id: number;
    app: string;
    event: string;
    page: string | null;
    session_id: string | null;
    created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const APP_COLORS = [
    '#6366f1', '#ec4899', '#f97316', '#06b6d4', '#10b981',
    '#8b5cf6', '#f59e0b', '#14b8a6', '#3b82f6', '#ef4444',
];

function appLabel(id: string) {
    return APPS.find(a => a.id === id)?.name ?? id;
}

function fmtDay(iso: string) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub }: {
    icon: React.ElementType;
    label: string;
    value: number | string;
    sub?: string;
}) {
    return (
        <Card>
            <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className="text-2xl font-bold mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</p>
                        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                        <Icon size={18} />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: OverviewData }) {
    const chartData = data.byDay.map(d => ({ ...d, day: fmtDay(d.day) }));
    const appData = data.byApp.map((d, i) => ({
        app: appLabel(d.app),
        count: d.count,
        color: APP_COLORS[i % APP_COLORS.length],
    }));

    return (
        <div className="space-y-6">
            {/* Stats row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Zap} label="Total Events" value={data.totalEvents} />
                <StatCard icon={Users} label="Sessions" value={data.uniqueSessions} />
                <StatCard icon={Activity} label="Today" value={data.today} />
                <StatCard icon={BarChart2} label="Last 7 Days" value={data.last7d} />
            </div>

            {/* Events over time */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm font-medium">Events Over Time (14 days)</CardTitle>
                </CardHeader>
                <CardContent>
                    {chartData.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">No data yet — start using apps to see activity.</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                <XAxis dataKey="day" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                                <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" allowDecimals={false} />
                                <Tooltip
                                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                                    labelStyle={{ fontWeight: 600 }}
                                />
                                <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>

            {/* Events by app */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium">Events by App</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {appData.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">No events recorded yet.</p>
                        ) : (
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={appData} layout="vertical" margin={{ left: 8 }}>
                                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                                    <YAxis type="category" dataKey="app" tick={{ fontSize: 11 }} width={90} />
                                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                                        {appData.map((entry, i) => (
                                            <Cell key={i} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Top events table */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium">Top Events</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {data.topEvents.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">No events recorded yet.</p>
                        ) : (
                            <div className="space-y-2">
                                {data.topEvents.slice(0, 8).map((e, i) => (
                                    <div key={i} className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <Badge variant="outline" className="text-xs shrink-0">{appLabel(e.app)}</Badge>
                                            <span className="text-muted-foreground truncate">{e.event}</span>
                                        </div>
                                        <span className="font-medium tabular-nums ml-2">{e.count.toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

// ── Per-App Tab ───────────────────────────────────────────────────────────────

function AppTab() {
    const [selectedApp, setSelectedApp] = useState('appideas');
    const [days, setDays] = useState('7');
    const [data, setData] = useState<{
        total: number;
        eventBreakdown: { event: string; count: number }[];
        byDay: { day: string; count: number }[];
    } | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setLoading(true);
        fetch(`/app/api/analytics/apps/${selectedApp}?days=${days}`, { credentials: 'include' })
            .then(r => r.json())
            .then(setData)
            .finally(() => setLoading(false));
    }, [selectedApp, days]);

    const chartData = data?.byDay.map(d => ({ ...d, day: fmtDay(d.day) })) ?? [];

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <Select value={selectedApp} onValueChange={setSelectedApp}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select app" />
                    </SelectTrigger>
                    <SelectContent>
                        {APPS.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={days} onValueChange={setDays}>
                    <SelectTrigger className="w-[120px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="7">Last 7 days</SelectItem>
                        <SelectItem value="14">Last 14 days</SelectItem>
                        <SelectItem value="30">Last 30 days</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {loading ? (
                <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
            ) : data ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <Card>
                            <CardContent className="pt-6">
                                <p className="text-sm text-muted-foreground">Total Events</p>
                                <p className="text-2xl font-bold mt-1">{data.total.toLocaleString()}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">in {days} days</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6">
                                <p className="text-sm text-muted-foreground">Distinct Event Types</p>
                                <p className="text-2xl font-bold mt-1">{data.eventBreakdown.length}</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6">
                                <p className="text-sm text-muted-foreground">Top Event</p>
                                <p className="text-2xl font-bold mt-1 truncate">
                                    {data.eventBreakdown[0]?.event ?? '—'}
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader><CardTitle className="text-sm font-medium">Daily Events</CardTitle></CardHeader>
                        <CardContent>
                            {chartData.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-8">No events for this app yet.</p>
                            ) : (
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                        <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle className="text-sm font-medium">Event Breakdown</CardTitle></CardHeader>
                        <CardContent>
                            {data.eventBreakdown.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-8">No events yet.</p>
                            ) : (
                                <div className="space-y-2">
                                    {data.eventBreakdown.map((e, i) => (
                                        <div key={i} className="flex items-center justify-between text-sm">
                                            <span className="text-muted-foreground">{e.event}</span>
                                            <span className="font-medium tabular-nums">{e.count.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            ) : null}
        </div>
    );
}

// ── Live Feed Tab ─────────────────────────────────────────────────────────────

function FeedTab() {
    const [events, setEvents] = useState<FeedEvent[]>([]);
    const [live, setLive] = useState(true);

    useEffect(() => {
        function poll() {
            const latest = events[0]?.id;
            const url = latest
                ? `/app/api/analytics/feed?limit=50&after=${latest}`
                : '/app/api/analytics/feed?limit=50';
            fetch(url, { credentials: 'include' })
                .then(r => r.json())
                .then((rows: FeedEvent[]) => {
                    if (rows.length) setEvents(prev => [...rows, ...prev].slice(0, 200));
                })
                .catch(() => {});
        }

        poll();
        if (!live) return;
        const id = setInterval(poll, 3000);
        return () => clearInterval(id);
    }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{events.length} events loaded</p>
                <button
                    onClick={() => setLive(l => !l)}
                    className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors cursor-pointer ${
                        live
                            ? 'bg-green-500/10 text-green-600 border-green-500/20'
                            : 'bg-muted text-muted-foreground border-border'
                    }`}
                >
                    {live ? '● Live' : '○ Paused'}
                </button>
            </div>
            <Card>
                <CardContent className="pt-4 p-0">
                    {events.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-12">
                            No events yet. Open any app to generate some.
                        </p>
                    ) : (
                        <div className="divide-y">
                            {events.map(e => (
                                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors">
                                    <Badge variant="outline" className="text-xs shrink-0">{appLabel(e.app)}</Badge>
                                    <span className="font-medium">{e.event}</span>
                                    <span className="text-muted-foreground flex-1 truncate">{e.session_id?.slice(0, 12)}</span>
                                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">{timeAgo(e.created_at)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
    const [overview, setOverview] = useState<OverviewData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/app/api/analytics/overview', { credentials: 'include' })
            .then(r => r.json())
            .then(d => { if (d.byDay) setOverview(d); })
            .finally(() => setLoading(false));
    }, []);

    return (
        <AppLayout
            icon={<BarChart2 size={20} />}
            iconClassName="bg-indigo-500/10 text-indigo-500"
            title="Analytics"
            subtitle="Usage insights across all your apps"
        >
            <div className="flex-1 overflow-y-auto p-6">
                <Tabs defaultValue="overview">
                    <TabsList className="mb-6">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="apps">Per App</TabsTrigger>
                        <TabsTrigger value="feed">Live Feed</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview">
                        {loading ? (
                            <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
                        ) : overview ? (
                            <OverviewTab data={overview} />
                        ) : (
                            <p className="text-sm text-muted-foreground text-center py-12">Failed to load analytics.</p>
                        )}
                    </TabsContent>

                    <TabsContent value="apps">
                        <AppTab />
                    </TabsContent>

                    <TabsContent value="feed">
                        <FeedTab />
                    </TabsContent>
                </Tabs>
            </div>
        </AppLayout>
    );
}
