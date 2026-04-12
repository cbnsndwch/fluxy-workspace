import { useAppTracking } from "@/components/Analytics/AnalyticsProvider";
import {
  Archive,
  BookOpen,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  FlaskConical,
  GitMerge,
  Layers,
  Link,
  Loader2,
  Plus,
  RefreshCw,
  Repeat2,
  SearchIcon,
  Share2,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { JSX, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useLoaderData, useNavigate, useParams } from "react-router";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

import { AppLayout } from "@/components/ui/app-layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type DetailLevel = "brief" | "standard" | "deep";
type TopicStatus = "idle" | "queued" | "in_progress" | "completed" | "failed";
type RevisitInterval = "daily" | "weekly" | "twice_monthly" | "monthly" | "quarterly" | "yearly";

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
  // Delta / master-synthesis fields
  delta_count: number;
  master_report_session_id: number | null;
  master_report_id: number | null;
  prepared_for: string | null;
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
  report_type: "full" | "delta" | "master" | null;
  created_at: string;
}

interface Session {
  id: number;
  topic_id: number;
  status: string;
  session_type: "full" | "delta" | "no_update" | "master_synthesis" | null;
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

interface ReportSettings {
  company_name: string;
  tagline: string;
  copyright_holder: string; // kept in DB for backward compat, but UI uses company_name
  contact_email: string;
  website: string;
  logo_url: string;
  confidentiality_notice: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DETAIL_LABELS: Record<DetailLevel, { label: string; desc: string; color: string }> = {
  brief: {
    label: "Brief",
    desc: "Quick scan, concise overview",
    color: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  },
  standard: {
    label: "Standard",
    desc: "Thorough analysis, multiple angles",
    color: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  },
  deep: {
    label: "Deep",
    desc: "Maximum effort, exhaustive coverage",
    color: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  },
};

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }
> = {
  idle: { label: "Idle", icon: Circle, color: "text-muted-foreground" },
  queued: { label: "Queued", icon: Clock, color: "text-yellow-400" },
  in_progress: {
    label: "Researching",
    icon: Loader2,
    color: "text-blue-400",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    color: "text-emerald-400",
  },
  failed: { label: "Failed", icon: X, color: "text-red-400" },
  searching: { label: "Searching", icon: SearchIcon, color: "text-blue-400" },
  synthesizing: {
    label: "Synthesizing",
    icon: BookOpen,
    color: "text-violet-400",
  },
};

const REVISIT_LABELS: Record<RevisitInterval, string> = {
  daily: "Every day",
  weekly: "Every week",
  twice_monthly: "Twice a month",
  monthly: "Once a month",
  quarterly: "Once a quarter",
  yearly: "Once a year",
};

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader(): Promise<ResearchTopic[]> {
  const res = await fetch("/app/api/research/topics");
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(dateStr: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtRelative(dateStr: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "Z");
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
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
  const { trackPageView } = useAppTracking("deep-research");
  const navigate = useNavigate();
  const { topicId: topicIdParam } = useParams<{ topicId?: string }>();
  const selectedId = topicIdParam ? Number(topicIdParam) : null;
  const setSelectedId = (id: number | null) => {
    navigate(id ? `/deep-research/${id}` : "/deep-research", { replace: true });
  };
  useEffect(() => {
    trackPageView();
  }, [trackPageView]);
  const [topics, setTopics] = useState<ResearchTopic[]>(initialTopics);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [reportSettings, setReportSettings] = useState<ReportSettings | null>(null);
  const [showBrandingDialog, setShowBrandingDialog] = useState(false);

  // Load report settings (company branding)
  useEffect(() => {
    fetch("/app/api/report-settings")
      .then((r) => r.json())
      .then(setReportSettings)
      .catch(() => {});
  }, []);

  const loadTopics = () => {
    fetch("/app/api/research/topics")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setTopics(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  // Poll fast (4s) when something is active, slow (20s) otherwise
  const hasActive = topics.some((t) => t.status === "queued" || t.status === "in_progress");
  useEffect(() => {
    const id = setInterval(loadTopics, hasActive ? 4_000 : 20_000);
    return () => clearInterval(id);
  }, [hasActive]);

  const selectedTopic = topics.find((t) => t.id === selectedId) ?? null;

  const handleCreate = async (data: {
    title: string;
    description: string;
    detail_level: DetailLevel;
    ongoing: boolean;
    revisit_interval: RevisitInterval | null;
    prepared_for?: string;
  }) => {
    const r = await fetch("/app/api/research/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const topic = await r.json();
    setShowNew(false);
    loadTopics();
    navigate(`/deep-research/${topic.id}`, { replace: true });
  };

  const handleDelete = async (id: number) => {
    await fetch(`/app/api/research/topics/${id}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    loadTopics();
  };

  const handleRequeue = async (id: number) => {
    await fetch(`/app/api/research/topics/${id}/queue`, { method: "POST" });
    loadTopics();
  };

  const handleSynthesize = async (id: number) => {
    await fetch(`/app/api/research/topics/${id}/synthesize`, {
      method: "POST",
    });
    loadTopics();
  };

  const handleUpdate = async (id: number, patch: Partial<ResearchTopic>) => {
    await fetch(`/app/api/research/topics/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    loadTopics();
  };

  const ongoing = topics.filter((t) => t.ongoing);
  const oneOff = topics.filter((t) => !t.ongoing);

  const activeCount = topics.filter(
    (t) => t.status === "queued" || t.status === "in_progress",
  ).length;

  return (
    <AppLayout
      icon={<FlaskConical size={20} />}
      iconClassName="bg-violet-500/10 text-violet-500"
      title="Deep Research"
      subtitle={
        <>
          {topics.length} topic{topics.length !== 1 ? "s" : ""}
          {activeCount > 0 && <span className="text-violet-400"> · {activeCount} active</span>}
        </>
      }
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowBrandingDialog(true)}
            className="cursor-pointer gap-1.5"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Report Branding
          </Button>
          <Button size="sm" onClick={() => setShowNew(true)} className="cursor-pointer gap-1.5">
            <Plus className="h-4 w-4" /> New Topic
          </Button>
        </div>
      }
    >
      <div className="flex h-full overflow-hidden">
        {/* ── Topic List ────────────────────────────────────────────── */}
        <div
          className={cn(
            "flex flex-col border-r border-border/50 transition-all duration-300",
            selectedId ? "w-96 shrink-0" : "flex-1",
          )}
        >
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowNew(true)}
                  className="mt-1 cursor-pointer"
                >
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
            onSynthesize={handleSynthesize}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            reportSettings={reportSettings}
          />
        )}
      </div>

      {/* ── New Topic Modal ────────────────────────────────────────── */}
      <NewTopicModal open={showNew} onClose={() => setShowNew(false)} onCreate={handleCreate} />

      {/* ── Report Branding Settings ─────────────────────────────── */}
      <BrandingSettingsDialog
        open={showBrandingDialog}
        onClose={() => setShowBrandingDialog(false)}
        settings={reportSettings}
        onSave={(updated) => setReportSettings(updated)}
      />
    </AppLayout>
  );
}

// ── Topic Group ───────────────────────────────────────────────────────────────

function TopicGroup({
  label,
  icon,
  topics,
  selectedId,
  onSelect,
  onDelete,
  onRequeue,
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
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
      </div>
      <div className="space-y-1.5">
        {topics.map((t) => (
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

function TopicCard({
  topic,
  selected,
  onSelect,
  onDelete,
  onRequeue,
}: {
  topic: ResearchTopic;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRequeue: () => void;
}) {
  const sc = STATUS_CONFIG[topic.status] ?? STATUS_CONFIG.idle;
  const StatusIcon = sc.icon;
  const dl = DETAIL_LABELS[topic.detail_level];
  const isActive = topic.status === "queued" || topic.status === "in_progress";

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col gap-1.5 p-3 rounded-lg border cursor-pointer transition-all",
        selected
          ? "bg-sidebar-accent border-primary/40"
          : "bg-card border-border hover:border-primary/30 hover:bg-card/80",
      )}
    >
      <div className="flex items-start gap-2">
        <StatusIcon
          className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", sc.color, isActive && "animate-spin")}
        />
        <div className="flex-1 min-w-0">
          <p
            className={cn("text-sm font-medium leading-snug truncate", selected && "text-primary")}
          >
            {topic.title}
          </p>
          {topic.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
              {topic.description}
            </p>
          )}
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {topic.status === "completed" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRequeue();
              }}
              title="Re-research"
              className="p-1 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete"
            className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 cursor-pointer transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", dl.color)}>
          {dl.label}
        </span>
        {topic.ongoing ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1">
            <Repeat2 className="h-2.5 w-2.5" />
            {topic.revisit_interval ? REVISIT_LABELS[topic.revisit_interval] : "Ongoing"}
          </span>
        ) : null}
        {(topic.delta_count ?? 0) > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/20 flex items-center gap-1">
            <Layers className="h-2.5 w-2.5" />
            {topic.delta_count} delta
            {topic.delta_count !== 1 ? "s" : ""}
          </span>
        )}
        {topic.session_count > 0 && (
          <span className="text-[10px] text-muted-foreground/60">
            {topic.session_count} session
            {topic.session_count !== 1 ? "s" : ""}
          </span>
        )}
        {topic.last_researched_at && (
          <span className="text-[10px] text-muted-foreground/60 ml-auto">
            {fmtRelative(topic.last_researched_at)}
          </span>
        )}
      </div>

