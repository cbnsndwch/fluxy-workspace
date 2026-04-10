import {
  AlertTriangle,
  BarChart2,
  BookOpen,
  Check,
  Clock,
  Copy,
  Database,
  ExternalLink,
  FlaskConical,
  GitBranch,
  ImageIcon,
  Lightbulb,
  MessageSquarePlus,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  Tag,
  Terminal,
  Ticket,
  Trash2,
  TriangleAlert,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAppTracking } from "@/components/Analytics/AnalyticsProvider";
import { AppLayout } from "@/components/ui/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface AppDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  version: string;
  icon: string;
  color: string;
  highlight?: string;
  tags: string[];
}

interface Tier {
  id: "solo" | "starter" | "pro" | "all";
  label: string;
  price: number;
  appCount: number | "all";
  badge?: string;
  badgeColor?: string;
  description: string;
}

interface TokenRecord {
  id: string;
  tier: string;
  apps: string[];
  price: number;
  label: string | null;
  expires_at: string;
  redeemed_at: string | null;
  revoked: number;
  created_at: string;
  status: "active" | "expired" | "redeemed" | "revoked";
}

interface ErrorReport {
  id: number;
  app_id: string;
  workspace_id: string | null;
  error_message: string;
  error_stack: string | null;
  context: Record<string, unknown> | null;
  reported_at: string;
}

interface TelemetryEvent {
  id: number;
  app_id: string;
  workspace_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  recorded_at: string;
}

interface MarketplaceSettings {
  error_tracking_enabled: boolean;
  telemetry_enabled: boolean;
  api_reporting_enabled: boolean;
  api_reporting_url: string;
  workspace_id: string;
}

interface Stats {
  totalTokens: number;
  activeTokens: number;
  redeemedTokens: number;
  errorReports: number;
  telemetryEvents: number;
}

/* ─── Catalog ────────────────────────────────────────────────────────────── */

const ICON_MAP: Record<string, React.ElementType> = {
  Users,
  Lightbulb,
  ImageIcon,
  Workflow,
  FlaskConical,
  ShieldCheck,
  Database,
  BookOpen,
  TriangleAlert,
  GitBranch,
  MessageSquarePlus,
  BarChart2,
};

