export type Stage = "idea" | "researching" | "considering" | "doing" | "built" | "dismissed";

export interface AppIdea {
  id: number;
  name: string;
  description: string | null;
  stage: Stage;
  tags: string[];
  group_name: string | null;
  color: string | null;
  pos_x: number;
  pos_y: number;
  created_at: string;
  updated_at: string;
}

export interface AppIdeaConnection {
  id: number;
  source_id: number;
  target_id: number;
  label: string | null;
  strength: number;
}

export const STAGE_META: Record<
  Stage,
  { label: string; color: string; bg: string; border: string; dot: string }
> = {
  idea: {
    label: "Idea",
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    dot: "#94a3b8",
  },
  researching: {
    label: "Researching",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    dot: "#60a5fa",
  },
  considering: {
    label: "Considering",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    dot: "#a78bfa",
  },
  doing: {
    label: "Doing",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    dot: "#fb923c",
  },
  built: {
    label: "Built",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    dot: "#34d399",
  },
  dismissed: {
    label: "Won't Build",
    color: "text-zinc-500",
    bg: "bg-zinc-500/10",
    border: "border-zinc-500/30",
    dot: "#71717a",
  },
};

export const STAGE_STAMPS: Record<Stage, { bg: string; text: string; label: string }> = {
  idea: { bg: "#e0e7ff", text: "#4338ca", label: "Idea" },
  researching: { bg: "#fce7f3", text: "#be185d", label: "Researching" },
  considering: { bg: "#fef3c7", text: "#92400e", label: "Considering" },
  doing: { bg: "#d1fae5", text: "#065f46", label: "Doing" },
  built: { bg: "#dcfce7", text: "#14532d", label: "Built ✓" },
  dismissed: { bg: "#f4f4f5", text: "#71717a", label: "Won't Build" },
};

export const GROUP_COLORS = [
  "#6366f1",
  "#ec4899",
  "#14b8a6",
  "#f59e0b",
  "#3b82f6",
  "#84cc16",
  "#f43f5e",
  "#8b5cf6",
  "#06b6d4",
  "#d97706",
];

// TAG_COLORS: a softer palette distinct from GROUP_COLORS
export const TAG_COLORS = [
  "#64748b",
  "#7c3aed",
  "#0891b2",
  "#059669",
  "#b45309",
  "#be185d",
  "#7c2d12",
  "#1d4ed8",
  "#15803d",
  "#6d28d9",
];

/** Deterministically maps a tag string to a consistent color from TAG_COLORS */
export function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}
