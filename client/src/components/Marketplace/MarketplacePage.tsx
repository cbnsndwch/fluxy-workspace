import {
    BookOpen,
    Check,
    Database,
    FlaskConical,
    GitBranch,
    ImageIcon,
    Lightbulb,
    Package,
    ShieldCheck,
    Sparkles,
    TriangleAlert,
    Users,
    Workflow,
    Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppTracking } from '@/components/Analytics/AnalyticsProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/* ─── App catalogue ─────────────────────────────────────────────────────────── */

interface AppDef {
    id: string;
    name: string;
    tagline: string;
    description: string;
    icon: React.ElementType;
    color: string; // bg-{x}/10 text-{x}
    highlight?: string; // short benefit pill
}

const APPS: AppDef[] = [
    {
        id: 'crm',
        name: 'CRM',
        tagline: 'Contacts, companies & pipeline',
        description: 'Full contact & company management with a Kanban deals pipeline. Never lose track of a lead.',
        icon: Users,
        color: 'bg-blue-500/10 text-blue-500',
        highlight: 'Most popular',
    },
    {
        id: 'app-ideas',
        name: 'App Ideas Canvas',
        tagline: 'Visual idea planning',
        description: 'Infinite React Flow canvas to brainstorm, group and track product ideas from spark to spec.',
        icon: Lightbulb,
        color: 'bg-violet-500/10 text-violet-500',
    },
    {
        id: 'image-studio',
        name: 'Image Studio',
        tagline: 'AI image generation',
        description: 'Generate images with DALL-E 3 & Imagen 4. Gallery, history, and prompt library built-in.',
        icon: ImageIcon,
        color: 'bg-pink-500/10 text-pink-500',
        highlight: 'AI-powered',
    },
    {
        id: 'workflows',
        name: 'Workflows',
        tagline: 'Visual automation builder',
        description: 'n8n-style drag-and-drop workflow editor. HTTP requests, code runners, DB queries & cron triggers.',
        icon: Workflow,
        color: 'bg-orange-500/10 text-orange-500',
        highlight: 'Automate anything',
    },
    {
        id: 'deep-research',
        name: 'Deep Research',
        tagline: 'Automated web research',
        description: 'Set topics and let your Fluxy research them on a schedule. Reports, findings & ongoing tracking.',
        icon: FlaskConical,
        color: 'bg-cyan-500/10 text-cyan-500',
        highlight: 'AI-powered',
    },
    {
        id: 'users',
        name: 'User Management',
        tagline: 'Access control & permissions',
        description: 'Role-based access with app-level permission gates. Invite teammates and control what they see.',
        icon: ShieldCheck,
        color: 'bg-teal-500/10 text-teal-500',
    },
    {
        id: 'db-viewer',
        name: 'DB Viewer',
        tagline: 'Browse your SQLite database',
        description: 'Visual table browser, row editor and live SQL query runner against your workspace database.',
        icon: Database,
        color: 'bg-emerald-500/10 text-emerald-500',
    },
    {
        id: 'docs',
        name: 'Docs',
        tagline: 'Workspace documentation',
        description: 'Markdown-first docs with a tree-based file structure. Write guides, specs and runbooks.',
        icon: BookOpen,
        color: 'bg-sky-500/10 text-sky-500',
    },
    {
        id: 'issues',
        name: 'Workspace Improvements',
        tagline: 'Issue tracker & workflow editor',
        description: 'Collect issues, track fixes and visualize your workflow with a built-in node editor.',
        icon: TriangleAlert,
        color: 'bg-amber-500/10 text-amber-500',
    },
    {
        id: 'flow-capture',
        name: 'Flow Capture',
        tagline: 'Speech-to-diagram in real time',
        description: 'Speak your user flow and watch AI render it as a live Mermaid diagram. Persistent sessions, voice + text input, pan/zoom canvas, Monaco source editor.',
        icon: GitBranch,
        color: 'bg-purple-500/10 text-purple-500',
        highlight: 'AI-powered',
    },
];

/* ─── Pricing tiers ──────────────────────────────────────────────────────────── */