const APPS: AppDef[] = [
  {
    id: "crm",
    name: "CRM",
    tagline: "Contacts, companies & pipeline",
    description:
      "Full contact & company management with a Kanban deals pipeline. Never lose track of a lead.",
    version: "1.0.0",
    icon: "Users",
    color: "bg-blue-500/10 text-blue-500",
    highlight: "Most popular",
    tags: ["crm", "contacts", "sales"],
  },
  {
    id: "app-ideas",
    name: "App Ideas Canvas",
    tagline: "Visual idea planning",
    description:
      "Infinite React Flow canvas to brainstorm, group and track product ideas from spark to spec.",
    version: "1.0.0",
    icon: "Lightbulb",
    color: "bg-violet-500/10 text-violet-500",
    tags: ["ideas", "planning"],
  },
  {
    id: "image-studio",
    name: "Image Studio",
    tagline: "AI image generation",
    description:
      "Generate images with DALL-E 3 & Imagen 4. Gallery, history, and prompt library built-in.",
    version: "1.0.0",
    icon: "ImageIcon",
    color: "bg-pink-500/10 text-pink-500",
    highlight: "AI-powered",
    tags: ["ai", "images"],
  },
  {
    id: "workflows",
    name: "Workflows",
    tagline: "Visual automation builder",
    description:
      "n8n-style drag-and-drop workflow editor. HTTP requests, code runners, DB queries & cron triggers.",
    version: "1.0.0",
    icon: "Workflow",
    color: "bg-orange-500/10 text-orange-500",
    highlight: "Automate anything",
    tags: ["automation"],
  },
  {
    id: "deep-research",
    name: "Deep Research",
    tagline: "Automated web research",
    description:
      "Set topics and let your Fluxy research them on a schedule. Reports, findings & ongoing tracking.",
    version: "1.0.0",
    icon: "FlaskConical",
    color: "bg-cyan-500/10 text-cyan-500",
    highlight: "AI-powered",
    tags: ["research", "ai"],
  },
  {
    id: "users",
    name: "User Management",
    tagline: "Access control & permissions",
    description:
      "Role-based access with app-level permission gates. Invite teammates and control what they see.",
    version: "1.0.0",
    icon: "ShieldCheck",
    color: "bg-teal-500/10 text-teal-500",
    tags: ["auth", "users"],
  },
  {
    id: "db-viewer",
    name: "DB Viewer",
    tagline: "Browse your SQLite database",
    description:
      "Visual table browser, row editor and live SQL query runner against your workspace database.",
    version: "1.0.0",
    icon: "Database",
    color: "bg-emerald-500/10 text-emerald-500",
    tags: ["database", "sql"],
  },
  {
    id: "docs",
    name: "Docs",
    tagline: "Workspace documentation",
    description:
      "Markdown-first docs with a tree-based file structure. Write guides, specs and runbooks.",
    version: "1.0.0",
    icon: "BookOpen",
    color: "bg-sky-500/10 text-sky-500",
    tags: ["docs", "markdown"],
  },
  {
    id: "issues",
    name: "Workspace Issues",
    tagline: "Issue tracker & workflow editor",
    description:
      "Collect issues, track fixes and visualize your workflow with a built-in node editor.",
    version: "1.0.0",
    icon: "TriangleAlert",
    color: "bg-amber-500/10 text-amber-500",
    tags: ["issues", "tracker"],
  },
  {
    id: "flow-capture",
    name: "Flow Capture",
    tagline: "Speech-to-diagram in real time",
    description:
      "Speak your user flow and watch AI render it as a live Mermaid diagram. Persistent sessions, voice + text.",
    version: "1.0.0",
    icon: "GitBranch",
    color: "bg-purple-500/10 text-purple-500",
    highlight: "AI-powered",
    tags: ["ai", "diagrams"],
  },
  {
    id: "icebreaker",
    name: "Icebreaker",
    tagline: "AI conversation starters",
    description:
      "Generate fascinating conversation starters from live tech headlines. Features Steven Mode for maximum chaos.",
    version: "1.0.0",
    icon: "MessageSquarePlus",
    color: "bg-red-500/10 text-red-500",
    highlight: "AI-powered",
    tags: ["ai", "social"],
  },
  {
    id: "analytics",
    name: "Analytics",
    tagline: "Self-hosted event tracking",
    description:
      "Track app usage, visualize events, and understand how your workspace is used — all on your hardware.",
    version: "1.0.0",
    icon: "BarChart2",
    color: "bg-indigo-500/10 text-indigo-500",
    tags: ["analytics", "metrics"],
  },
];

const TIERS: Tier[] = [
  { id: "solo", label: "Solo", price: 15, appCount: 1, description: "One app, one focus." },
  {
    id: "starter",
    label: "Starter",
    price: 40,
    appCount: 3,
    description: "Pick any 3 apps.",
    badge: "Save 11%",
    badgeColor: "bg-blue-500/10 text-blue-600",
  },
  {
    id: "pro",
    label: "Pro",
    price: 60,
    appCount: 5,
    description: "Pick any 5 apps.",
    badge: "Save 20%",
    badgeColor: "bg-violet-500/10 text-violet-600",
  },
  {
    id: "all",
    label: "Everything",
    price: 100,
    appCount: "all",
    description: "Every app, now and forever.",
    badge: "Best value",
    badgeColor: "bg-emerald-500/10 text-emerald-600",
  },
];

/* ─── Utility ────────────────────────────────────────────────────────────── */

function statusColor(status: TokenRecord["status"]) {
  return {
    active: "bg-emerald-500/10 text-emerald-600",
    expired: "bg-muted text-muted-foreground",
    redeemed: "bg-blue-500/10 text-blue-600",
    revoked: "bg-destructive/10 text-destructive",
  }[status];
}

