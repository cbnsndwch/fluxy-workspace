import { useState, useEffect, useCallback, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2, CheckCircle2, XCircle, Clock, RotateCcw,
  ChevronDown, ChevronRight, Eye, Code2,
  Sparkles, GitBranch, Merge, Search, Shield, Layers, BookOpen,
  Trash2
} from 'lucide-react';

const STAGES = ['chunk', 'terms', 'classify', 'taxonomy', 'relations', 'validate', 'merge', 'done'];

const STAGE_META: Record<string, { label: string; icon: typeof Sparkles; description: string }> = {
  chunk:     { label: 'Document Chunking',       icon: BookOpen,  description: 'Splitting documents into digestible pieces for analysis' },
  terms:     { label: 'Term Extraction',         icon: Search,    description: 'AI reads each chunk and identifies domain concepts' },
  classify:  { label: 'Classification',          icon: Layers,    description: 'Refining which terms are categories vs specific instances' },
  taxonomy:  { label: 'Taxonomy Building',       icon: GitBranch, description: 'Organizing concepts into an IS-A hierarchy' },
  relations: { label: 'Relationship Discovery',  icon: Merge,     description: 'Finding connections between concepts' },
  validate:  { label: 'AI Quality Review',       icon: Shield,    description: 'Running metacognitive checks for consistency and completeness' },
  merge:     { label: 'Graph Integration',       icon: Sparkles,  description: 'Writing the extracted knowledge into the graph' },
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

import { useProjectContext } from './context';

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
    const res = await fetch(`/app/api/ontologica/jobs/${jobId}/retry`, { method: 'POST' });
    if (res.ok) onRetry();
  };

  if (jobs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground p-8">
        <div className="text-center">
          <Clock size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium mb-1">No extraction jobs</p>
          <p className="text-sm">Upload documents and click "Extract" to start the AI pipeline</p>
        </div>
      </div>
    );
  }

  const failedCount = jobs.filter(j => j.status === 'failed').length;

  const handleDelete = async (jobId: number) => {
    const res = await fetch(`/app/api/ontologica/jobs/${jobId}`, { method: 'DELETE' });
    if (res.ok) onRetry();
  };

  const handleClearFailed = async () => {
    const res = await fetch(`/app/api/ontologica/projects/${projectId}/jobs/failed`, { method: 'DELETE' });
    if (res.ok) onRetry();
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-3">
      {/* Controls bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-red-400 hover:text-red-300"
              onClick={handleClearFailed}
            >
              <Trash2 size={12} className="mr-1" /> Clear {failedCount} Failed
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={viewMode === 'timeline' ? 'secondary' : 'ghost'}
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

      {jobs.map(job => {
        const stagesComplete: string[] = JSON.parse(job.stages_complete || '[]');
        const config = JSON.parse(job.config || '{}');
        const issues = config.validation_issues || [];
        const isExpanded = expandedJob === job.id;
        const jobLogs = logs[job.id] || [];

        return (
          <Card key={job.id} className="overflow-hidden">
            <CardContent className="p-0">
              {/* Job header — always visible */}
              <button
                className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => setExpandedJob(isExpanded ? null : job.id)}
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <JobStatusIcon status={job.status} />
                  <span className="font-medium text-sm">Job #{job.id}</span>
                  <JobStatusBadge status={job.status} />
                  {job.status === 'running' && job.pipeline_stage && (
                    <span className="text-xs text-muted-foreground">
                      — {STAGE_META[job.pipeline_stage]?.label || job.pipeline_stage}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {job.status === 'completed' && (
                    <span className="text-xs text-muted-foreground">
                      {job.nodes_created} concepts · {job.edges_created} relationships
                    </span>
                  )}
                  {(job.status === 'failed') && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={(e) => { e.stopPropagation(); handleRetry(job.id); }}
                      >
                        <RotateCcw size={12} className="mr-1" /> Retry
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-red-400 hover:text-red-300"
                        onClick={(e) => { e.stopPropagation(); handleDelete(job.id); }}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </>
                  )}
                  {(job.status === 'completed') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground hover:text-red-400"
                      onClick={(e) => { e.stopPropagation(); handleDelete(job.id); }}
                      title="Delete job"
                    >
                      <Trash2 size={12} />
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {job.started_at ? new Date(job.started_at).toLocaleString() : 'Queued'}
                  </span>
                </div>
              </button>

              {/* Pipeline progress bar */}
              <div className="flex items-center gap-1 px-4 pb-3">
                {STAGES.filter(s => s !== 'done').map(stage => {
                  const isComplete = stagesComplete.includes(stage);
                  const isCurrent = job.pipeline_stage === stage && job.status === 'running';
                  return (
                    <div key={stage} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className={`w-full h-2 rounded-full transition-colors ${
                          isComplete ? 'bg-emerald-500' :
                          isCurrent ? 'bg-emerald-500/50 animate-pulse' :
                          'bg-muted'
                        }`}
                      />
                      <span className={`text-[9px] leading-none ${
                        isComplete ? 'text-emerald-400' :
                        isCurrent ? 'text-emerald-400/70' :
                        'text-muted-foreground/50'
                      }`}>
                        {STAGE_META[stage]?.label.split(' ')[0] || stage}
                      </span>
                    </div>
                  );
                })}
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
                    />
                  ) : (
                    <RawLogView logs={jobLogs} error={job.error} />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function JobStatusIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 size={16} className="animate-spin text-emerald-400" />;
  if (status === 'completed') return <CheckCircle2 size={16} className="text-emerald-400" />;
  if (status === 'failed') return <XCircle size={16} className="text-red-400" />;
  return <Clock size={16} className="text-amber-400" />;
}

function JobStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={
      status === 'completed' ? 'default' :
      status === 'failed' ? 'destructive' :
      'secondary'
    }>
      {status}
    </Badge>
  );
}

