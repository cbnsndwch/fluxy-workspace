import { Zap, AlertTriangle, Clock } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SystemStatus {
    bootTime: string;
    uptimeMs: number;
    activeJobs: number;
    failedJobs: number;
    recentCrons: {
        cron_id: string;
        status: string;
        started_at: string;
        finished_at: string | null;
    }[];
}

function formatUptime(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

type BackendState = 'connected' | 'disconnected' | 'restarting';

export default function SystemMinimap() {
    const [status, setStatus] = useState<SystemStatus | null>(null);
    const [state, setState] = useState<BackendState>('connected');
    const [lastBootTime, setLastBootTime] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    const fetchStatus = useCallback(async () => {
        try {
            const r = await fetch('/app/api/system/status');
            if (!r.ok) throw new Error();
            const data: SystemStatus = await r.json();

            // Detect restart: boot time changed
            if (lastBootTime && data.bootTime !== lastBootTime) {
                setState('restarting');
                setTimeout(() => setState('connected'), 2000);
            } else {
                setState('connected');
            }
            setLastBootTime(data.bootTime);
            setStatus(data);
        } catch {
            setState('disconnected');
            setStatus(null);
        }
    }, [lastBootTime]);

    useEffect(() => {
        fetchStatus();
        const id = setInterval(() => {
            fetchStatus();
            setTick(t => t + 1);
        }, 5000);
        return () => clearInterval(id);
    }, [fetchStatus]);

    // Live uptime counter
    const liveUptime = status
        ? formatUptime(status.uptimeMs + tick * 5000)
        : '--';

    const activeCrons =
        status?.recentCrons.filter(c => c.status === 'running').length ?? 0;

    return (
        <TooltipProvider delayDuration={200}>
            <div className="rounded-lg border border-border/50 bg-card/50 p-2.5 space-y-2">
                {/* Header row: state + uptime */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <div
                            className={cn(
                                'h-2 w-2 rounded-full transition-colors duration-300',
                                state === 'connected' && 'bg-emerald-500',
                                state === 'disconnected' && 'bg-red-500',
                                state === 'restarting' &&
                                    'bg-amber-500 animate-pulse'
                            )}
                        />
                        <span className="text-[10px] font-medium text-muted-foreground">
                            {state === 'connected'
                                ? 'Backend'
                                : state === 'restarting'
                                  ? 'Restarting'
                                  : 'Offline'}
                        </span>
                    </div>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="text-[10px] text-muted-foreground/60 tabular-nums cursor-default">
                                {liveUptime}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">
                            {status
                                ? `Booted ${formatTime(status.bootTime)}`
                                : 'No data'}
                        </TooltipContent>
                    </Tooltip>
                </div>

                {/* Status pills row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <StatusPill
                        icon={Zap}
                        count={status?.activeJobs ?? 0}
                        label="active pipeline jobs"
                        variant={status?.activeJobs ? 'active' : 'idle'}
                    />
                    <StatusPill
                        icon={AlertTriangle}
                        count={status?.failedJobs ?? 0}
                        label="failed jobs"
                        variant={status?.failedJobs ? 'error' : 'idle'}
                    />
                    <StatusPill
                        icon={Clock}
                        count={activeCrons}
                        label="running crons"
                        variant={activeCrons > 0 ? 'active' : 'idle'}
                    />
                </div>

                {/* Recent cron activity (compact) */}
                {status?.recentCrons && status.recentCrons.length > 0 && (
                    <div className="space-y-0.5">
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/40 font-semibold">
                            Recent
                        </span>
                        {status.recentCrons.slice(0, 3).map((c, i) => (
                            <div
                                key={i}
                                className="flex items-center gap-1.5 text-[10px]"
                            >
                                <div
                                    className={cn(
                                        'h-1 w-1 rounded-full shrink-0',
                                        c.status === 'running' &&
                                            'bg-blue-400 animate-pulse',
                                        c.status === 'success' &&
                                            'bg-emerald-400',
                                        c.status === 'failed' && 'bg-red-400',
                                        ![
                                            'running',
                                            'success',
                                            'failed'
                                        ].includes(c.status) &&
                                            'bg-muted-foreground/30'
                                    )}
                                />
                                <span className="text-muted-foreground/70 truncate flex-1">
                                    {c.cron_id}
                                </span>
                                <span className="text-muted-foreground/40 tabular-nums shrink-0">
                                    {formatTime(c.started_at)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
}

function StatusPill({
    icon: Icon,
    count,
    label,
    variant
}: {
    icon: React.ComponentType<{ className?: string }>;
    count: number;
    label: string;
    variant: 'idle' | 'active' | 'error';
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div
                    className={cn(
                        'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] tabular-nums cursor-default transition-colors',
                        variant === 'idle' &&
                            'bg-muted/50 text-muted-foreground/50',
                        variant === 'active' && 'bg-blue-500/10 text-blue-400',
                        variant === 'error' && 'bg-red-500/10 text-red-400'
                    )}
                >
                    <Icon className="h-2.5 w-2.5" />
                    {count}
                </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
                {count} {label}
            </TooltipContent>
        </Tooltip>
    );
}