function timeLeft(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/* ─── Checkout Dialog ─────────────────────────────────────────────────────── */

interface CheckoutDialogProps {
  open: boolean;
  onClose: () => void;
  tier: Tier;
  selectedApps: string[];
  onTokenCreated: () => void;
}

function CheckoutDialog({
  open,
  onClose,
  tier,
  selectedApps,
  onTokenCreated,
}: CheckoutDialogProps) {
  const [step, setStep] = useState<"form" | "token">("form");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [expiryHours, setExpiryHours] = useState(48);
  const [loading, setLoading] = useState(false);
  const [tokenId, setTokenId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const selectedAppDefs = APPS.filter((a) => selectedApps.includes(a.id));

  async function handleGenerate() {
    setLoading(true);
    try {
      const res = await fetch("/app/api/marketplace/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: tier.id,
          apps: selectedApps,
          price: tier.price,
          buyerEmail: buyerEmail || undefined,
          notes: notes || undefined,
          expiryHours,
        }),
      });
      const data = await res.json();
      setTokenId(data.tokenId);
      setExpiresAt(data.expiresAt);
      setStep("token");
      onTokenCreated();
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleClose() {
    setStep("form");
    setBuyerEmail("");
    setNotes("");
    setExpiryHours(48);
    setTokenId("");
    onClose();
  }

  const installCommand = `install bundle ${tokenId}`;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        {step === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Ticket size={18} className="text-rose-500" />
                Generate install token
              </DialogTitle>
              <DialogDescription>
                Create a short-lived token the buyer pastes to their Fluxy to install the selected
                apps.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{tier.label} plan</span>
                <span className="text-sm font-bold">${tier.price}/mo</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedAppDefs.map((a) => {
                  const Icon = ICON_MAP[a.icon] ?? Package;
                  return (
                    <span
                      key={a.id}
                      className={cn(
                        "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
                        a.color,
                      )}
                    >
                      <Icon size={10} />
                      {a.name}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="buyer-email">
                  Buyer email <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="buyer-email"
                  type="email"
                  placeholder="customer@example.com"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">
                  Notes <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="notes"
                  placeholder="e.g. Trial for Acme Corp"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Token expires after</Label>
                <div className="flex gap-2">
                  {[24, 48, 168].map((h) => (
                    <button
                      key={h}
                      onClick={() => setExpiryHours(h)}
                      className={cn(
                        "flex-1 py-1.5 text-xs font-medium rounded-md border transition-all cursor-pointer",
                        expiryHours === h
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      {h === 168 ? "7 days" : `${h}h`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={loading} className="gap-2">
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
                Generate token
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-600">
                <Check size={18} />
                Token generated!
              </DialogTitle>
              <DialogDescription>
                Share this with the buyer. Expires in <strong>{timeLeft(expiresAt)}</strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">
                  Install token
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono break-all select-all bg-background border rounded px-3 py-2">
                    {tokenId}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => copy(tokenId, "token")}
                  >
                    {copied === "token" ? (
                      <Check size={14} className="text-emerald-500" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide flex items-center gap-1.5">
                  <Terminal size={12} />
                  Tell your Fluxy agent
                </div>
                <div className="flex items-start gap-2">
                  <code className="flex-1 text-sm font-mono bg-background border rounded px-3 py-2">
                    {installCommand}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => copy(installCommand, "cmd")}
                  >
                    {copied === "cmd" ? (
                      <Check size={14} className="text-emerald-500" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  The buyer opens their Fluxy chat and pastes this. Sebastian handles the rest.
                </p>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock size={14} />
                <span>
                  Expires: {fmt(expiresAt)} ({timeLeft(expiresAt)} remaining)
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {selectedAppDefs.map((a) => {
                  const Icon = ICON_MAP[a.icon] ?? Package;
                  return (
                    <span
                      key={a.id}
                      className={cn(
                        "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
                        a.color,
                      )}
                    >
                      <Icon size={10} />
                      {a.name}
                    </span>
                  );
                })}
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Store Tab ───────────────────────────────────────────────────────────── */

function StoreTab() {
  const [selectedTier, setSelectedTier] = useState<Tier>(TIERS[1]);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const maxApps = selectedTier.appCount === "all" ? APPS.length : selectedTier.appCount;
  const allSelected = selectedTier.appCount === "all";
  const chosenCount = allSelected ? APPS.length : selectedApps.size;
  const remaining = allSelected ? 0 : maxApps - selectedApps.size;
  const canCheckout = allSelected || selectedApps.size === maxApps;

  function toggleApp(id: string) {
    if (allSelected) return;
    setSelectedApps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < maxApps) next.add(id);
      return next;
    });
  }

  function handleTierChange(tier: Tier) {
    setSelectedTier(tier);
    setSelectedApps(new Set());
  }

  const displayApps = allSelected
    ? APPS
    : Array.from(selectedApps)
        .map((id) => APPS.find((a) => a.id === id)!)
        .filter(Boolean);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-10">
          {/* Hero */}
          <div className="text-center py-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs font-medium mb-4">
              <Package size={11} />
              Fluxy App Marketplace
            </div>
            <h2 className="text-3xl font-bold tracking-tight mb-2">
              Pick your apps. <span className="text-rose-500">Power your workflow.</span>
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Choose a plan, select apps, and give customers a token to install them instantly on
              their Fluxy.
            </p>
            <div className="flex items-center justify-center gap-5 mt-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Check size={13} className="text-emerald-500" /> One-command install
              </span>
              <span className="flex items-center gap-1.5">
                <Check size={13} className="text-emerald-500" /> Short-lived tokens
              </span>
              <span className="flex items-center gap-1.5">
                <Check size={13} className="text-emerald-500" /> Runs on their hardware
              </span>
            </div>
          </div>

          {/* Tier picker */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              1 — Choose a plan
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {TIERS.map((tier) => {
                const active = selectedTier.id === tier.id;
                return (
                  <button
                    key={tier.id}
                    onClick={() => handleTierChange(tier)}
                    className={cn(
                      "relative rounded-xl border-2 p-4 text-left transition-all cursor-pointer",
                      active
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
                    )}
                  >
                    {tier.badge && (
                      <span
                        className={cn(
                          "absolute top-2.5 right-2.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                          tier.badgeColor,
                        )}
                      >
                        {tier.badge}
                      </span>
                    )}
                    <div className="text-xl font-bold mb-0.5">
                      ${tier.price}
                      <span className="text-xs font-normal text-muted-foreground">/mo</span>
                    </div>
                    <div className="font-semibold text-sm mb-1">{tier.label}</div>
                    <div className="text-xs text-muted-foreground">{tier.description}</div>
                    {active && (
                      <div className="absolute top-2.5 left-2.5 w-2 h-2 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* App selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                2 —{" "}
                {allSelected
                  ? "All apps included"
                  : `Pick ${maxApps} app${maxApps !== 1 ? "s" : ""}`}
              </p>
              {!allSelected && (
                <span
                  className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded-full",
                    remaining === 0
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {remaining === 0
                    ? "✓ All slots filled"
                    : `${remaining} slot${remaining !== 1 ? "s" : ""} left`}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {APPS.map((app) => {
                const isSelected = allSelected || selectedApps.has(app.id);
                const isDisabled = !allSelected && !isSelected && selectedApps.size >= maxApps;
                const Icon = ICON_MAP[app.icon] ?? Package;

                return (
                  <Card
                    key={app.id}
                    onClick={() => toggleApp(app.id)}
                    className={cn(
                      "relative transition-all",
                      allSelected
                        ? "border-emerald-500/40 bg-emerald-500/[0.03] cursor-default"
                        : isSelected
                          ? "border-primary/60 bg-primary/[0.03] cursor-pointer shadow-sm"
                          : isDisabled
                            ? "opacity-40 cursor-not-allowed"
                            : "hover:border-primary/30 hover:bg-muted/30 cursor-pointer",
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={cn("p-2 rounded-lg shrink-0", app.color)}>
                          <Icon size={15} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-semibold text-sm">{app.name}</span>
                            {app.highlight && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                {app.highlight}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mb-1.5">{app.tagline}</div>
                          <div className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2">
                            {app.description}
                          </div>
                        </div>
                        <div
                          className={cn(
                            "shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                            isSelected || allSelected
                              ? allSelected
                                ? "bg-emerald-500 border-emerald-500"
                                : "bg-primary border-primary"
                              : "border-border bg-background",
                          )}
                        >
                          {(isSelected || allSelected) && (
                            <Check size={11} className="text-white stroke-[3]" />
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky checkout bar */}
      <div className="border-t bg-background/95 backdrop-blur-sm px-6 py-4 shrink-0">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <div className="flex-1 min-w-0">
            {allSelected ? (
              <span className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles size={14} className="text-emerald-500" />
                All apps — current &amp; future
              </span>
            ) : chosenCount === 0 ? (
              <span className="text-sm text-muted-foreground">
                Select {maxApps} app{maxApps !== 1 ? "s" : ""} to generate a token
              </span>
            ) : (
              <div>
                <span className="text-sm font-medium">
                  {chosenCount}/{maxApps} selected
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  {displayApps.map((a) => a.name).join(", ")}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <div className="text-2xl font-bold leading-none">${selectedTier.price}</div>
              <div className="text-xs text-muted-foreground">per month</div>
            </div>
            <Button
              size="lg"
              disabled={!canCheckout}
              onClick={() => setCheckoutOpen(true)}
              className="gap-2"
            >
              <Ticket size={15} />
              {canCheckout ? "Generate token" : `Pick ${remaining} more`}
            </Button>
          </div>
        </div>
      </div>

      <CheckoutDialog
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        tier={selectedTier}
        selectedApps={allSelected ? APPS.map((a) => a.id) : Array.from(selectedApps)}
        onTokenCreated={() => setCheckoutOpen(false)}
      />
    </div>
  );
}

/* ─── Tokens Tab ──────────────────────────────────────────────────────────── */

function TokensTab() {
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/app/api/marketplace/tokens");
    setTokens(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(id: string) {
    setRevoking(id);
    await fetch(`/app/api/marketplace/tokens/${id}`, { method: "DELETE" });
    await load();
    setRevoking(null);
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        <RefreshCw size={14} className="animate-spin mr-2" /> Loading tokens…
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
        <div className="p-4 rounded-2xl bg-muted">
          <Ticket size={28} className="text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">No tokens yet</p>
          <p className="text-sm text-muted-foreground">Generate one in the Store tab.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {tokens.length} token{tokens.length !== 1 ? "s" : ""}
          </p>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>

        <div className="space-y-3">
          {tokens.map((token) => {
            const appDefs = token.apps
              .map((id) => APPS.find((a) => a.id === id))
              .filter(Boolean) as AppDef[];
            const installCmd = `install bundle ${token.id}`;

            return (
              <Card
                key={token.id}
                className={cn(
                  "transition-all",
                  token.status === "active" ? "border-emerald-500/30" : "",
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded truncate max-w-[240px]">
                          {token.id}
                        </code>
                        <button
                          onClick={() => copy(token.id, `t-${token.id}`)}
                          className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        >
                          {copied === `t-${token.id}` ? (
                            <Check size={12} className="text-emerald-500" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                        <Badge
                          className={cn(
                            "text-[10px] px-1.5 py-0 h-4 font-medium border-0",
                            statusColor(token.status),
                          )}
                        >
                          {token.status}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {appDefs.map((a) => {
                          const Icon = ICON_MAP[a.icon] ?? Package;
                          return (
                            <span
                              key={a.id}
                              className={cn(
                                "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full",
                                a.color,
                              )}
                            >
                              <Icon size={9} />
                              {a.name}
                            </span>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Tag size={11} />
                          {token.tier}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          {token.status === "active"
                            ? timeLeft(token.expires_at) + " left"
                            : fmt(token.expires_at)}
                        </span>
                        <span>Created {fmt(token.created_at)}</span>
                        {token.label && <span>→ {token.label}</span>}
                      </div>

                      {token.status === "active" && (
                        <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-1.5">
                          <Terminal size={11} className="text-muted-foreground shrink-0" />
                          <code className="text-xs font-mono flex-1 truncate">{installCmd}</code>
                          <button
                            onClick={() => copy(installCmd, `c-${token.id}`)}
                            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
                          >
                            {copied === `c-${token.id}` ? (
                              <Check size={11} className="text-emerald-500" />
                            ) : (
                              <Copy size={11} />
                            )}
                          </button>
                        </div>
                      )}

                      {token.redeemed_at && (
                        <p className="text-xs text-muted-foreground">
                          Redeemed {fmt(token.redeemed_at)}
                        </p>
                      )}
                    </div>

                    {token.status === "active" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive cursor-pointer"
                        disabled={revoking === token.id}
                        onClick={() => revoke(token.id)}
                      >
                        {revoking === token.id ? (
                          <RefreshCw size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── Reports Tab ─────────────────────────────────────────────────────────── */

function ReportsTab({ settings }: { settings: MarketplaceSettings | null }) {
  const [errorReports, setErrorReports] = useState<ErrorReport[]>([]);
  const [telemetryEvents, setTelemetryEvents] = useState<TelemetryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"errors" | "events">("errors");

  const hasError = settings?.error_tracking_enabled;
  const hasTelemetry = settings?.telemetry_enabled;

  useEffect(() => {
    if (!hasError && !hasTelemetry) {
      setLoading(false);
      return;
    }
    Promise.all([
      hasError
        ? fetch("/app/api/marketplace/error-reports").then((r) => r.json())
        : Promise.resolve([]),
      hasTelemetry
        ? fetch("/app/api/marketplace/telemetry-events").then((r) => r.json())
        : Promise.resolve([]),
    ]).then(([errors, events]) => {
      setErrorReports(errors);
      setTelemetryEvents(events);
      setLoading(false);
    });
  }, [hasError, hasTelemetry]);

  if (!hasError && !hasTelemetry) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center gap-3 p-6">
        <div className="p-4 rounded-2xl bg-muted">
          <BarChart2 size={28} className="text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">Reporting not enabled</p>
          <p className="text-sm text-muted-foreground mt-1">
            Enable error tracking or telemetry in Settings to see incoming reports.
          </p>
        </div>
      </div>
    );
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        <RefreshCw size={14} className="animate-spin mr-2" /> Loading…
      </div>
    );

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <div className="flex gap-2">
        {hasError && (
          <Button
            variant={view === "errors" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("errors")}
            className="gap-1.5"
          >
            <AlertTriangle size={13} /> Errors
            {errorReports.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                {errorReports.length}
              </Badge>
            )}
          </Button>
        )}
        {hasTelemetry && (
          <Button
            variant={view === "events" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("events")}
            className="gap-1.5"
          >
            <BarChart2 size={13} /> Events
            {telemetryEvents.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                {telemetryEvents.length}
              </Badge>
            )}
          </Button>
        )}
      </div>

      {view === "errors" &&
        (errorReports.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-12">
            No error reports yet — good sign!
          </div>
        ) : (
          <div className="space-y-2">
            {errorReports.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                          {r.app_id}
                        </Badge>
                        {r.workspace_id && (
                          <span className="text-xs text-muted-foreground">ws:{r.workspace_id}</span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-destructive">{r.error_message}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {fmt(r.reported_at)}
                    </span>
                  </div>
                  {r.error_stack && (
                    <pre className="text-xs text-muted-foreground bg-muted rounded p-2 overflow-x-auto max-h-24 whitespace-pre-wrap">
                      {r.error_stack.split("\n").slice(0, 6).join("\n")}
                    </pre>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ))}

      {view === "events" &&
        (telemetryEvents.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-12">
            No telemetry events yet.
          </div>
        ) : (
          <div className="space-y-1.5">
            {telemetryEvents.map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-3 p-3 rounded-lg border bg-card text-sm"
              >
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0 mt-0.5">
                  {e.app_id}
                </Badge>
                <span className="font-mono text-xs flex-1">{e.event_type}</span>
                {e.workspace_id && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    ws:{e.workspace_id}
                  </span>
                )}
                <span className="text-xs text-muted-foreground shrink-0">{fmt(e.recorded_at)}</span>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

/* ─── Settings Tab ────────────────────────────────────────────────────────── */

function SettingsTab({
  settings,
  onSave,
}: {
  settings: MarketplaceSettings | null;
  onSave: (s: Partial<MarketplaceSettings>) => Promise<void>;
}) {
  const [form, setForm] = useState<MarketplaceSettings>({
    error_tracking_enabled: false,
    telemetry_enabled: false,
    api_reporting_enabled: false,
    api_reporting_url: "",
    workspace_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (settings) setForm((prev) => ({ ...prev, ...settings }));
  }, [settings]);

  async function handleSave() {
    setSaving(true);
    await onSave(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function copyId() {
    navigator.clipboard.writeText(form.workspace_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl space-y-8">
        {/* Workspace ID */}
        <div>
          <h3 className="text-sm font-semibold mb-1">Workspace Identity</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Your workspace ID is attached to incoming error reports and telemetry so you can group
            them by source.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm font-mono bg-muted border rounded px-3 py-2 text-muted-foreground">
              {form.workspace_id || "—"}
            </code>
            <Button variant="outline" size="icon" onClick={copyId}>
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            </Button>
          </div>
        </div>

        <Separator />

        {/* Opt-in features */}
        <div>
          <h3 className="text-sm font-semibold mb-1">Opt-in Features</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Apps installed from your marketplace can optionally send data back here. All features
            are <strong>off by default</strong> — buyers opt in during install.
          </p>

          <div className="space-y-4">
            <div className="flex items-start gap-4 p-4 rounded-lg border bg-card">
              <div className="p-2 rounded-lg bg-destructive/10 text-destructive shrink-0">
                <AlertTriangle size={16} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="error-tracking" className="text-sm font-medium cursor-pointer">
                    Error tracking
                  </Label>
                  <Switch
                    id="error-tracking"
                    checked={form.error_tracking_enabled}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, error_tracking_enabled: v }))}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Buyers' apps send error reports (message + stack trace) to this workspace. View
                  them in the Reports tab. Use this to find and fix bugs in your apps.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-4 rounded-lg border bg-card">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500 shrink-0">
                <BarChart2 size={16} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="telemetry" className="text-sm font-medium cursor-pointer">
                    Usage telemetry
                  </Label>
                  <Switch
                    id="telemetry"
                    checked={form.telemetry_enabled}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, telemetry_enabled: v }))}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Apps send anonymous usage events (e.g. "contact.created", "report.generated").
                  Helps you understand how buyers use your apps and prioritize improvements.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-4 rounded-lg border bg-card">
              <div className="p-2 rounded-lg bg-violet-500/10 text-violet-500 shrink-0">
                <ExternalLink size={16} />
              </div>
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="api-reporting" className="text-sm font-medium cursor-pointer">
                    Forward to external API
                  </Label>
                  <Switch
                    id="api-reporting"
                    checked={form.api_reporting_enabled}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, api_reporting_enabled: v }))}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Forward incoming error reports to an external URL (Sentry, your own API, etc.).
                  Requires error tracking to be enabled.
                </p>
                {form.api_reporting_enabled && (
                  <div className="space-y-1.5">
                    <Label htmlFor="api-url" className="text-xs">
                      Endpoint URL
                    </Label>
                    <Input
                      id="api-url"
                      placeholder="https://your-api.example.com/errors"
                      value={form.api_reporting_url}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, api_reporting_url: e.target.value }))
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* SDK usage */}
        <div>
          <h3 className="text-sm font-semibold mb-1">Developer SDK</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Add this to any app to support reporting. The functions are silent no-ops when the buyer
            hasn't opted in.
          </p>
          <pre className="text-xs font-mono bg-muted rounded-lg p-4 overflow-x-auto leading-relaxed">{`import { reportError, trackEvent } from '@/lib/appTelemetry';

// In an error boundary or catch block:
reportError('my-app', error, { userId, action: 'save' });

// For usage events (namespaced, dot-separated):
trackEvent('my-app', 'contact.created', { method: 'import' });`}</pre>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="gap-2 min-w-[120px]">
            {saving ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : saved ? (
              <Check size={14} />
            ) : null}
            {saved ? "Saved!" : "Save settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Stats bar ───────────────────────────────────────────────────────────── */

function StatsBar({ stats }: { stats: Stats | null }) {
  if (!stats) return null;
  const items = [
    { label: "Tokens", value: stats.totalTokens },
    { label: "Active", value: stats.activeTokens },
    { label: "Redeemed", value: stats.redeemedTokens },
    { label: "Errors", value: stats.errorReports },
    { label: "Events", value: stats.telemetryEvents },
  ];
  return (
    <div className="flex items-center gap-5">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-3">
          {i > 0 && <div className="w-px h-6 bg-border" />}
          <div className="text-center">
            <div className="text-base font-bold leading-none">{item.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{item.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────────────── */

export default function MarketplacePage() {
  const { trackPageView } = useAppTracking("marketplace");
  const [tab, setTab] = useState("store");
  const [settings, setSettings] = useState<MarketplaceSettings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  // suppress unused warning on ref

  useEffect(() => {
    trackPageView();
  }, [trackPageView]);

  useEffect(() => {
    fetch("/app/api/marketplace/settings")
      .then((r) => r.json())
      .then(setSettings);
    fetch("/app/api/marketplace/stats")
      .then((r) => r.json())
      .then(setStats);
  }, []);

  async function saveSettings(updates: Partial<MarketplaceSettings>) {
    await fetch("/app/api/marketplace/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    setSettings((prev) => (prev ? { ...prev, ...updates } : null));
    // Refresh stats after settings change
    fetch("/app/api/marketplace/stats")
      .then((r) => r.json())
      .then(setStats);
  }

  return (
    <AppLayout
      icon={<Store size={18} />}
      iconClassName="bg-rose-500/10 text-rose-500"
      title="App Marketplace"
      subtitle="Bundle & sell your apps — generate install tokens for buyers"
      actions={<StatsBar stats={stats} />}
    >
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col h-full">
        <div className="border-b px-6 shrink-0">
          <TabsList className="h-10 bg-transparent p-0 gap-0">
            {[
              { value: "store", label: "Store", icon: Store },
              { value: "tokens", label: "Tokens", icon: Ticket },
              { value: "reports", label: "Reports", icon: BarChart2 },
              { value: "settings", label: "Settings", icon: ShieldCheck },
            ].map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="relative h-10 px-4 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none gap-1.5 text-sm cursor-pointer"
              >
                <Icon size={14} />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent
            value="store"
            className="h-full m-0 data-[state=active]:flex data-[state=active]:flex-col"
          >
            <StoreTab />
          </TabsContent>
          <TabsContent value="tokens" className="h-full m-0">
            <TokensTab />
          </TabsContent>
          <TabsContent value="reports" className="h-full m-0">
            <ReportsTab settings={settings} />
          </TabsContent>
          <TabsContent value="settings" className="h-full m-0">
            <SettingsTab settings={settings} onSave={saveSettings} />
          </TabsContent>
        </div>
      </Tabs>
    </AppLayout>
  );
}
