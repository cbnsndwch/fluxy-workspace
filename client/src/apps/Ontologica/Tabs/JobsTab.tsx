import {
    BookOpen,
    Brain,
    CheckCircle2,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    ClipboardCheck,
    Clock,
    Code2,
    Copy,
    Eye,
    FileCheck,
    Fingerprint,
    GitBranch,
    Inbox,
    Layers,
    Link2,
    Loader2,
    Map as MapIcon,
    Merge,
    RotateCcw,
    Search,
    Shield,
    Sparkles,
    StopCircle,
    Trash2,
    XCircle
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// ── Pipeline Type System ────────────────────────────────────────────────────

type PipelineType = 'extract' | 'deduplicate' | 'map' | 'review';

interface PipelineTypeDef {
    label: string;
    color: string;
    stages: string[];
    stageMeta: Record<
        string,
        { label: string; icon: typeof Sparkles; description: string }
    >;
}

const PIPELINE_TYPE_DEFS: Record<PipelineType, PipelineTypeDef> = {
    extract: {
        label: 'Extract',
        color: 'blue',
        stages: [
            'chunk',
            'terms',
            'classify',
            'base_resolve',
            'taxonomy',
            'relations',
            'validate',
            'merge',
            'done'
        ],
        stageMeta: {
            chunk: {
                label: 'Document Chunking',
                icon: BookOpen,
                description: 'Splitting documents into digestible pieces'
            },
            terms: {
                label: 'Term Extraction',
                icon: Search,
                description: 'Identifying domain concepts from text'
            },
            classify: {
                label: 'Classification',
                icon: Layers,
                description: 'Refining types: categories vs instances'
            },
            base_resolve: {
                label: 'Base Resolution',
                icon: Link2,
                description: 'Resolving terms against base vocabularies'
            },
            taxonomy: {
                label: 'Taxonomy Building',
                icon: GitBranch,
                description: 'Organizing into IS-A hierarchy'
            },
            relations: {
                label: 'Relationship Discovery',
                icon: Merge,
                description: 'Finding connections between concepts'
            },
            validate: {
                label: 'AI Quality Review',
                icon: Shield,
                description: 'Metacognitive consistency checks'
            },
            merge: {
                label: 'Graph Integration',
                icon: Sparkles,
                description: 'Writing knowledge into the graph'
            }
        }
    },
    deduplicate: {
        label: 'Deduplicate',
        color: 'amber',
        stages: ['embed', 'compare', 'propose', 'done'],
        stageMeta: {
            embed: {
                label: 'Embedding',
                icon: Fingerprint,
                description: 'Computing semantic fingerprints for all nodes'
            },
            compare: {
                label: 'Comparison',
                icon: Copy,
                description: 'Finding similar pairs above threshold'
            },
            propose: {
                label: 'Proposals',
                icon: ClipboardCheck,
                description: 'Creating merge proposals for review'
            }
        }
    },
    map: {
        label: 'Map',
        color: 'violet',
        stages: ['scan', 'embed', 'evaluate', 'propose', 'done'],
        stageMeta: {
            scan: {
                label: 'Scanning',
                icon: Search,
                description: 'Discovering unmapped nodes and base layers'
            },
            embed: {
                label: 'Embedding',
                icon: Fingerprint,
                description: 'Computing embeddings for matching'
            },
            evaluate: {
                label: 'LLM Evaluation',
                icon: Brain,
                description: 'AI classifying match types (same/is_a/related)'
            },
            propose: {
                label: 'Proposals',
                icon: ClipboardCheck,
                description: 'Creating mapping proposals for review'
            }
        }
    },
    review: {
        label: 'Review',
        color: 'green',
        stages: ['generate', 'await_response', 'parse', 'apply', 'done'],
        stageMeta: {
            generate: {
                label: 'Generating',
                icon: FileCheck,
                description: 'Packaging items for external review'
            },
            await_response: {
                label: 'Awaiting Response',
                icon: Inbox,
                description: 'Waiting for reviewer feedback'
            },
            parse: {
                label: 'Parsing',
                icon: Code2,
                description: 'Processing reviewer decisions'
            },
            apply: {
                label: 'Applying',
                icon: CheckSquare,
                description: 'Applying approved decisions to graph'
            }
        }
    }
};

/** Get stage metadata for any pipeline type */
function getStageMeta(type: PipelineType, stage: string) {
    return (
        PIPELINE_TYPE_DEFS[type]?.stageMeta[stage] || {
            label: stage,
            icon: Sparkles,
            description: ''
        }
    );
}

/** Get stages (excluding 'done') for progress bar */
function getVisibleStages(type: PipelineType): string[] {
    return (PIPELINE_TYPE_DEFS[type]?.stages || []).filter(s => s !== 'done');
}

const TYPE_BADGE_COLORS: Record<PipelineType, string> = {
    extract: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    deduplicate: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    map: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    review: 'bg-green-500/10 text-green-400 border-green-500/20'
};

const TYPE_PROGRESS_COLORS: Record<
    PipelineType,
    { complete: string; current: string; label: string; labelCurrent: string }
> = {
    extract: {
        complete: 'bg-emerald-500',
        current: 'bg-emerald-500/50',
        label: 'text-emerald-400',
        labelCurrent: 'text-emerald-400/70'
    },
    deduplicate: {
        complete: 'bg-amber-500',
        current: 'bg-amber-500/50',
        label: 'text-amber-400',
        labelCurrent: 'text-amber-400/70'
    },
    map: {
        complete: 'bg-violet-500',
        current: 'bg-violet-500/50',
        label: 'text-violet-400',
        labelCurrent: 'text-violet-400/70'
    },
    review: {
        complete: 'bg-green-500',
        current: 'bg-green-500/50',
        label: 'text-green-400',
        labelCurrent: 'text-green-400/70'
    }
};

interface PipelineLog {
    id: number;
    job_id: number;
    stage: string;
    level: string;
    title: string;
    detail: string | null;
    meta: string | null;
    created_at: string;
}

import { useProjectContext } from '../context';

export function JobsTab() {
    const ctx = useProjectContext();
    const { jobs, loadJobs, projectId } = ctx;
    const onRetry = () => loadJobs();
    const [expandedJob, setExpandedJob] = useState<number | null>(null);
    const [viewMode, setViewMode] = useState<'timeline' | 'raw'>('timeline');
    const [logs, setLogs] = useState<Record<number, PipelineLog[]>>({});

    // Auto-expand the first running or most recent job — only on initial load
    const hasAutoExpanded = useRef(false);
    useEffect(() => {
        if (hasAutoExpanded.current || jobs.length === 0) return;
        hasAutoExpanded.current = true;
        const running = jobs.find(j => j.status === 'running');
        if (running) setExpandedJob(running.id);
        else setExpandedJob(jobs[0].id);
    }, [jobs]);

    // Load logs for expanded job
    const loadLogs = useCallback(async (jobId: number) => {
        const res = await fetch(`/app/api/ontologica/jobs/${jobId}/logs`);
        if (res.ok) {
            const data = await res.json();
            setLogs(prev => ({ ...prev, [jobId]: data }));
        }
    }, []);

    useEffect(() => {
        if (expandedJob === null) return;
        loadLogs(expandedJob);
        // Poll logs while job is running
        const job = jobs.find(j => j.id === expandedJob);
        if (job?.status === 'running' || job?.status === 'queued') {
            const interval = setInterval(() => loadLogs(expandedJob), 2000);
            return () => clearInterval(interval);
        }
    }, [expandedJob, jobs, loadLogs]);

    const handleRetry = async (jobId: number) => {
        const res = await fetch(`/app/api/ontologica/jobs/${jobId}/retry`, {
            method: 'POST'
        });
        if (res.ok) onRetry();
    };

    const [aborting, setAborting] = useState<number | null>(null);
    const handleAbort = async (jobId: number) => {
        setAborting(jobId);
        try {
            await fetch(`/app/api/ontologica/jobs/${jobId}/abort`, {
                method: 'POST'
            });
            loadJobs();
        } finally {
            setTimeout(() => setAborting(null), 1000);
        }
    };

    const [launching, setLaunching] = useState<PipelineType | null>(null);

    const launchPipeline = async (
        type: PipelineType,
        config?: Record<string, any>
    ) => {
        setLaunching(type);
        try {
            const res = await fetch(
                `/app/api/ontologica/projects/${projectId}/pipelines`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, mode: 'supervised', config })
                }
            );
            if (res.ok) {
                loadJobs();
                const job = await res.json();
                setExpandedJob(job.id);
            }
        } finally {
            setLaunching(null);
        }
    };

    if (jobs.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-muted-foreground p-8">
                <div className="text-center">
                    <Clock size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="text-lg font-medium mb-1">
                        No pipeline jobs yet
                    </p>
                    <p className="text-sm mb-4">
                        Run a pipeline to process your ontology
                    </p>
                    <div className="flex items-center gap-2 justify-center">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => launchPipeline('deduplicate')}
                            disabled={!!launching}
                        >
                            <Copy size={14} className="mr-1.5 text-amber-400" />{' '}
                            Deduplicate
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => launchPipeline('map')}
                            disabled={!!launching}
                        >
                            <MapIcon
                                size={14}
                                className="mr-1.5 text-violet-400"
                            />{' '}
                            Map Layers
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    const failedCount = jobs.filter(j => j.status === 'failed').length;

    const handleDelete = async (jobId: number) => {
        const res = await fetch(`/app/api/ontologica/jobs/${jobId}`, {
            method: 'DELETE'
        });
        if (res.ok) onRetry();
    };

    const handleClearFailed = async () => {
        const res = await fetch(
            `/app/api/ontologica/projects/${projectId}/jobs/failed`,
            {
                method: 'DELETE'
            }
        );
        if (res.ok) onRetry();
    };

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Sticky controls bar */}
            <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-border/30 bg-background">
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => launchPipeline('deduplicate')}
                        disabled={!!launching}
                    >
                        {launching === 'deduplicate' ? (
                            <Loader2 size={12} className="mr-1 animate-spin" />
                        ) : (
                            <Copy size={12} className="mr-1 text-amber-400" />
                        )}
                        Deduplicate
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => launchPipeline('map')}
                        disabled={!!launching}
                    >
                        {launching === 'map' ? (
                            <Loader2 size={12} className="mr-1 animate-spin" />
                        ) : (
                            <MapIcon
                                size={12}
                                className="mr-1 text-violet-400"
                            />
                        )}
                        Map Layers
                    </Button>
                    {failedCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-red-400 hover:text-red-300"
                            onClick={handleClearFailed}
                        >
                            <Trash2 size={12} className="mr-1" /> Clear{' '}
                            {failedCount} Failed
                        </Button>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant={
                            viewMode === 'timeline' ? 'secondary' : 'ghost'
                        }
                        size="sm"
                        onClick={() => setViewMode('timeline')}
                        className="h-7 text-xs"
                    >
                        <Eye size={12} className="mr-1" /> Timeline
                    </Button>
                    <Button
                        variant={viewMode === 'raw' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setViewMode('raw')}
                        className="h-7 text-xs"
                    >
                        <Code2 size={12} className="mr-1" /> Raw Log
                    </Button>
                </div>
            </div>

            {/* Scrollable job list */}
            <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-3">
                {jobs.map(job => {
                    const stagesComplete: string[] = JSON.parse(
                        job.stages_complete || '[]'
                    );
                    const config = JSON.parse(job.config || '{}');
                    const issues = config.validation_issues || [];
                    const isExpanded = expandedJob === job.id;
                    const jobLogs = logs[job.id] || [];
                    const jobType = (job.type || 'extract') as PipelineType;
                    const typeDef = PIPELINE_TYPE_DEFS[jobType];
                    const typeColors = TYPE_PROGRESS_COLORS[jobType];

                    return (
                        <Card key={job.id} className="overflow-hidden">
                            <CardContent className="p-0">
                                {/* Job header — always visible */}
                                <div
                                    // oxlint-disable-next-line jsx_a11y/prefer-tag-over-role -- nested action buttons prevent using <button>
                                    role="button"
                                    tabIndex={0}
                                    className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                                    onClick={() =>
                                        setExpandedJob(
                                            isExpanded ? null : job.id
                                        )
                                    }
                                    onKeyDown={e => {
                                        if (
                                            e.key === 'Enter' ||
                                            e.key === ' '
                                        ) {
                                            e.preventDefault();
                                            setExpandedJob(
                                                isExpanded ? null : job.id
                                            );
                                        }
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        {isExpanded ? (
                                            <ChevronDown size={14} />
                                        ) : (
                                            <ChevronRight size={14} />
                                        )}
                                        <JobStatusIcon status={job.status} />
                                        <Badge
                                            variant="outline"
                                            className={`text-[10px] px-1.5 py-0 h-5 font-medium ${TYPE_BADGE_COLORS[jobType]}`}
                                        >
                                            {typeDef.label}
                                        </Badge>
                                        <span className="font-medium text-sm">
                                            #{job.id}
                                        </span>
                                        <JobStatusBadge status={job.status} />
                                        {job.status === 'running' &&
                                            job.pipeline_stage && (
                                                <span className="text-xs text-muted-foreground">
                                                    —{' '}
                                                    {
                                                        getStageMeta(
                                                            jobType,
                                                            job.pipeline_stage
                                                        ).label
                                                    }
                                                    {job.current_step && (
                                                        <span className="ml-1.5 text-muted-foreground/70">
                                                            ({job.current_step})
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {(job.status === 'running' ||
                                            job.status === 'queued') && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                                disabled={aborting === job.id}
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    handleAbort(job.id);
                                                }}
                                                title="Abort pipeline"
                                            >
                                                {aborting === job.id ? (
                                                    <>
                                                        <Loader2
                                                            size={12}
                                                            className="mr-1 animate-spin"
                                                        />{' '}
                                                        Aborting…
                                                    </>
                                                ) : (
                                                    <>
                                                        <StopCircle
                                                            size={12}
                                                            className="mr-1"
                                                        />{' '}
                                                        Abort
                                                    </>
                                                )}
                                            </Button>
                                        )}
                                        {job.status === 'completed' && (
                                            <span className="text-xs text-muted-foreground">
                                                {jobType === 'extract'
                                                    ? `${job.nodes_created} concepts · ${job.edges_created} relationships`
                                                    : job.current_step ||
                                                      `${job.nodes_created || 0} proposals`}
                                            </span>
                                        )}
                                        {job.status === 'failed' && (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 text-xs"
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        handleRetry(job.id);
                                                    }}
                                                >
                                                    <RotateCcw
                                                        size={12}
                                                        className="mr-1"
                                                    />{' '}
                                                    Retry
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 text-xs text-red-400 hover:text-red-300"
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        handleDelete(job.id);
                                                    }}
                                                >
                                                    <Trash2 size={12} />
                                                </Button>
                                            </>
                                        )}
                                        {job.status === 'completed' && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 text-xs text-muted-foreground hover:text-red-400"
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    handleDelete(job.id);
                                                }}
                                                title="Delete job"
                                            >
                                                <Trash2 size={12} />
                                            </Button>
                                        )}
                                        <span className="text-xs text-muted-foreground">
                                            {job.started_at
                                                ? new Date(
                                                      job.started_at
                                                  ).toLocaleString()
                                                : 'Queued'}
                                        </span>
                                    </div>
                                </div>

                                {/* Pipeline progress bar */}
                                <div className="px-4 pb-3">
                                    <div className="flex items-center gap-1">
                                        {getVisibleStages(jobType).map(
                                            stage => {
                                                const isComplete =
                                                    stagesComplete.includes(
                                                        stage
                                                    );
                                                const isCurrent =
                                                    job.pipeline_stage ===
                                                        stage &&
                                                    job.status === 'running';
                                                const sm = getStageMeta(
                                                    jobType,
                                                    stage
                                                );
                                                return (
                                                    <div
                                                        key={stage}
                                                        className="flex-1 flex flex-col items-center gap-1"
                                                    >
                                                        <div
                                                            className={`w-full h-2 rounded-full transition-colors ${
                                                                isComplete
                                                                    ? typeColors.complete
                                                                    : isCurrent
                                                                      ? `${typeColors.current} animate-pulse`
                                                                      : 'bg-muted'
                                                            }`}
                                                        />
                                                        <span
                                                            className={`text-[9px] leading-none ${
                                                                isComplete
                                                                    ? typeColors.label
                                                                    : isCurrent
                                                                      ? typeColors.labelCurrent
                                                                      : 'text-muted-foreground/50'
                                                            }`}
                                                        >
                                                            {
                                                                sm.label.split(
                                                                    ' '
                                                                )[0]
                                                            }
                                                        </span>
                                                    </div>
                                                );
                                            }
                                        )}
                                    </div>
                                    {/* Live progress detail for running jobs */}
                                    {job.status === 'running' &&
                                        job.current_step && (
                                            <div className="flex items-center gap-2 mt-2">
                                                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-500 ${typeColors.complete}`}
                                                        style={{
                                                            width: `${job.progress_pct || 0}%`
                                                        }}
                                                    />
                                                </div>
                                                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                                                    {job.progress_pct || 0}%
                                                </span>
                                            </div>
                                        )}
                                </div>

                                {/* Expanded content */}
                                {isExpanded && (
                                    <div className="border-t">
                                        {viewMode === 'timeline' ? (
                                            <TimelineView
                                                job={job}
                                                logs={jobLogs}
                                                stagesComplete={stagesComplete}
                                                validationIssues={issues}
                                                jobType={jobType}
                                            />
                                        ) : (
                                            <RawLogView
                                                logs={jobLogs}
                                                error={job.error}
                                            />
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function JobStatusIcon({ status }: { status: string }) {
    if (status === 'running')
        return <Loader2 size={16} className="animate-spin text-emerald-400" />;
    if (status === 'completed')
        return <CheckCircle2 size={16} className="text-emerald-400" />;
    if (status === 'failed')
        return <XCircle size={16} className="text-red-400" />;
    return <Clock size={16} className="text-amber-400" />;
}

function JobStatusBadge({ status }: { status: string }) {
    return (
        <Badge
            variant={
                status === 'completed'
                    ? 'default'
                    : status === 'failed'
                      ? 'destructive'
                      : 'secondary'
            }
        >
            {status}
        </Badge>
    );
}

function TimelineView({
    job,
    logs,
    stagesComplete,
    validationIssues,
    jobType = 'extract'
}: {
    job: any;
    logs: PipelineLog[];
    stagesComplete: string[];
    validationIssues: any[];
    jobType?: PipelineType;
}) {
    // Group logs by stage
    const stageGroups = new Map<string, PipelineLog[]>();
    for (const log of logs) {
        const existing = stageGroups.get(log.stage) || [];
        existing.push(log);
        stageGroups.set(log.stage, existing);
    }

    const typeDef = PIPELINE_TYPE_DEFS[jobType];
    const allStages = ['pipeline', ...typeDef.stages.filter(s => s !== 'done')];
    const visibleStages = allStages.filter(s => stageGroups.has(s));

    if (visibleStages.length === 0 && !job.error) {
        return (
            <div className="p-6 text-center text-muted-foreground text-sm">
                {job.status === 'queued'
                    ? 'Waiting to start...'
                    : 'No log data yet — pipeline is starting...'}
            </div>
        );
    }

    return (
        <div className="p-4 space-y-1">
            {visibleStages.map(stage => {
                const stageLogs = stageGroups.get(stage) || [];
                const meta = getStageMeta(jobType, stage);
                const isComplete = stagesComplete.includes(stage);
                const isCurrent =
                    job.pipeline_stage === stage && job.status === 'running';
                const StageIcon = meta?.icon || Sparkles;

                return (
                    <div key={stage} className="relative">
                        {/* Stage header */}
                        {stage !== 'pipeline' && (
                            <div className="flex items-center gap-2 py-2">
                                <div
                                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                                        isComplete
                                            ? 'bg-emerald-500/15 text-emerald-400'
                                            : isCurrent
                                              ? 'bg-emerald-500/10 text-emerald-400/70'
                                              : 'bg-muted text-muted-foreground'
                                    }`}
                                >
                                    {isCurrent ? (
                                        <Loader2
                                            size={14}
                                            className="animate-spin"
                                        />
                                    ) : (
                                        <StageIcon size={14} />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={`text-sm font-medium ${isComplete || isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}
                                        >
                                            {meta?.label || stage}
                                        </span>
                                        {isComplete && (
                                            <Badge
                                                variant="outline"
                                                className="text-[9px] border-emerald-500/30 text-emerald-400"
                                            >
                                                done
                                            </Badge>
                                        )}
                                        {isCurrent && (
                                            <Badge
                                                variant="outline"
                                                className="text-[9px] border-emerald-500/30 text-emerald-400 animate-pulse"
                                            >
                                                running
                                            </Badge>
                                        )}
                                    </div>
                                    {isCurrent && job.current_step ? (
                                        <p className="text-xs text-muted-foreground animate-pulse">
                                            {job.current_step}
                                        </p>
                                    ) : meta?.description ? (
                                        <p className="text-xs text-muted-foreground">
                                            {meta.description}
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        )}

                        {/* Log entries for this stage */}
                        <div
                            className={`space-y-1 ${stage !== 'pipeline' ? 'ml-9' : ''} mb-2`}
                        >
                            {stageLogs.map(entry => (
                                <LogEntry key={entry.id} log={entry} />
                            ))}
                        </div>
                    </div>
                );
            })}

            {/* Error display */}
            {job.error && (
                <div className="ml-0 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-2 mb-1">
                        <XCircle size={14} className="text-red-400" />
                        <span className="text-sm font-medium text-red-400">
                            Pipeline Failed
                        </span>
                    </div>
                    <p className="text-xs text-red-300 font-mono whitespace-pre-wrap">
                        {job.error}
                    </p>
                </div>
            )}

            {/* Validation issues summary */}
            {validationIssues.length > 0 && (
                <div className="ml-9 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-center gap-2 mb-2">
                        <Shield size={14} className="text-amber-400" />
                        <span className="text-sm font-medium text-amber-400">
                            {validationIssues.length} Validation Notes
                        </span>
                    </div>
                    <div className="space-y-1.5">
                        {validationIssues.map((issue: any, idx: number) => (
                            <div
                                key={idx}
                                className="flex items-start gap-2 text-xs"
                            >
                                <Badge
                                    variant="outline"
                                    className={`text-[9px] shrink-0 mt-0.5 ${
                                        issue.severity === 'error'
                                            ? 'border-red-500/30 text-red-400'
                                            : 'border-amber-500/30 text-amber-400'
                                    }`}
                                >
                                    {issue.severity}
                                </Badge>
                                <div>
                                    <span className="font-medium">
                                        {issue.entity}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {' '}
                                        — {issue.description}
                                    </span>
                                    {issue.suggested_fix && (
                                        <p className="text-muted-foreground/70 mt-0.5">
                                            💡 {issue.suggested_fix}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function LogEntry({ log }: { log: PipelineLog }) {
    const [expanded, setExpanded] = useState(false);
    const hasDetail = log.detail && log.detail.length > 0;
    const meta = log.meta ? JSON.parse(log.meta) : null;

    const levelStyles: Record<string, string> = {
        milestone: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
        success: 'bg-emerald-500/5 border-emerald-500/10',
        info: 'bg-muted/30 border-transparent',
        warn: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
        error: 'bg-red-500/10 border-red-500/20 text-red-300'
    };

    const levelIcons: Record<string, string> = {
        milestone: '🎯',
        success: '✅',
        info: '📋',
        warn: '⚠️',
        error: '❌'
    };

    // Special treatment for rate-limit backoff entries
    const isRateLimit =
        log.level === 'warn' && log.title.includes('Rate limited');

    return (
        <div
            // oxlint-disable-next-line jsx_a11y/no-static-element-interactions -- conditionally interactive
            role={hasDetail ? 'button' : undefined}
            tabIndex={hasDetail ? 0 : undefined}
            className={`rounded-md border px-3 py-1.5 text-xs ${
                isRateLimit
                    ? 'bg-orange-500/10 border-orange-500/20 text-orange-300 animate-pulse'
                    : levelStyles[log.level] || levelStyles.info
            } ${hasDetail ? 'cursor-pointer' : ''}`}
            onClick={() => hasDetail && setExpanded(!expanded)}
            onKeyDown={e => {
                if (hasDetail && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setExpanded(!expanded);
                }
            }}
        >
            <div className="flex items-center gap-2">
                <span className="shrink-0">
                    {isRateLimit ? '⏳' : levelIcons[log.level] || '📋'}
                </span>
                <span className="flex-1 font-medium">{log.title}</span>
                {meta?.count !== undefined && (
                    <Badge variant="outline" className="text-[9px]">
                        {meta.count}
                    </Badge>
                )}
                {meta?.total !== undefined && meta?.chunk !== undefined && (
                    <Badge variant="outline" className="text-[9px]">
                        {meta.chunk}/{meta.total}
                    </Badge>
                )}
                <span className="text-muted-foreground text-[10px] shrink-0">
                    {new Date(log.created_at).toLocaleTimeString()}
                </span>
                {hasDetail && (
                    <span className="text-muted-foreground">
                        {expanded ? '▾' : '▸'}
                    </span>
                )}
            </div>
            {expanded && hasDetail && (
                <div className="mt-1.5 pt-1.5 border-t border-current/10 text-muted-foreground whitespace-pre-wrap font-mono text-[10px] leading-relaxed">
                    {log.detail}
                </div>
            )}
        </div>
    );
}

function RawLogView({ logs, error }: { logs: PipelineLog[]; error?: string }) {
    if (logs.length === 0 && !error) {
        return (
            <div className="p-6 text-center text-muted-foreground text-sm">
                No log data yet
            </div>
        );
    }

    return (
        <div className="p-4 font-mono text-xs space-y-0.5 max-h-125 overflow-y-auto bg-black/20">
            {logs.map(log => {
                const time = new Date(log.created_at).toLocaleTimeString();
                const levelColor: Record<string, string> = {
                    milestone: 'text-emerald-400',
                    success: 'text-green-400',
                    info: 'text-blue-400',
                    warn: 'text-amber-400',
                    error: 'text-red-400'
                };
                return (
                    <div key={log.id} className="flex gap-2 leading-relaxed">
                        <span className="text-muted-foreground shrink-0">
                            {time}
                        </span>
                        <span
                            className={`shrink-0 w-16 ${levelColor[log.level] || 'text-muted-foreground'}`}
                        >
                            [{log.level}]
                        </span>
                        <span className="text-muted-foreground shrink-0 w-20">
                            [{log.stage}]
                        </span>
                        <span className="text-foreground">{log.title}</span>
                        {log.detail && (
                            <span className="text-muted-foreground">
                                {' '}
                                — {log.detail}
                            </span>
                        )}
                    </div>
                );
            })}
            {error && (
                <div className="flex gap-2 leading-relaxed text-red-400">
                    <span className="shrink-0">ERROR</span>
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}
