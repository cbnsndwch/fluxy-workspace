import type { WorkflowNodeType, NodeConfig } from "./types";

export interface NodeMeta {
  label: string;
  description: string;
  color: string; // text color class
  bg: string; // background tint class
  border: string; // border color class
  accent: string; // left accent color (tailwind arbitrary or hex)
  icon: string; // lucide icon name
  defaultConfig: NodeConfig;
}

export const NODE_REGISTRY: Record<WorkflowNodeType, NodeMeta> = {
  trigger: {
    label: "Trigger",
    description: "Starting point — runs on demand",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    accent: "#10b981",
    icon: "Play",
    defaultConfig: { label: "Start", initial_data: "{}" } as import("./types").TriggerConfig,
  },
  cron_trigger: {
    label: "Cron Trigger",
    description: "Schedule workflow on a cron expression",
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
    accent: "#f43f5e",
    icon: "Clock",
    defaultConfig: {
      label: "Scheduled",
      schedule: "0 * * * *",
      initial_data: "{}",
    } as import("./types").CronTriggerConfig,
  },
  http_request: {
    label: "HTTP Request",
    description: "Fetch any URL — supports {{interpolation}}",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    accent: "#3b82f6",
    icon: "Globe",
    defaultConfig: {
      url: "",
      method: "GET",
      headers: "{}",
      body: "",
      output_key: "response",
    } as import("./types").HttpRequestConfig,
  },
  code: {
    label: "Code",
    description: "Transform data with sandboxed JS",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    accent: "#f59e0b",
    icon: "Code2",
    defaultConfig: { code: "return input;", output_key: "result" } as import("./types").CodeConfig,
  },
  transform: {
    label: "Transform",
    description: "Single JS expression — no return needed",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    accent: "#f97316",
    icon: "Zap",
    defaultConfig: {
      expression: "input",
      output_key: "transformed",
    } as import("./types").TransformConfig,
  },
  condition: {
    label: "Condition",
    description: "Branch on a JS boolean expression",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    accent: "#8b5cf6",
    icon: "GitBranch",
    defaultConfig: { expression: "input.status === 200" } as import("./types").ConditionConfig,
  },
  db_query: {
    label: "DB Query",
    description: "Run SQL against the workspace database",
    color: "text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/30",
    accent: "#14b8a6",
    icon: "Database",
    defaultConfig: {
      query: "SELECT * FROM workflows LIMIT 10",
      params: "[]",
      output_key: "db_result",
    } as import("./types").DbQueryConfig,
  },
  log: {
    label: "Log",
    description: "Capture & display a value",
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    accent: "#94a3b8",
    icon: "Terminal",
    defaultConfig: { message: "{{$input}}" } as import("./types").LogConfig,
  },
};

export const NODE_ORDER: WorkflowNodeType[] = [
  "trigger",
  "cron_trigger",
  "http_request",
  "code",
  "transform",
  "condition",
  "db_query",
  "log",
];
