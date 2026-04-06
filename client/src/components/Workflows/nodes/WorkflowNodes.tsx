// All workflow node types in one file
import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { RunNodeStatus } from '../types';

type WFNodeData = Record<string, unknown> & { runStatus?: RunNodeStatus };

export const TriggerNode = memo(function TriggerNode({ id, data, selected, isConnectable }: NodeProps) {
    const d = data as WFNodeData;
    return (
        <BaseNode
            iconName="Play"
            label={String(d.label || 'Trigger')}
            typeName="trigger"
            color="text-emerald-400"
            bg="bg-emerald-500/10"
            border="border-emerald-500/30"
            accent="#10b981"
            preview={d.initial_data ? `Data: ${String(d.initial_data).slice(0, 24)}` : 'No initial data'}
            selected={selected}
            isConnectable={isConnectable}
            runStatus={d.runStatus}
            hasTarget={false}
            nodeId={id}
        />
    );
});

export const CronTriggerNode = memo(function CronTriggerNode({ id, data, selected, isConnectable }: NodeProps) {
    const d = data as WFNodeData;
    return (
        <BaseNode
            iconName="Clock"
            label={String(d.label || 'Cron Trigger')}
            typeName="cron"
            color="text-rose-400"
            bg="bg-rose-500/10"
            border="border-rose-500/30"
            accent="#f43f5e"
            preview={d.schedule ? `⏱ ${String(d.schedule)}` : 'No schedule set'}
            selected={selected}
            isConnectable={isConnectable}
            runStatus={d.runStatus}
            hasTarget={false}
            nodeId={id}
        />
    );
});

export const HttpRequestNode = memo(function HttpRequestNode({ id, data, selected, isConnectable }: NodeProps) {
    const d = data as WFNodeData;
    const method = String(d.method || 'GET');
    const url = String(d.url || '');
    return (
        <BaseNode
            iconName="Globe"
            label="HTTP Request"
            typeName="http"
            color="text-blue-400"
            bg="bg-blue-500/10"
            border="border-blue-500/30"
            accent="#3b82f6"
            selected={selected}
            isConnectable={isConnectable}
            runStatus={d.runStatus}
            nodeId={id}
        >
            <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">{method}</span>
                    <span className="text-xs text-muted-foreground truncate font-mono">{url || 'no url'}</span>
                </div>
                {d.output_key && <p className="text-[10px] text-muted-foreground/60">→ {String(d.output_key)}</p>}
            </div>
        </BaseNode>
    );
});

export const CodeNode = memo(function CodeNode({ id, data, selected, isConnectable }: NodeProps) {
    const d = data as WFNodeData;
    const firstLine = String(d.code || 'return input;').split('\n')[0].slice(0, 30);
    return (
        <BaseNode
            iconName="Code2"
            label="Code"
            typeName="js"
            color="text-amber-400"
            bg="bg-amber-500/10"
            border="border-amber-500/30"
            accent="#f59e0b"
            selected={selected}
            isConnectable={isConnectable}
            runStatus={d.runStatus}
            nodeId={id}
        >
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-mono truncate">{firstLine}</p>
                {d.output_key && <p className="text-[10px] text-muted-foreground/60">→ {String(d.output_key)}</p>}
            </div>
        </BaseNode>
    );
});

export const TransformNode = memo(function TransformNode({ id, data, selected, isConnectable }: NodeProps) {
    const d = data as WFNodeData;
    const expr = String(d.expression || 'input').slice(0, 30);
    return (
        <BaseNode
            iconName="Zap"
            label="Transform"
            typeName="expr"
            color="text-orange-400"
            bg="bg-orange-500/10"
            border="border-orange-500/30"
            accent="#f97316"
            selected={selected}
            isConnectable={isConnectable}
            runStatus={d.runStatus}
            nodeId={id}
        >
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-mono truncate">{expr}</p>
                {d.output_key && <p className="text-[10px] text-muted-foreground/60">→ {String(d.output_key)}</p>}
            </div>
        </BaseNode>
    );
});

export const ConditionNode = memo(function ConditionNode({ id, data, selected, isConnectable }: NodeProps) {
    const d = data as WFNodeData;
    return (
        <BaseNode
            iconName="GitBranch"
            label="Condition"
            typeName="if"
            color="text-violet-400"
            bg="bg-violet-500/10"
            border="border-violet-500/30"
            accent="#8b5cf6"
            selected={selected}
            isConnectable={isConnectable}
            runStatus={d.runStatus}
            twoSources
            nodeId={id}
        >
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-mono truncate">{String(d.expression || 'false')}</p>
                <div className="flex gap-3 text-[10px]">
                    <span className="text-emerald-400">✓ true →</span>
                    <span className="text-red-400">✗ false →</span>
                </div>
            </div>
        </BaseNode>
    );
});

export const DbQueryNode = memo(function DbQueryNode({ id, data, selected, isConnectable }: NodeProps) {
    const d = data as WFNodeData;
    const preview = String(d.query || 'SELECT …').replace(/\s+/g, ' ').slice(0, 32);
    return (
        <BaseNode
            iconName="Database"
            label="DB Query"
            typeName="sql"
            color="text-teal-400"
            bg="bg-teal-500/10"
            border="border-teal-500/30"
            accent="#14b8a6"
            selected={selected}
            isConnectable={isConnectable}
            runStatus={d.runStatus}
            nodeId={id}
        >
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-mono truncate">{preview}</p>
                {d.output_key && <p className="text-[10px] text-muted-foreground/60">→ {String(d.output_key)}</p>}
            </div>
        </BaseNode>
    );
});

export const LogNode = memo(function LogNode({ id, data, selected, isConnectable }: NodeProps) {
    const d = data as WFNodeData;
    return (
        <BaseNode
            iconName="Terminal"
            label="Log"
            typeName="log"
            color="text-slate-400"
            bg="bg-slate-500/10"
            border="border-slate-500/30"
            accent="#94a3b8"
            preview={String(d.message || '{{$input}}')}
            selected={selected}
            isConnectable={isConnectable}
            runStatus={d.runStatus}
            hasSource={false}
            nodeId={id}
        />
    );
});

export const workflowNodeTypes = {
    trigger: TriggerNode,
    cron_trigger: CronTriggerNode,
    http_request: HttpRequestNode,
    code: CodeNode,
    transform: TransformNode,
    condition: ConditionNode,
    db_query: DbQueryNode,
    log: LogNode,
};
