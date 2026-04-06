export type WorkflowNodeType =
    | 'trigger'
    | 'cron_trigger'
    | 'http_request'
    | 'code'
    | 'transform'
    | 'condition'
    | 'db_query'
    | 'log';

export interface TriggerConfig { label: string; initial_data: string; }
export interface CronTriggerConfig { label: string; schedule: string; initial_data: string; }
export interface HttpRequestConfig { url: string; method: string; headers: string; body: string; output_key: string; }
export interface CodeConfig { code: string; output_key: string; }
export interface TransformConfig { expression: string; output_key: string; }
export interface ConditionConfig { expression: string; }
export interface DbQueryConfig { query: string; params: string; output_key: string; }
export interface LogConfig { message: string; }

export type NodeConfig =
    | TriggerConfig
    | CronTriggerConfig
    | HttpRequestConfig
    | CodeConfig
    | TransformConfig
    | ConditionConfig
    | DbQueryConfig
    | LogConfig;

export interface Workflow {
    id: string;
    name: string;
    description: string | null;
    nodes: string;
    edges: string;
    created_at: string;
    updated_at: string;
}

export type RunNodeStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface WorkflowRun {
    id: number;
    workflow_id: string;
    status: 'running' | 'success' | 'error';
    started_at: string;
    finished_at: string | null;
    trigger_data: string | null;
    error: string | null;
}

export interface WorkflowRunNode {
    id: number;
    run_id: number;
    node_id: string;
    node_type: string;
    status: RunNodeStatus;
    input: string | null;
    output: string | null;
    error: string | null;
    duration_ms: number | null;
    executed_at: string | null;
}