      {isActive && topic.status === "in_progress" && (
        <div className="h-0.5 bg-border/50 rounded-full overflow-hidden mt-0.5">
          <div className="h-full bg-blue-400/60 rounded-full animate-pulse w-3/5" />
        </div>
      )}
    </div>
  );
}

// ── Topic Detail Panel ────────────────────────────────────────────────────────

function TopicDetailPanel({
  topic,
  onClose,
  onRequeue,
  onSynthesize,
  onUpdate,
  onDelete,
  reportSettings,
}: {
  topic: ResearchTopic;
  onClose: () => void;
  onRequeue: (id: number) => void;
  onSynthesize: (id: number) => void;
  onUpdate: (id: number, patch: Partial<ResearchTopic>) => void;
  onDelete: (id: number) => void;
  reportSettings: ReportSettings | null;
}) {
  const [tab, setTab] = useState<"report" | "sessions" | "settings">("report");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const loadSessions = () => {
    fetch(`/app/api/research/topics/${topic.id}/sessions`)
      .then((r) => r.json())
      .then(setSessions)
      .catch(() => {});
  };

  const isActive = topic.status === "queued" || topic.status === "in_progress";

  useEffect(() => {
    loadSessions();
    // Poll fast while active so current_step updates feel live
    const id = setInterval(loadSessions, isActive ? 3_000 : 15_000);
    return () => clearInterval(id);
  }, [topic.id, isActive]);

  // Load the master report session by default (or latest completed session if no master)
  useEffect(() => {
    if (!selectedSession || selectedSession.topic_id !== topic.id) {
      // Prefer master report session, fall back to latest completed with a report
      const masterSession = topic.master_report_session_id
        ? sessions.find((s) => s.id === topic.master_report_session_id)
        : null;
      const fallback = sessions.find((s) => s.status === "completed" && s.report_id);
      const target = masterSession ?? fallback;
      if (target) loadSessionDetail(target.id);
    }
  }, [sessions]);

  const loadSessionDetail = (id: number) => {
    setSessionLoading(true);
    fetch(`/app/api/research/sessions/${id}`)
      .then((r) => r.json())
      .then((s) => {
        setSelectedSession(s);
        setSessionLoading(false);
      })
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
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed line-clamp-2">
              {topic.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span
              className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded border",
                DETAIL_LABELS[topic.detail_level].color,
              )}
            >
              {DETAIL_LABELS[topic.detail_level].label}
            </span>
            {topic.ongoing && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1">
                <Repeat2 className="h-2.5 w-2.5" />
                {topic.revisit_interval ? REVISIT_LABELS[topic.revisit_interval] : "Ongoing"}
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
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer gap-1.5 h-8"
              onClick={() => onRequeue(topic.id)}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Re-research
            </Button>
          )}
          {isActive && (
            <div className="flex items-center gap-1.5 text-xs text-blue-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {liveStep ?? (topic.status === "queued" ? "Starting shortly…" : "Researching…")}
            </div>
          )}
          <Button size="icon" variant="ghost" onClick={onClose} className="h-8 w-8 cursor-pointer">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border/50 px-6 shrink-0">
        {(["report", "sessions", "settings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "cursor-pointer px-3 py-2.5 text-sm capitalize border-b-2 transition-colors",
              tab === t
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
            {t === "sessions" && sessions.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-muted text-muted-foreground px-1 py-0.5 rounded-full">
                {sessions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "report" && (
          <ReportTab
            topic={topic}
            sessions={sessions}
            selectedSession={selectedSession}
            loading={sessionLoading}
            onSelectSession={loadSessionDetail}
            onSynthesize={() => onSynthesize(topic.id)}
            reportSettings={reportSettings}
          />
        )}
        {tab === "sessions" && (
          <SessionsTab
            sessions={sessions}
            selectedSessionId={selectedSession?.id ?? null}
            onSelect={(id) => {
              loadSessionDetail(id);
              setTab("report");
            }}
          />
        )}
        {tab === "settings" && (
          <SettingsTab topic={topic} onUpdate={onUpdate} onDelete={onDelete} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

// ── Report Tab ────────────────────────────────────────────────────────────────

function ReportTab({
  topic,
  sessions,
  selectedSession,
  loading,
  onSelectSession,
  onSynthesize,
  reportSettings,
}: {
  topic: ResearchTopic;
  sessions: Session[];
  selectedSession: Session | null;
  loading: boolean;
  onSelectSession: (id: number) => void;
  onSynthesize: () => void;
  reportSettings: ReportSettings | null;
}) {
  // ── All hooks must come before any early returns ──────────────────────────
  const report = selectedSession?.report ?? null;
  const reportRef = useRef<HTMLDivElement>(null);

  const headings = useMemo(() => {
    if (!report) return [];
    const lines = report.content.split("\n");
    const result: { level: number; text: string; id: string }[] = [];
    const counts: Record<string, number> = {};
    for (const line of lines) {
      const m = line.match(/^(#{1,4})\s+(.+)$/);
      if (!m) continue;
      const level = m[1].length;
      const text = m[2].trim();
      const base = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s_-]+/g, "-");
      counts[base] = (counts[base] ?? 0) + 1;
      const id = counts[base] > 1 ? `${base}-${counts[base] - 1}` : base;
      result.push({ level, text, id });
    }
    return result;
  }, [report?.content]);

  const mdHeadings = useMemo(() => {
    const slugCounts: Record<string, number> = {};
    const makeH =
      (level: number) =>
      ({ children, ...props }: any) => {
        const text = String(children);
        const base = text
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/[\s_-]+/g, "-");
        slugCounts[base] = (slugCounts[base] ?? 0) + 1;
        const id = slugCounts[base] > 1 ? `${base}-${slugCounts[base] - 1}` : base;
        const Tag = `h${level}` as keyof JSX.IntrinsicElements;
        return (
          <Tag id={id} {...props}>
            {children}
          </Tag>
        );
      };
    return { h1: makeH(1), h2: makeH(2), h3: makeH(3), h4: makeH(4) };
  }, [report?.content]);

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (report?.share_token) setShareToken(report.share_token);
  }, [report?.id]);

  // ── Derived values (safe after hooks) ─────────────────────────────────────
  const completedSessions = sessions.filter((s) => s.status === "completed" && s.report_id);
  const isActive = topic.status === "queued" || topic.status === "in_progress";
  const isMasterSession = selectedSession?.id === topic.master_report_session_id;
  const reportType = report?.report_type ?? (isMasterSession ? "master" : null);
  const hasDeltasPendingSynthesis = (topic.delta_count ?? 0) > 0;
  const canSynthesize = !isActive && completedSessions.length > 1;

  const handleSynthesize = async () => {
    setSynthesizing(true);
    try {
      await onSynthesize();
    } finally {
      setSynthesizing(false);
    }
  };

  // ── Early returns (after all hooks) ───────────────────────────────────────
  if (isActive && sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
        <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
        <p className="text-sm text-muted-foreground">
          Research is starting — this usually takes a couple of minutes.
        </p>
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
            ? "No report yet — research is in progress."
            : "Select a session to view its report."}
        </p>
      </div>
    );
  }

  const session = selectedSession!;

  const handleShare = () => {
    if (shareToken) {
      setShowShareDialog(true);
      return;
    }
    setShareLoading(true);
    fetch(`/app/api/research/reports/${report.id}/share`, {
      method: "POST",
    })
      .then((r) => r.json())
      .then((d) => {
        setShareToken(d.token);
        setShowShareDialog(true);
      })
      .finally(() => setShareLoading(false));
  };

  const handleRevokeShare = () => {
    fetch(`/app/api/research/reports/${report.id}/share`, {
      method: "DELETE",
    }).then(() => {
      setShareToken(null);
      setShowShareDialog(false);
    });
  };

  const shareUrl = shareToken ? `${window.location.origin}/share/${shareToken}` : null;

  const rs = reportSettings;
  const hasBranding = rs && rs.company_name;
  const copyrightYear = new Date().getFullYear();
  const copyrightLine = hasBranding
    ? `\u00A9 ${copyrightYear} ${rs.company_name}. All rights reserved.`
    : "";

  const downloadMd = () => {
    const parts: string[] = [];
    const preparedFor = topic.prepared_for?.trim();
    // Frontmatter with attribution
    if (hasBranding || preparedFor) {
      parts.push("---");
      parts.push(`title: "${topic.title.replace(/"/g, '\\"')}"`);
      if (hasBranding) parts.push(`author: "${rs.company_name}"`);
      if (preparedFor) parts.push(`prepared_for: "${preparedFor}"`);
      if (hasBranding && rs.tagline) parts.push(`tagline: "${rs.tagline}"`);
      if (hasBranding && rs.website) parts.push(`website: "${rs.website}"`);
      if (hasBranding && rs.contact_email) parts.push(`contact: "${rs.contact_email}"`);
      parts.push(`date: "${new Date().toISOString().split("T")[0]}"`);
      if (copyrightLine) parts.push(`copyright: "${copyrightLine}"`);
      parts.push("---\n");
    }
    if (preparedFor) {
      parts.push(`> **Prepared for:** ${preparedFor}\n`);
    }
    parts.push(report.content);
    // Footer
    if (hasBranding) {
      parts.push("\n\n---\n");
      parts.push(`*${copyrightLine}*\n`);
      if (rs.confidentiality_notice) parts.push(`*${rs.confidentiality_notice}*\n`);
      const contact = [rs.website, rs.contact_email].filter(Boolean).join(" | ");
      if (contact) parts.push(`\n${rs.company_name} — ${contact}\n`);
    }
    const blob = new Blob([parts.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${topic.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-research.md`;
    a.click();
  };

  const downloadPdf = () => {
    if (!report || !reportRef.current) return;
    setPdfLoading(true);

    const preparedFor = topic.prepared_for?.trim();
    const sources = session.findings
      ?.filter((f, i, arr) => f.source_url && arr.findIndex((x) => x.source_url === f.source_url) === i)
      ?? [];

    // Build branded header HTML
    let headerHtml = "";
    if (hasBranding) {
      headerHtml = `
        <div class="brand-header">
          <div class="brand-left">
            <div class="brand-company">${rs!.company_name}</div>
            ${rs!.tagline ? `<div class="brand-tagline">${rs!.tagline}</div>` : ""}
          </div>
          ${preparedFor ? `<div class="brand-right">Prepared for: <strong>${preparedFor}</strong></div>` : ""}
        </div>
        <hr class="brand-sep" />
      `;
    } else if (preparedFor) {
      headerHtml = `
        <div class="brand-header">
          <div class="brand-right">Prepared for: <strong>${preparedFor}</strong></div>
        </div>
        <hr class="brand-sep" />
      `;
    }

    // Build sources HTML
    let sourcesHtml = "";
    if (sources.length > 0) {
      sourcesHtml = `
        <div class="sources-section">
          <p class="sources-title">Sources</p>
          ${sources.map((f, i) => `<div class="source-item"><span class="source-num">${i + 1}.</span> <a href="${f.source_url}">${f.source_title || f.source_url}</a></div>`).join("\n")}
        </div>
      `;
    }

    // Build footer HTML
    let footerHtml = "";
    if (hasBranding) {
      const contact = [rs!.website, rs!.contact_email].filter(Boolean).join(" · ");
      footerHtml = `
        <div class="brand-footer">
          <hr class="brand-sep" />
          <div class="footer-row">
            <span>${copyrightLine}</span>
            ${contact ? `<span>${contact}</span>` : ""}
          </div>
          ${rs!.confidentiality_notice ? `<div class="footer-conf">${rs!.confidentiality_notice}</div>` : ""}
        </div>
      `;
    }

    // Clone the rendered report content
    const contentHtml = reportRef.current.innerHTML;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setPdfLoading(false);
      return;
    }

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${topic.title}</title>
  <style>
    @page {
      size: letter;
      margin: 0.75in 0.85in 0.9in 0.85in;
      @top-left { content: "${hasBranding ? rs!.company_name.replace(/"/g, '\\"') : ""}"; font-size: 8pt; color: #666; font-family: 'Segoe UI', system-ui, sans-serif; }
      @top-right { content: "${preparedFor ? `Prepared for: ${preparedFor.replace(/"/g, '\\"')}` : ""}"; font-size: 8pt; color: #666; font-family: 'Segoe UI', system-ui, sans-serif; }
      @bottom-left { content: "${hasBranding ? copyrightLine.replace(/"/g, '\\"') : ""}"; font-size: 7pt; color: #999; font-family: 'Segoe UI', system-ui, sans-serif; }
      @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 7pt; color: #999; font-family: 'Segoe UI', system-ui, sans-serif; }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* Brand header (first page) */
    .brand-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 8px;
    }
    .brand-company { font-size: 18pt; font-weight: 700; color: #111; }
    .brand-tagline { font-size: 9pt; color: #666; margin-top: 2px; }
    .brand-right { font-size: 9pt; color: #555; text-align: right; }
    .brand-sep { border: none; border-top: 1.5px solid #ddd; margin: 10px 0 20px 0; }

    /* Report content */
    .report-content h1 { font-size: 18pt; font-weight: 700; margin: 0 0 12px 0; line-height: 1.3; color: #111; }
    .report-content h2 { font-size: 14pt; font-weight: 600; margin: 24px 0 8px 0; line-height: 1.3; color: #222; page-break-after: avoid; }
    .report-content h3 { font-size: 12pt; font-weight: 600; margin: 18px 0 6px 0; color: #333; page-break-after: avoid; }
    .report-content h4 { font-size: 11pt; font-weight: 600; margin: 14px 0 4px 0; color: #444; page-break-after: avoid; }
    .report-content p { margin-bottom: 10px; orphans: 3; widows: 3; }
    .report-content ul, .report-content ol { margin-bottom: 10px; padding-left: 24px; }
    .report-content li { margin-bottom: 4px; }
    .report-content blockquote { border-left: 3px solid #ccc; padding-left: 12px; color: #555; font-style: italic; margin: 12px 0; }
    .report-content table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; }
    .report-content th { text-align: left; font-weight: 600; padding: 6px 8px; border-bottom: 2px solid #ddd; }
    .report-content td { padding: 5px 8px; border-bottom: 1px solid #eee; }
    .report-content a { color: #2563eb; text-decoration: none; }
    .report-content a:hover { text-decoration: underline; }
    .report-content sup { font-size: 7pt; }
    .report-content sup a { color: #2563eb; font-weight: 600; text-decoration: none; }
    .report-content code { font-family: 'Consolas', 'Courier New', monospace; font-size: 9pt; background: #f5f5f5; padding: 1px 4px; border-radius: 3px; }
    .report-content pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; margin: 10px 0; font-size: 9pt; }
    .report-content hr { border: none; border-top: 1px solid #ddd; margin: 16px 0; }
    .report-content img { max-width: 100%; }

    /* Sources */
    .sources-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid #ddd; page-break-inside: avoid; }
    .sources-title { font-size: 8pt; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 8px; }
    .source-item { font-size: 9pt; color: #555; margin-bottom: 3px; line-height: 1.4; }
    .source-num { color: #999; }
    .source-item a { color: #2563eb; text-decoration: none; }

    /* Brand footer (in-content, last page) */
    .brand-footer { margin-top: 30px; }
    .footer-row { display: flex; justify-content: space-between; font-size: 8pt; color: #999; }
    .footer-conf { font-size: 7pt; color: #aaa; margin-top: 4px; font-style: italic; }

    /* Print-specific */
    @media print {
      body { font-size: 10.5pt; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  ${headerHtml}
  <div class="report-content">
    ${contentHtml}
  </div>
  ${sourcesHtml}
  ${footerHtml}
</body>
</html>`);

    printWindow.document.close();

    // Wait for content to render, then trigger print
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      // Clean up after print dialog closes
      setTimeout(() => {
        printWindow.close();
        setPdfLoading(false);
      }, 1000);
    }, 500);
  };

  return (
    <div className="flex gap-8 px-8 py-6">
      <div className="flex-1 min-w-0 max-w-3xl">
        {/* Session selector (if multiple) + Re-synthesize button */}
        {(completedSessions.length > 1 || canSynthesize) && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {completedSessions.length > 1 && (
              <>
                <Archive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0">Version:</span>
                <div className="flex gap-1 flex-wrap flex-1">
                  {completedSessions.map((s, i) => {
                    const isMaster = s.id === topic.master_report_session_id;
                    const sType = s.session_type;
                    // Version number: newest = highest (reversed index since sorted DESC)
                    const vNum = completedSessions.length - i;
                    const isLatest = i === 0;
                    return (
                      <button
                        key={s.id}
                        onClick={() => onSelectSession(s.id)}
                        className={cn(
                          "cursor-pointer text-[10px] px-2 py-0.5 rounded border transition-all flex items-center gap-1",
                          s.id === session.id
                            ? "bg-foreground/10 border-foreground/30 text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
                        )}
                      >
                        {isMaster && <GitMerge className="h-2.5 w-2.5 text-violet-400" />}
                        {sType === "delta" && <Layers className="h-2.5 w-2.5 text-amber-400" />}
                        {sType === "master_synthesis"
                          ? "Master"
                          : `v${vNum}${isLatest ? " (latest)" : ""}`}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {canSynthesize && (
              <button
                onClick={handleSynthesize}
                disabled={synthesizing}
                title={
                  hasDeltasPendingSynthesis
                    ? `${topic.delta_count} delta${topic.delta_count !== 1 ? "s" : ""} pending — re-synthesize master report`
                    : "Re-synthesize master report"
                }
                className={cn(
                  "cursor-pointer ml-auto flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded border transition-all",
                  hasDeltasPendingSynthesis
                    ? "border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
                  synthesizing && "opacity-50 cursor-not-allowed",
                )}
              >
                {synthesizing ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <GitMerge className="h-2.5 w-2.5" />
                )}
                {hasDeltasPendingSynthesis
                  ? `Synthesize (${topic.delta_count} new)`
                  : "Re-synthesize"}
              </button>
            )}
          </div>
        )}

        {/* Report meta */}
        <div className="flex items-center justify-between mb-5 gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            {session.completed_at && <span>Researched {fmt(session.completed_at)}</span>}
            {session.findings && session.findings.length > 0 && (
              <span>
                · {session.findings.length} finding
                {session.findings.length !== 1 ? "s" : ""}
              </span>
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
              disabled={pdfLoading}
              className="cursor-pointer flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> {pdfLoading ? "generating..." : ".pdf"}
            </button>
            <button
              onClick={handleShare}
              disabled={shareLoading}
              className={cn(
                "cursor-pointer flex items-center gap-1.5 text-xs transition-colors",
                shareToken
                  ? "text-emerald-400 hover:text-emerald-300"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Share2 className="h-3.5 w-3.5" />
              {shareToken ? "Shared" : "Share"}
            </button>
          </div>
        </div>

        <Separator className="mb-8" />

        {/* Rendered report */}
        <div
          ref={reportRef}
          className={cn(
            "prose prose-invert max-w-none",
            // Headings
            "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-0 [&_h1]:leading-tight",
            "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:leading-snug",
            "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2",
            "[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-4 [&_h4]:mb-1.5",
            // Body
            "[&_p]:text-[15px] [&_p]:leading-[1.75] [&_p]:mb-4 [&_p]:text-foreground/90",
            // Lists
            "[&_ul]:text-[15px] [&_ul]:leading-[1.75] [&_ul]:mb-4 [&_ul]:pl-6",
            "[&_ol]:text-[15px] [&_ol]:leading-[1.75] [&_ol]:mb-4 [&_ol]:pl-6",
            "[&_li]:mb-2 [&_li]:text-foreground/90",
            // Inline
            "[&_strong]:font-semibold [&_strong]:text-foreground",
            "[&_em]:italic [&_em]:text-foreground/80",
            "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-primary/80",
            "[&_code]:text-[13px] [&_code]:bg-muted [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono",
            "[&_pre]:bg-muted [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:mb-4",
            // Blockquote
            "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic [&_blockquote]:my-4",
            // HR
            "[&_hr]:border-border/40 [&_hr]:my-6",
            // Tables
            "[&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_table]:mb-4",
            "[&_th]:text-left [&_th]:font-semibold [&_th]:py-2 [&_th]:px-3 [&_th]:border-b [&_th]:border-border",
            "[&_td]:py-2 [&_td]:px-3 [&_td]:border-b [&_td]:border-border/40",
            // Superscript citations
            "[&_sup]:text-[10px] [&_sup]:leading-none",
            "[&_sup_a]:text-primary [&_sup_a]:no-underline [&_sup_a]:font-semibold [&_sup_a]:hover:underline",
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={mdHeadings as any}>
            {report.content}
          </ReactMarkdown>
        </div>

        {/* Sources */}
        {session.findings && session.findings.filter((f) => f.source_url).length > 0 && (
          <div className="mt-8 pt-6 border-t border-border/40">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Sources
            </p>
            <div className="space-y-1.5">
              {session.findings
                .filter(
                  (f, i, arr) =>
                    f.source_url && arr.findIndex((x) => x.source_url === f.source_url) === i,
                )
                .map((f, i) => (
                  <a
                    key={f.id}
                    id={`ref-${i + 1}`}
                    href={f.source_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer group scroll-mt-8"
                  >
                    <span className="shrink-0 text-muted-foreground/40 group-hover:text-primary/50 mt-0.5">
                      {i + 1}.
                    </span>
                    <span className="line-clamp-1">{f.source_title || f.source_url}</span>
                  </a>
                ))}
            </div>
          </div>
        )}
      </div>
      {/* end flex-1 */}

      {/* ToC sidebar */}
      {headings.filter((h) => h.level <= 3).length >= 3 && (
        <nav className="hidden 2xl:block w-48 shrink-0">
          <div className="sticky top-6">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
              On this page
            </p>
            <ul className="space-y-1">
              {headings
                .filter((h) => h.level <= 3)
                .map((h) => (
                  <li key={h.id}>
                    <a
                      href={`#${h.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(h.id)?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      }}
                      className={cn(
                        "block text-[11px] leading-relaxed cursor-pointer transition-colors text-muted-foreground hover:text-foreground",
                        h.level === 1
                          ? "pl-0 font-medium"
                          : h.level === 2
                            ? "pl-2"
                            : "pl-4 text-[10px]",
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
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowShareDialog(false)}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Share report</h3>
              <button
                onClick={() => setShowShareDialog(false)}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Anyone with this link can view the report without logging in.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 bg-muted rounded px-3 py-2 text-xs font-mono text-foreground border border-border"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                }}
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

function SessionsTab({
  sessions,
  selectedSessionId,
  onSelect,
}: {
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
            onClick={() => (s.status === "completed" && s.report_id ? onSelect(s.id) : undefined)}
            className={cn(
              "w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all",
              s.id === selectedSessionId
                ? "bg-sidebar-accent border-primary/40"
                : s.status === "completed" && s.report_id
                  ? "bg-card border-border hover:border-primary/30 hover:bg-card/80 cursor-pointer"
                  : "bg-card/50 border-border/50 cursor-default",
            )}
          >
            <StatusIcon
              className={cn(
                "h-4 w-4 mt-0.5 shrink-0",
                sc.color,
                (s.status === "queued" ||
                  s.status === "in_progress" ||
                  s.status === "searching" ||
                  s.status === "synthesizing") &&
                  "animate-spin",
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  v{sessions.length - i}
                  {i === 0 && (
                    <span className="text-xs text-muted-foreground ml-1">(latest)</span>
                  )}
                  {s.session_type === "master_synthesis" && (
                    <span className="text-xs text-violet-400 ml-1">Master</span>
                  )}
                  {s.session_type === "delta" && (
                    <span className="text-xs text-amber-400 ml-1">Delta</span>
                  )}
                </span>
                <span className={cn("text-xs", sc.color)}>{sc.label}</span>
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
                {(s.findings_count ?? 0) > 0 && <span>· {s.findings_count} findings</span>}
                {s.report_id && <span>· has report</span>}
              </div>
              {s.error && <p className="text-xs text-red-400 mt-1">{s.error}</p>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab({
  topic,
  onUpdate,
  onDelete,
  onClose,
}: {
  topic: ResearchTopic;
  onUpdate: (id: number, patch: Partial<ResearchTopic>) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(topic.title);
  const [description, setDescription] = useState(topic.description ?? "");
  const [preparedFor, setPreparedFor] = useState(topic.prepared_for ?? "");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(topic.detail_level);
  const [ongoing, setOngoing] = useState(topic.ongoing === 1);
  const [interval, setInterval] = useState<RevisitInterval>(topic.revisit_interval ?? "weekly");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    setSaving(true);
    await onUpdate(topic.id, {
      title,
      description: description || null,
      prepared_for: preparedFor || null,
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
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label>Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What should be researched? Add context, angles, specific questions…"
          rows={3}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Prepared for</Label>
        <Input
          value={preparedFor}
          onChange={(e) => setPreparedFor(e.target.value)}
          placeholder="Client or company name — shown on exports"
          className="h-8 text-sm"
        />
        <p className="text-[10px] text-muted-foreground">
          Appears in the header of PDF, Markdown, and shared reports.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Research depth</Label>
        <div className="grid grid-cols-3 gap-2">
          {(
            Object.entries(DETAIL_LABELS) as [DetailLevel, (typeof DETAIL_LABELS)[DetailLevel]][]
          ).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => setDetailLevel(key)}
              className={cn(
                "cursor-pointer flex flex-col gap-1 p-2.5 rounded-lg border text-left transition-all",
                detailLevel === key
                  ? "border-primary/60 bg-primary/5"
                  : "border-border hover:border-primary/30",
              )}
            >
              <span className={cn("text-xs font-semibold", meta.color.split(" ")[1])}>
                {meta.label}
              </span>
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
          <Select value={interval} onValueChange={(v) => setInterval(v as RevisitInterval)}>
            <SelectTrigger className="cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(REVISIT_LABELS) as [RevisitInterval, string][]).map(
                ([key, label]) => (
                  <SelectItem key={key} value={key} className="cursor-pointer">
                    {label}
                  </SelectItem>
                ),
              )}
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
              onClick={() => {
                onDelete(topic.id);
                onClose();
              }}
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

function NewTopicModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    title: string;
    description: string;
    detail_level: DetailLevel;
    ongoing: boolean;
    revisit_interval: RevisitInterval | null;
    prepared_for?: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [preparedFor, setPreparedFor] = useState("");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("standard");
  const [ongoing, setOngoing] = useState(false);
  const [interval, setRevisitInterval] = useState<RevisitInterval>("weekly");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setPreparedFor("");
      setDetailLevel("standard");
      setOngoing(false);
      setRevisitInterval("weekly");
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open]);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await onCreate({
      title: title.trim(),
      description,
      detail_level: detailLevel,
      ongoing,
      revisit_interval: ongoing ? interval : null,
      prepared_for: preparedFor.trim() || undefined,
    });
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
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
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Rust vs Go for backend services"
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submit()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add context, specific questions, angles to cover…"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Prepared for <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              value={preparedFor}
              onChange={(e) => setPreparedFor(e.target.value)}
              placeholder="Client or company name"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Research depth</Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                Object.entries(DETAIL_LABELS) as [
                  DetailLevel,
                  (typeof DETAIL_LABELS)[DetailLevel],
                ][]
              ).map(([key, meta]) => (
                <button
                  key={key}
                  onClick={() => setDetailLevel(key)}
                  className={cn(
                    "cursor-pointer flex flex-col gap-0.5 p-2.5 rounded-lg border text-left transition-all",
                    detailLevel === key
                      ? "border-primary/60 bg-primary/5"
                      : "border-border hover:border-primary/30",
                  )}
                >
                  <span className={cn("text-xs font-semibold", meta.color.split(" ")[1])}>
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{meta.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Keep research ongoing</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Revisit and refresh on a schedule.
              </p>
            </div>
            <Switch checked={ongoing} onCheckedChange={setOngoing} className="cursor-pointer" />
          </div>
          {ongoing && (
            <div className="space-y-1.5">
              <Label>Revisit every</Label>
              <Select
                value={interval}
                onValueChange={(v) => setRevisitInterval(v as RevisitInterval)}
              >
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(REVISIT_LABELS) as [RevisitInterval, string][]).map(
                    ([key, label]) => (
                      <SelectItem key={key} value={key} className="cursor-pointer">
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="cursor-pointer">
              Cancel
            </Button>
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

// ── Branding Settings Dialog ─────────────────────────────────────────────────

function BrandingSettingsDialog({
  open,
  onClose,
  settings,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  settings: ReportSettings | null;
  onSave: (s: ReportSettings) => void;
}) {
  const [form, setForm] = useState<ReportSettings>({
    company_name: "",
    tagline: "",
    copyright_holder: "",
    contact_email: "",
    website: "",
    logo_url: "",
    confidentiality_notice:
      "This document is proprietary and confidential. Unauthorized distribution is prohibited.",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch("/app/api/report-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, copyright_holder: form.company_name }),
      });
      const updated = await r.json();
      onSave(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const set = (field: keyof ReportSettings, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report Branding</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Company info embedded in every export — PDF, Markdown, and shared web links.
          </p>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Company Name *</Label>
            <Input
              value={form.company_name}
              onChange={(e) => set("company_name", e.target.value)}
              placeholder="Acme Consulting LLC"
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Used in header, copyright line, and contact footer.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Tagline</Label>
            <Input
              value={form.tagline}
              onChange={(e) => set("tagline", e.target.value)}
              placeholder="Strategic Research & Advisory"
              className="h-8 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Website</Label>
              <Input
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://acme.com"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Contact Email</Label>
              <Input
                value={form.contact_email}
                onChange={(e) => set("contact_email", e.target.value)}
                placeholder="research@acme.com"
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Logo URL</Label>
            <Input
              value={form.logo_url}
              onChange={(e) => set("logo_url", e.target.value)}
              placeholder="https://acme.com/logo.png"
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Shown in PDF header. Use a publicly accessible URL or data: URI.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Confidentiality Notice</Label>
            <Textarea
              value={form.confidentiality_notice}
              onChange={(e) => set("confidentiality_notice", e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          {/* Preview */}
          {form.company_name && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-center space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">
                Preview
              </p>
              <p className="text-xs font-bold uppercase tracking-wider">
                {form.company_name}
              </p>
              {form.tagline && (
                <p className="text-[10px] text-muted-foreground">{form.tagline}</p>
              )}
              <Separator className="my-2" />
              <p className="text-[10px] font-medium text-muted-foreground">
                &copy; {new Date().getFullYear()}{" "}
                {form.company_name}. All rights reserved.
              </p>
              {form.confidentiality_notice && (
                <p className="text-[9px] text-muted-foreground/60 italic">
                  {form.confidentiality_notice}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose} className="cursor-pointer">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.company_name.trim()}
            className="cursor-pointer"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Save Branding
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
