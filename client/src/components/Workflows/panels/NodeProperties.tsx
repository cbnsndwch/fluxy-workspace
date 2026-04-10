import { type Node } from "@xyflow/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X, Trash2 } from "lucide-react";
import { NODE_REGISTRY } from "../nodeRegistry";
import type { WorkflowNodeType } from "../types";

interface Props {
  node: Node;
  onChange: (id: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: () => void;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/50">{hint}</p>}
    </div>
  );
}

const INTERP_HINT = "Use {{key}} or {{key.nested}} to insert context values";
const CRON_EXAMPLES =
  "*/5 * * * * — every 5 min  ·  0 9 * * 1-5 — 9am weekdays  ·  0 0 * * * — midnight daily";

export default function NodeProperties({ node, onChange, onClose, onDelete }: Props) {
  const type = node.type as WorkflowNodeType;
  const meta = NODE_REGISTRY[type];
  const d = node.data as Record<string, string>;

  const set = (key: string, value: string) => onChange(node.id, { ...node.data, [key]: value });

  return (
    <div className="w-[260px] shrink-0 border-l border-border bg-card/50 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className={`px-3 py-3 border-b border-border flex items-center gap-2 ${meta.bg}`}>
        <span className={`text-xs font-semibold ${meta.color} flex-1`}>{meta.label} Config</span>
        <button
          onClick={onClose}
          className="cursor-pointer p-0.5 rounded hover:bg-black/20 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-3 space-y-3 flex-1">
        {/* ── Trigger ────────────────────────────────────────────── */}
        {type === "trigger" && (
          <>
            <Field label="Label">
              <Input
                value={d.label || ""}
                onChange={(e) => set("label", e.target.value)}
                placeholder="Start"
                className="h-7 text-xs"
              />
            </Field>
            <Field label="Initial Data (JSON)">
              <Textarea
                value={d.initial_data || "{}"}
                onChange={(e) => set("initial_data", e.target.value)}
                rows={4}
                className="text-xs font-mono resize-none"
                placeholder="{}"
              />
            </Field>
          </>
        )}

        {/* ── Cron Trigger ───────────────────────────────────────── */}
        {type === "cron_trigger" && (
          <>
            <Field label="Label">
              <Input
                value={d.label || ""}
                onChange={(e) => set("label", e.target.value)}
                placeholder="Scheduled"
                className="h-7 text-xs"
              />
            </Field>
            <Field label="Cron Schedule" hint={CRON_EXAMPLES}>
              <Input
                value={d.schedule || ""}
                onChange={(e) => set("schedule", e.target.value)}
                placeholder="0 * * * *"
                className="h-7 text-xs font-mono"
              />
            </Field>
            <Field label="Initial Data (JSON)" hint="Injected as $input on each run">
              <Textarea
                value={d.initial_data || "{}"}
                onChange={(e) => set("initial_data", e.target.value)}
                rows={3}
                className="text-xs font-mono resize-none"
                placeholder="{}"
              />
            </Field>
            <div className="text-[10px] text-rose-400/70 bg-rose-500/5 border border-rose-500/20 rounded p-2">
              ⏱ Scheduler checks every 30 seconds. Minimum granularity: 1 minute.
            </div>
          </>
        )}

        {/* ── HTTP Request ───────────────────────────────────────── */}
        {type === "http_request" && (
          <>
            <Field label="URL" hint={INTERP_HINT}>
              <Input
                value={d.url || ""}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://api.example.com/{{id}}"
                className="h-7 text-xs"
              />
            </Field>
            <Field label="Method">
              <Select value={d.method || "GET"} onValueChange={(v) => set("method", v)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Headers (JSON)" hint={INTERP_HINT}>
              <Textarea
                value={d.headers || "{}"}
                onChange={(e) => set("headers", e.target.value)}
                rows={3}
                className="text-xs font-mono resize-none"
                placeholder={'{\n  "Authorization": "Bearer {{token}}"\n}'}
              />
            </Field>
            {["POST", "PUT", "PATCH"].includes(d.method || "GET") && (
              <Field label="Body (JSON)" hint={INTERP_HINT}>
                <Textarea
                  value={d.body || ""}
                  onChange={(e) => set("body", e.target.value)}
                  rows={3}
                  className="text-xs font-mono resize-none"
                  placeholder={'{\n  "name": "{{response.user}}"\n}'}
                />
              </Field>
            )}
            <Field label="Output Key">
              <Input
                value={d.output_key || "response"}
                onChange={(e) => set("output_key", e.target.value)}
                className="h-7 text-xs font-mono"
              />
            </Field>
          </>
        )}

        {/* ── Code ──────────────────────────────────────────────── */}
        {type === "code" && (
          <>
            <Field label="JavaScript Code">
              <Textarea
                value={d.code || "return input;"}
                onChange={(e) => set("code", e.target.value)}
                rows={8}
                className="text-xs font-mono resize-none"
                placeholder="return input;"
              />
            </Field>
            <div className="space-y-1 text-[10px] text-muted-foreground/70 bg-muted/30 rounded p-2">
              <p>
                Available: <span className="font-mono text-foreground/60">input</span> ·{" "}
                <span className="font-mono text-foreground/60">context</span>
              </p>
              <p className="text-green-400/70">✓ Sandboxed · Worker thread + vm · 5s timeout</p>
            </div>
            <Field label="Output Key">
              <Input
                value={d.output_key || "result"}
                onChange={(e) => set("output_key", e.target.value)}
                className="h-7 text-xs font-mono"
              />
            </Field>
          </>
        )}

        {/* ── Transform ─────────────────────────────────────────── */}
        {type === "transform" && (
          <>
            <Field
              label="Expression"
              hint="No 'return' needed — the expression value is the output"
            >
              <Textarea
                value={d.expression || "input"}
                onChange={(e) => set("expression", e.target.value)}
                rows={4}
                className="text-xs font-mono resize-none"
                placeholder="input.name.toUpperCase()"
              />
            </Field>
            <div className="space-y-1 text-[10px] text-muted-foreground/60 bg-muted/30 rounded p-2">
              <p className="font-medium text-foreground/50">Examples</p>
              <p className="font-mono">input.price * 1.21</p>
              <p className="font-mono">input.tags.join(', ')</p>
              <p className="font-mono">Object.keys(input)</p>
              <p className="font-mono">context.response.items[0]</p>
            </div>
            <Field label="Output Key">
              <Input
                value={d.output_key || "transformed"}
                onChange={(e) => set("output_key", e.target.value)}
                className="h-7 text-xs font-mono"
              />
            </Field>
          </>
        )}

        {/* ── Condition ─────────────────────────────────────────── */}
        {type === "condition" && (
          <>
            <Field label="Expression (JS boolean)">
              <Textarea
                value={d.expression || "false"}
                onChange={(e) => set("expression", e.target.value)}
                rows={4}
                className="text-xs font-mono resize-none"
                placeholder="input.status === 200"
              />
            </Field>
            <div className="space-y-1 text-[10px] text-muted-foreground/70 bg-muted/30 rounded p-2">
              <p>
                Available: <span className="font-mono text-foreground/60">input</span> ·{" "}
                <span className="font-mono text-foreground/60">context</span>
              </p>
              <p>
                Write plain JS — no <span className="font-mono text-foreground/60">{"{{}}"}</span>{" "}
                needed
              </p>
              <p className="text-emerald-400/70">
                ✓ true path · <span className="text-red-400/70">✗ false path</span>
              </p>
            </div>
          </>
        )}

        {/* ── DB Query ──────────────────────────────────────────── */}
        {type === "db_query" && (
          <>
            <Field label="SQL Query" hint={INTERP_HINT}>
              <Textarea
                value={d.query || ""}
                onChange={(e) => set("query", e.target.value)}
                rows={5}
                className="text-xs font-mono resize-none"
                placeholder={"SELECT * FROM crm_contacts\nWHERE id = ?"}
              />
            </Field>
            <Field label="Params (JSON array)" hint="Use ? placeholders in the query">
              <Input
                value={d.params || "[]"}
                onChange={(e) => set("params", e.target.value)}
                className="h-7 text-xs font-mono"
                placeholder='[{{trigger.id}}, "active"]'
              />
            </Field>
            <div className="text-[10px] text-teal-400/70 bg-teal-500/5 border border-teal-500/20 rounded p-2 space-y-1">
              <p>SELECT → returns row array</p>
              <p>INSERT/UPDATE/DELETE → returns {`{ changes, lastInsertRowid }`}</p>
            </div>
            <Field label="Output Key">
              <Input
                value={d.output_key || "db_result"}
                onChange={(e) => set("output_key", e.target.value)}
                className="h-7 text-xs font-mono"
              />
            </Field>
          </>
        )}

        {/* ── Log ───────────────────────────────────────────────── */}
        {type === "log" && (
          <Field label="Message Template" hint={INTERP_HINT}>
            <Textarea
              value={d.message || "{{$input}}"}
              onChange={(e) => set("message", e.target.value)}
              rows={4}
              className="text-xs font-mono resize-none"
              placeholder="{{$input}}"
            />
          </Field>
        )}
      </div>

      {/* Footer — delete */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer gap-1.5"
          onClick={onDelete}
        >
          <Trash2 size={12} />
          Delete node
        </Button>
      </div>
    </div>
  );
}