interface Tier {
    id: 'solo' | 'starter' | 'pro' | 'all';
    label: string;
    price: number;
    appCount: number | 'all';
    badge?: string;
    badgeColor?: string;
    description: string;
}

const TIERS: Tier[] = [
    {
        id: 'solo',
        label: 'Solo',
        price: 15,
        appCount: 1,
        description: 'One app, one focus.',
    },
    {
        id: 'starter',
        label: 'Starter',
        price: 40,
        appCount: 3,
        description: 'Pick any 3 apps.',
        badge: 'Save 11%',
        badgeColor: 'bg-blue-500/10 text-blue-600',
    },
    {
        id: 'pro',
        label: 'Pro',
        price: 60,
        appCount: 5,
        badge: 'Save 20%',
        badgeColor: 'bg-violet-500/10 text-violet-600',
        description: 'Pick any 5 apps.',
    },
    {
        id: 'all',
        label: 'Everything',
        price: 100,
        appCount: 'all',
        badge: 'Best value',
        badgeColor: 'bg-emerald-500/10 text-emerald-600',
        description: 'Every app, now and forever. All future apps included.',
    },
];

/* ─── Component ──────────────────────────────────────────────────────────────── */

export default function MarketplacePage() {
    const { trackPageView } = useAppTracking('marketplace');
    useEffect(() => { trackPageView(); }, [trackPageView]);
    const [selectedTier, setSelectedTier] = useState<Tier>(TIERS[1]);
    const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());

    const maxApps = selectedTier.appCount === 'all' ? APPS.length : selectedTier.appCount;
    const allSelected = selectedTier.appCount === 'all';

    function toggleApp(id: string) {
        if (allSelected) return;
        setSelectedApps((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else if (next.size < maxApps) {
                next.add(id);
            }
            return next;
        });
    }

    function handleTierChange(tier: Tier) {
        setSelectedTier(tier);
        setSelectedApps(new Set()); // reset selection when tier changes
    }

    const chosenCount = allSelected ? APPS.length : selectedApps.size;
    const remaining = allSelected ? 0 : maxApps - selectedApps.size;
    const perApp = chosenCount > 0 ? (selectedTier.price / (allSelected ? APPS.length : maxApps)).toFixed(2) : null;

    return (
        <div className="flex flex-col min-h-full bg-background">

            {/* ── Hero ─────────────────────────────────────────────────────────── */}
            <div className="border-b bg-gradient-to-br from-background via-background to-muted/30">
                <div className="max-w-5xl mx-auto px-6 py-14 text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/8 border border-primary/20 text-primary text-xs font-medium mb-5">
                        <Package size={12} />
                        Fluxy App Marketplace
                    </div>
                    <h1 className="text-4xl font-bold tracking-tight mb-3">
                        Pick your apps. <span className="text-primary">Power your workflow.</span>
                    </h1>
                    <p className="text-muted-foreground text-lg max-w-xl mx-auto">
                        Choose a plan, select the apps you need, and install them on your Fluxy — instantly.
                    </p>
                    <div className="flex items-center justify-center gap-5 mt-6 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Check size={14} className="text-emerald-500" /> One-click install</span>
                        <span className="flex items-center gap-1.5"><Check size={14} className="text-emerald-500" /> Cancel anytime</span>
                        <span className="flex items-center gap-1.5"><Check size={14} className="text-emerald-500" /> Runs on your hardware</span>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-6 py-10 w-full flex-1">

                {/* ── Tier picker ──────────────────────────────────────────────── */}
                <div className="mb-10">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                        1 — Choose a plan
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {TIERS.map((tier) => {
                            const active = selectedTier.id === tier.id;
                            return (
                                <button
                                    key={tier.id}
                                    onClick={() => handleTierChange(tier)}
                                    className={cn(
                                        'relative rounded-xl border-2 p-4 text-left transition-all cursor-pointer',
                                        active
                                            ? 'border-primary bg-primary/5 shadow-sm'
                                            : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40',
                                    )}
                                >
                                    {tier.badge && (
                                        <span className={cn('absolute top-3 right-3 text-[10px] font-semibold px-1.5 py-0.5 rounded-full', tier.badgeColor)}>
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
                                        <div className="absolute top-3 left-3">
                                            <div className="w-2 h-2 rounded-full bg-primary" />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* ── App selection ─────────────────────────────────────────────── */}
                <div className="mb-28">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            2 — {allSelected ? 'All apps included' : `Pick ${maxApps} app${maxApps !== 1 ? 's' : ''}`}
                        </h2>
                        {!allSelected && (
                            <span className={cn(
                                'text-xs font-medium px-2 py-0.5 rounded-full',
                                remaining === 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'
                            )}>
                                {remaining === 0 ? '✓ All slots filled' : `${remaining} slot${remaining !== 1 ? 's' : ''} remaining`}
                            </span>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {APPS.map((app) => {
                            const isSelected = allSelected || selectedApps.has(app.id);
                            const isDisabled = !allSelected && !isSelected && selectedApps.size >= maxApps;
                            const Icon = app.icon;

                            return (
                                <Card
                                    key={app.id}
                                    onClick={() => toggleApp(app.id)}
                                    className={cn(
                                        'relative transition-all',
                                        allSelected
                                            ? 'border-emerald-500/40 bg-emerald-500/[0.03] cursor-default'
                                            : isSelected
                                            ? 'border-primary/60 bg-primary/[0.03] cursor-pointer shadow-sm'
                                            : isDisabled
                                            ? 'opacity-40 cursor-not-allowed'
                                            : 'hover:border-primary/30 hover:bg-muted/30 cursor-pointer',
                                    )}
                                >
                                    <CardContent className="p-4">
                                        <div className="flex items-start gap-3">
                                            <div className={cn('p-2 rounded-lg shrink-0', app.color)}>
                                                <Icon size={16} />
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
                                                <div className="text-xs text-muted-foreground/80 leading-relaxed">{app.description}</div>
                                            </div>
                                            {/* Checkbox */}
                                            <div className={cn(
                                                'shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all',
                                                isSelected || allSelected
                                                    ? allSelected ? 'bg-emerald-500 border-emerald-500' : 'bg-primary border-primary'
                                                    : 'border-border bg-background',
                                            )}>
                                                {(isSelected || allSelected) && <Check size={11} className="text-white stroke-[3]" />}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ── Sticky summary bar ───────────────────────────────────────────── */}
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
                <div className="rounded-2xl border bg-background/95 backdrop-blur-sm shadow-xl px-6 py-4 flex items-center gap-4">
                    {/* Left: what's selected */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            {allSelected ? (
                                <span className="text-sm font-medium flex items-center gap-1.5">
                                    <Sparkles size={14} className="text-emerald-500" />
                                    All apps — current &amp; future
                                </span>
                            ) : chosenCount === 0 ? (
                                <span className="text-sm text-muted-foreground">
                                    Select {maxApps} app{maxApps !== 1 ? 's' : ''} to get started
                                </span>
                            ) : (
                                <>
                                    <span className="text-sm font-medium">
                                        {chosenCount} of {maxApps} selected
                                    </span>
                                    <span className="text-muted-foreground text-xs hidden sm:block">·</span>
                                    <span className="text-xs text-muted-foreground hidden sm:block truncate">
                                        {APPS.filter(a => selectedApps.has(a.id)).map(a => a.name).join(', ')}
                                    </span>
                                </>
                            )}
                        </div>
                        {perApp && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                                {allSelected ? 'All current & future apps' : `$${perApp}/app per month`}
                            </div>
                        )}
                    </div>

                    {/* Right: price + CTA */}
                    <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                            <div className="text-2xl font-bold leading-none">${selectedTier.price}</div>
                            <div className="text-xs text-muted-foreground">per month</div>
                        </div>
                        <Button
                            size="lg"
                            disabled={!allSelected && selectedApps.size < maxApps}
                            className="gap-2 cursor-pointer"
                        >
                            <Zap size={15} />
                            {allSelected || selectedApps.size === maxApps ? 'Get this bundle' : `Pick ${remaining} more`}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
