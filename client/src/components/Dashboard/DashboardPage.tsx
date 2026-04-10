import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";

import { APPS } from "@/lib/appRegistry";

import { AppIdea, GROUP_COLORS, Stage, STAGE_STAMPS, tagColor } from "../AppIdeas/types";

const GRAVEYARD_STAGES: Stage[] = ["idea", "researching", "considering", "doing"];
const PER_PAGE_OPTIONS = [6, 12, 24];

const builtApps = APPS;

export async function loader() {
  const r = await fetch("/app/api/app-ideas");
  if (!r.ok) return { ideas: [] };
  const d = await r.json();
  return {
    ideas: (d.ideas ?? []).map((idea: AppIdea) => ({
      ...idea,
      tags: typeof idea.tags === "string" ? JSON.parse(idea.tags || "[]") : (idea.tags ?? []),
    })),
  };
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { ideas } = useLoaderData() as { ideas: AppIdea[] };
  const [stageFilter, setStageFilter] = useState<Stage | null>(null);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(6);

  // Same group→color mapping as the canvas
  const groupColorMap = (() => {
    const map: Record<string, string> = {};
    const groups = [...new Set(ideas.map((i) => i.group_name).filter(Boolean) as string[])];
    groups.forEach((g, i) => {
      map[g] = GROUP_COLORS[i % GROUP_COLORS.length];
    });
    return map;
  })();

  const graveyardIdeas = ideas.filter((i) => i.stage !== "built" && i.stage !== "dismissed");
  const filteredIdeas = stageFilter
    ? graveyardIdeas.filter((i) => i.stage === stageFilter)
    : graveyardIdeas;
  const totalPages = Math.max(1, Math.ceil(filteredIdeas.length / perPage));
  const pageIdeas = filteredIdeas.slice(page * perPage, (page + 1) * perPage);

  const setFilter = (stage: Stage | null) => {
    setStageFilter(stage);
    setPage(0);
  };
  const setPerPageValue = (n: number) => {
    setPerPage(n);
    setPage(0);
  };

  return (
    <div className="flex flex-col items-center justify-start min-h-full px-4 pt-12 sm:pt-20 pb-12 sm:pb-20">
      {/* ── Built Apps ───────────────────────────────────────────────── */}
      {builtApps.length > 0 && (
        <section className="w-full max-w-2xl mb-12">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
            Your apps
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {builtApps.map((app) => {
              const Icon = app.icon;
              return (
                <button
                  key={app.id}
                  onClick={() => navigate(app.path)}
                  className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-card/80 hover:border-primary/30 transition-all duration-200 active:scale-[0.98] text-left group cursor-pointer"
                >
                  <div className={`p-2.5 rounded-lg ${app.color}`}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <div className="font-semibold text-sm group-hover:text-primary transition-colors">
                      {app.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{app.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── App Ideas Grid ───────────────────────────────────────────── */}
      {graveyardIdeas.length > 0 && (
        <section className="w-full max-w-2xl mb-12">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground shrink-0">
              App Ideas
            </h2>
            {/* Stage filter toggle group */}
            <div className="flex items-center gap-1 flex-wrap flex-1">
              <button
                onClick={() => setFilter(null)}
                className={`cursor-pointer text-[10px] font-semibold px-2 py-0.5 rounded border transition-all ${
                  stageFilter === null
                    ? "bg-foreground/10 border-foreground/30 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
                }`}
              >
                All
              </button>
              {GRAVEYARD_STAGES.map((stage) => {
                const s = STAGE_STAMPS[stage];
                const active = stageFilter === stage;
                return (
                  <button
                    key={stage}
                    onClick={() => setFilter(active ? null : stage)}
                    style={
                      active
                        ? {
                            background: s.bg,
                            color: s.text,
                            borderColor: `${s.text}55`,
                          }
                        : {}
                    }
                    className={`cursor-pointer text-[10px] font-semibold font-mono uppercase tracking-wide px-2 py-0.5 rounded border transition-all ${
                      active
                        ? ""
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => navigate("/app-ideas")}
              className="cursor-pointer flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              View all <ArrowRight size={12} />
            </button>
          </div>

          {/* Cards */}
          {pageIdeas.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {pageIdeas.map((idea) => {
                const stamp = STAGE_STAMPS[idea.stage];
                return (
                  <button
                    key={idea.id}
                    onClick={() => navigate("/app-ideas")}
                    className="cursor-pointer flex flex-col gap-2 p-3.5 rounded-xl border border-border bg-card hover:bg-card/80 hover:border-primary/30 transition-all duration-200 active:scale-[0.98] text-left group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm leading-snug group-hover:text-primary transition-colors line-clamp-2">
                        {idea.name}
                      </span>
                      <span
                        style={{
                          background: stamp.bg,
                          color: stamp.text,
                          border: `1px solid ${stamp.text}33`,
                        }}
                        className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded font-mono uppercase tracking-wide"
                      >
                        {stamp.label}
                      </span>
                    </div>
                    {idea.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {idea.description}
                      </p>
                    )}
                    {(idea.group_name || idea.tags.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1 mt-auto">
                        {idea.group_name && (
                          <span
                            style={{
                              background: `${groupColorMap[idea.group_name]}22`,
                              color: groupColorMap[idea.group_name],
                              borderColor: `${groupColorMap[idea.group_name]}55`,
                            }}
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded border"
                          >
                            {idea.group_name}
                          </span>
                        )}
                        {idea.tags
                          .filter((t) => t !== idea.group_name)
                          .slice(0, 3)
                          .map((tag) => {
                            const c = tagColor(tag);
                            return (
                              <span
                                key={tag}
                                style={{
                                  background: `${c}22`,
                                  color: c,
                                  borderColor: `${c}44`,
                                }}
                                className="text-[10px] px-1.5 py-0.5 rounded border"
                              >
                                {tag}
                              </span>
                            );
                          })}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No ideas in this stage.
            </p>
          )}

          {/* Pagination footer */}
          {filteredIdeas.length > PER_PAGE_OPTIONS[0] && (
            <div className="flex items-center justify-between mt-3 gap-2">
              {/* Per-page */}
              <div className="flex items-center gap-1">
                {PER_PAGE_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setPerPageValue(n)}
                    className={`cursor-pointer text-[10px] font-semibold px-2 py-0.5 rounded border transition-all ${
                      perPage === n
                        ? "bg-foreground/10 border-foreground/30 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <span className="text-[10px] text-muted-foreground ml-1">per page</span>
              </div>
              {/* Page nav */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {page * perPage + 1}–{Math.min((page + 1) * perPage, filteredIdeas.length)} of{" "}
                  {filteredIdeas.length}
                </span>
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="cursor-pointer p-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={12} />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="cursor-pointer p-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Starter Suggestions ──────────────────────────────────────── */}
      {/* <StarterSuggestions /> */}
    </div>
  );
}
