import { Handle, Position } from '@xyflow/react';
import {
    CheckCircle2,
    Clock,
    Code2,
    Database,
    GitBranch,
    Globe,
    Loader2,
    Minus,
    Play,
    Terminal,
    X,
    XCircle,
    Zap
} from 'lucide-react';
import { memo } from 'react';

import { cn } from '../../../lib/utils';
import type { RunNodeStatus } from '../types';
import { useWorkflowActions } from '../workflowContext';

const ICONS = { Play, Globe, Code2, GitBranch, Terminal, Clock, Zap, Database };

interface BaseNodeProps {
    iconName: keyof typeof ICONS;
    label: string;
    typeName: string;
    color: string;
    bg: string;
    border: string;
    accent: string;
    preview?: string;
    selected?: boolean;
    isConnectable?: boolean;
    runStatus?: RunNodeStatus;
    hasTarget?: boolean;
    hasSource?: boolean;
    // Condition nodes have two source handles
    twoSources?: boolean;
    children?: React.ReactNode;
    nodeId?: string;
}

function StatusBadge({ status }: { status: RunNodeStatus }) {
    if (status === 'pending') return null;
    return (
        <div className="absolute -top-2 -right-2 z-10">
            {status === 'running' && (
                <Loader2 size={16} className="animate-spin text-blue-400" />
            )}
            {status === 'success' && (
                <CheckCircle2 size={16} className="text-emerald-400" />
            )}
            {status === 'error' && (
                <XCircle size={16} className="text-red-400" />
            )}
            {status === 'skipped' && (
                <Minus size={16} className="text-muted-foreground" />
            )}
        </div>
    );
}

export const BaseNode = memo(function BaseNode({
    iconName,
    label,
    typeName,
    color,
    bg,
    border,
    accent,
    preview,
    selected,
    isConnectable,
    runStatus,
    hasTarget = true,
    hasSource = true,
    twoSources = false,
    children,
    nodeId
}: BaseNodeProps) {
    const Icon = ICONS[iconName];
    const { deleteNode } = useWorkflowActions();

    return (
        <div
            className={cn(
                'relative w-55 rounded-lg border bg-card shadow-md transition-shadow',
                border,
                selected && 'shadow-lg ring-2',
                runStatus === 'running' && 'ring-2 ring-blue-400/60',
                runStatus === 'error' && 'ring-2 ring-red-400/60'
            )}
            style={
                selected
                    ? {
                          borderLeftColor: accent,
                          borderLeftWidth: 3,
                          boxShadow: `0 0 0 2px ${accent}40`
                      }
                    : { borderLeftColor: accent, borderLeftWidth: 3 }
            }
        >
            {runStatus && runStatus !== 'pending' && (
                <StatusBadge status={runStatus} />
            )}

            {/* Target handle */}
            {hasTarget && (
                <Handle
                    type="target"
                    position={Position.Left}
                    isConnectable={isConnectable}
                    className="w-3! h-3! border-2! border-border! bg-card! hover:bg-primary! transition-colors"
                />
            )}

            {/* Header */}
            <div
                className={cn(
                    'flex items-center gap-2 px-3 py-2.5 rounded-t-md',
                    bg
                )}
            >
                <div className={cn('shrink-0', color)}>
                    <Icon size={14} strokeWidth={2.5} />
                </div>
                <span className="text-xs font-semibold text-foreground truncate flex-1">
                    {label}
                </span>
                {selected && nodeId ? (
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            deleteNode(nodeId);
                        }}
                        className="cursor-pointer shrink-0 p-0.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                    >
                        <X size={12} />
                    </button>
                ) : (
                    <span
                        className={cn(
                            'text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded',
                            color,
                            bg,
                            'opacity-70'
                        )}
                    >
                        {typeName}
                    </span>
                )}
            </div>

            {/* Body */}
            <div className="px-3 py-2">
                {children ??
                    (preview ? (
                        <p className="text-xs text-muted-foreground truncate font-mono">
                            {preview}
                        </p>
                    ) : (
                        <p className="text-xs text-muted-foreground/40 italic">
                            no config
                        </p>
                    ))}
            </div>

            {/* Source handle(s) */}
            {hasSource && !twoSources && (
                <Handle
                    type="source"
                    position={Position.Right}
                    isConnectable={isConnectable}
                    className="w-3! h-3! border-2! border-border! bg-card! hover:bg-primary! transition-colors"
                />
            )}
            {twoSources && (
                <>
                    <Handle
                        type="source"
                        position={Position.Right}
                        id="true"
                        style={{ top: '35%' }}
                        isConnectable={isConnectable}
                        className="w-3! h-3! border-2! border-emerald-500! bg-card! hover:bg-emerald-500! transition-colors"
                    />
                    <Handle
                        type="source"
                        position={Position.Right}
                        id="false"
                        style={{ top: '65%' }}
                        isConnectable={isConnectable}
                        className="w-3! h-3! border-2! border-red-500! bg-card! hover:bg-red-500! transition-colors"
                    />
                </>
            )}
        </div>
    );
});