function TimelineView({ job, logs, stagesComplete, validationIssues }: {
  job: any;
  logs: PipelineLog[];
  stagesComplete: string[];
  validationIssues: any[];
}) {
  // Group logs by stage
  const stageGroups = new Map<string, PipelineLog[]>();
  for (const log of logs) {
    const existing = stageGroups.get(log.stage) || [];
    existing.push(log);
    stageGroups.set(log.stage, existing);
  }

  const allStages = ['pipeline', ...STAGES.filter(s => s !== 'done')];
  const visibleStages = allStages.filter(s => stageGroups.has(s));

  if (visibleStages.length === 0 && !job.error) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm">
        {job.status === 'queued' ? 'Waiting to start...' : 'No log data yet — pipeline is starting...'}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-1">
      {visibleStages.map(stage => {
        const stageLogs = stageGroups.get(stage) || [];
        const meta = STAGE_META[stage];
        const isComplete = stagesComplete.includes(stage);
        const isCurrent = job.pipeline_stage === stage && job.status === 'running';
        const StageIcon = meta?.icon || Sparkles;

        return (
          <div key={stage} className="relative">
            {/* Stage header */}
            {stage !== 'pipeline' && (
              <div className="flex items-center gap-2 py-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  isComplete ? 'bg-emerald-500/15 text-emerald-400' :
                  isCurrent ? 'bg-emerald-500/10 text-emerald-400/70' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {isCurrent ? <Loader2 size={14} className="animate-spin" /> : <StageIcon size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${isComplete || isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {meta?.label || stage}
                    </span>
                    {isComplete && <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">done</Badge>}
                    {isCurrent && <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 animate-pulse">running</Badge>}
                  </div>
                  {meta?.description && (
                    <p className="text-xs text-muted-foreground">{meta.description}</p>
                  )}
                </div>
              </div>
            )}

            {/* Log entries for this stage */}
            <div className={`space-y-1 ${stage !== 'pipeline' ? 'ml-9' : ''} mb-2`}>
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
            <span className="text-sm font-medium text-red-400">Pipeline Failed</span>
          </div>
          <p className="text-xs text-red-300 font-mono whitespace-pre-wrap">{job.error}</p>
        </div>
      )}

      {/* Validation issues summary */}
      {validationIssues.length > 0 && (
        <div className="ml-9 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={14} className="text-amber-400" />
            <span className="text-sm font-medium text-amber-400">{validationIssues.length} Validation Notes</span>
          </div>
          <div className="space-y-1.5">
            {validationIssues.map((issue: any, idx: number) => (
              <div key={idx} className="flex items-start gap-2 text-xs">
                <Badge variant="outline" className={`text-[9px] shrink-0 mt-0.5 ${
                  issue.severity === 'error' ? 'border-red-500/30 text-red-400' : 'border-amber-500/30 text-amber-400'
                }`}>
                  {issue.severity}
                </Badge>
                <div>
                  <span className="font-medium">{issue.entity}</span>
                  <span className="text-muted-foreground"> — {issue.description}</span>
                  {issue.suggested_fix && (
                    <p className="text-muted-foreground/70 mt-0.5">💡 {issue.suggested_fix}</p>
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
    success:   'bg-emerald-500/5 border-emerald-500/10',
    info:      'bg-muted/30 border-transparent',
    warn:      'bg-amber-500/10 border-amber-500/20 text-amber-300',
    error:     'bg-red-500/10 border-red-500/20 text-red-300',
  };

  const levelIcons: Record<string, string> = {
    milestone: '🎯',
    success: '✅',
    info: '📋',
    warn: '⚠️',
    error: '❌',
  };

  // Special treatment for rate-limit backoff entries
  const isRateLimit = log.level === 'warn' && log.title.includes('Rate limited');

  return (
    <div
      className={`rounded-md border px-3 py-1.5 text-xs ${
        isRateLimit ? 'bg-orange-500/10 border-orange-500/20 text-orange-300 animate-pulse' :
        (levelStyles[log.level] || levelStyles.info)
      } ${hasDetail ? 'cursor-pointer' : ''}`}
      onClick={() => hasDetail && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0">{isRateLimit ? '⏳' : (levelIcons[log.level] || '📋')}</span>
        <span className="flex-1 font-medium">{log.title}</span>
        {meta?.count !== undefined && (
          <Badge variant="outline" className="text-[9px]">{meta.count}</Badge>
        )}
        {meta?.total !== undefined && meta?.chunk !== undefined && (
          <Badge variant="outline" className="text-[9px]">{meta.chunk}/{meta.total}</Badge>
        )}
        <span className="text-muted-foreground text-[10px] shrink-0">
          {new Date(log.created_at).toLocaleTimeString()}
        </span>
        {hasDetail && (
          <span className="text-muted-foreground">{expanded ? '▾' : '▸'}</span>
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
    <div className="p-4 font-mono text-xs space-y-0.5 max-h-[500px] overflow-y-auto bg-black/20">
      {logs.map(log => {
        const time = new Date(log.created_at).toLocaleTimeString();
        const levelColor: Record<string, string> = {
          milestone: 'text-emerald-400',
          success: 'text-green-400',
          info: 'text-blue-400',
          warn: 'text-amber-400',
          error: 'text-red-400',
        };
        return (
          <div key={log.id} className="flex gap-2 leading-relaxed">
            <span className="text-muted-foreground shrink-0">{time}</span>
            <span className={`shrink-0 w-16 ${levelColor[log.level] || 'text-muted-foreground'}`}>
              [{log.level}]
            </span>
            <span className="text-muted-foreground shrink-0 w-20">[{log.stage}]</span>
            <span className="text-foreground">{log.title}</span>
            {log.detail && <span className="text-muted-foreground"> — {log.detail}</span>}
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
