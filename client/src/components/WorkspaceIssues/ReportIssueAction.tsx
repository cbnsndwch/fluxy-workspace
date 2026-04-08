import { useState } from 'react';
import { useNavigate } from 'react-router';
import { BotMessageSquare, Bug, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { IssueModal, REGISTRY_TO_ISSUE_ID, PRIORITY_META, STATUS_META, type Issue } from './IssueModal';
import { queryClient } from '@/lib/queryClient';

// ── Post-creation toast ────────────────────────────────────────────────────────
// Self-contained component so it can hold its own `dispatching` state.
// `navigate` is passed as a prop because this component is rendered by Sonner
// via toast.custom(), which runs outside the React Router context.
function IssueCreatedToast({ issue, toastId, navigate }: { issue: Issue; toastId: string | number; navigate: (path: string) => void }) {
    const [dispatching, setDispatching] = useState(false);
    const [dispatched, setDispatched] = useState(false);

    const priority = PRIORITY_META[issue.priority];
    const status = STATUS_META[issue.status];

    const handleGoToIssue = () => {
        toast.dismiss(toastId);
        navigate(`/issues/${issue.id}`);
    };

    const handleDispatch = async () => {
        if (dispatching || dispatched) return;
        setDispatching(true);
        try {
            await fetch('/app/api/issues/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ issueIds: [issue.id] }),
            });
            queryClient.invalidateQueries({ queryKey: ['issues'] });
            queryClient.invalidateQueries({ queryKey: ['dispatch-batches'] });
            setDispatched(true);
            setTimeout(() => toast.dismiss(toastId), 1500);
        } finally {
            setDispatching(false);
        }
    };

    return (
        <div className="w-80 rounded-xl border border-border bg-card shadow-lg p-3.5 space-y-2.5">
            {/* Header */}
            <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-500/15">
                    <svg className="h-3.5 w-3.5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground leading-snug">Issue #{issue.id} created</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">{issue.title}</p>
                </div>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border', status.color)}>
                    {status.icon}
                    {status.label}
                </span>
                <span className={cn('inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border', priority.color)}>
                    {priority.label}
                </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-0.5">
                <button
                    type="button"
                    onClick={handleGoToIssue}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium h-7 rounded-lg border border-border bg-muted/40 hover:bg-muted/80 text-foreground transition-colors cursor-pointer"
                >
                    <ExternalLink className="h-3 w-3" />
                    Go to issue
                </button>
                <button
                    type="button"
                    onClick={handleDispatch}
                    disabled={dispatching || dispatched}
                    className={cn(
                        'flex-1 flex items-center justify-center gap-1.5 text-xs font-medium h-7 rounded-lg border transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
                        dispatched
                            ? 'border-green-500/30 bg-green-500/10 text-green-500'
                            : 'border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-400'
                    )}
                >
                    <BotMessageSquare className="h-3 w-3" />
                    {dispatched ? 'Dispatched!' : dispatching ? 'Dispatching…' : 'Dispatch'}
                </button>
            </div>
        </div>
    );
}

// ── Report Issue Action ────────────────────────────────────────────────────────
/**
 * ReportIssueAction — workspace-injected header button.
 *
 * Renders a small "report issue" icon button in any app's header.
 * Clicking it opens the full IssueModal pre-filled with the current app.
 * On success, shows a confirmation toast with deep-link + dispatch actions.
 *
 * This component is provided by the WorkspaceIssues app but is rendered
 * by the workspace framework (workspaceExtensions) — individual apps never
 * import it directly.
 */
export function ReportIssueAction({ appId }: { appId: string }) {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();

    // Convert registry app ID to the issue-app ID format (e.g. "appideas" → "app-ideas")
    const issueAppId = REGISTRY_TO_ISSUE_ID[appId] ?? appId;

    return (
        <>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 cursor-pointer"
                            onClick={() => setOpen(true)}
                        >
                            <Bug className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Report an issue</TooltipContent>
                </Tooltip>
            </TooltipProvider>

            {open && (
                <IssueModal
                    issue={{ app: issueAppId }}
                    onClose={() => setOpen(false)}
                    onSave={(issue) => {
                        setOpen(false);
                        queryClient.invalidateQueries({ queryKey: ['issues'] });
                        toast.custom(
                            (t) => <IssueCreatedToast issue={issue} toastId={t} navigate={navigate} />,
                            { duration: 8000, position: 'bottom-right' }
                        );
                    }}
                />
            )}
        </>
    );
}
