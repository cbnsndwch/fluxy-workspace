---
name: loopify
description: Read a PRD or assessment doc and generate a loop-optimized continuation prompt that drives iterative implementation across multiple sessions.
argument-hint: <path-to-prd-or-assessment-doc>
---

You are generating a **loop-optimized continuation prompt** — a structured document that an agent picks up at the start of each session, works through, and updates before ending. The loop runs until the project is complete.

## Input

Read the file at `$ARGUMENTS`. This is the PRD, assessment, or spec that defines what needs to be built. Understand:

1. **What is being built** — the deliverable
2. **Where it lives** — repo paths, packages, apps
3. **Tech stack** — frameworks, libraries, patterns
4. **Scope** — what's in v1/alpha vs deferred
5. **Dependencies** — what blocks what

Also read `CLAUDE.md` at the repo root for project conventions (commit format, tooling, terminology, formatting rules). These must be embedded in the output prompt so every session follows them.

## What to Generate

Write a markdown file to the same directory as the input file, named with a numeric prefix one higher than the input file (e.g., if input is `03-comparison.md`, output is `04-continuation-prompt.md`). If a continuation prompt already exists, overwrite it.

The output file MUST follow this exact structure:

---

### Section 1: Title + Iteration Counter

```markdown
# Continuation Prompt — {Project Name} (Iteration 1)

Continue {one-line description of the work}.
```

The iteration number gets incremented by the agent at the end of each session.

### Section 2: Repository Layout

```markdown
## Repository Layout

{tree of relevant directories with one-line descriptions}
```

Only paths the agent will read or write to. Include path aliases.

### Section 3: What Was Accomplished

```markdown
## What Was Accomplished in the Previous Session

{Initially empty or describes any existing work. Each session appends its accomplishments here.}

### Build status

{Build/lint/test pass/fail status}
```

This section is the running log. When an agent finishes a session, it moves completed items from "Remaining Work" into this section and updates the build status.

### Section 4: Current Status Table

```markdown
## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| {component} | **done** / **partial** / **not started** | {detail} |
```

One row per deliverable component. Agents update this table as work completes. Include an overall progress percentage at the bottom.

### Section 5: Remaining Work (Tiered)

```markdown
## Remaining Work (Prioritized)

### TIER 1 — {description} (blocks Tier 2)

{Concrete file list with exact paths, method signatures, endpoint specs, data shapes.}

### TIER 2 — {description} (depends on Tier 1)

{Same level of specificity.}

### TIER 3 — {description}
...
```

**Critical rules for this section:**
- **Tier by dependency order** — Tier 1 unblocks Tier 2, etc. If items are independent, they share a tier.
- **Concrete file paths** — not "create a service" but "create `apps/server/src/widget/widget.service.ts`"
- **Exact signatures** — not "add a method to fetch config" but "`getConfig(accountId: string): Promise<WidgetConfig>`"
- **Endpoint specs** — method, path, auth, request body shape, response shape
- **Schema fields** — exact field names, types, defaults, indexes
- **No vague instructions** — every item should be implementable without asking clarifying questions

### Section 6: Strategy for This Session

```markdown
## Strategy for This Session

1. {Numbered step — what to do first and why}
2. {Next step — what can run in parallel}
3. {Verification step — build/lint/test commands}

After completing work, **update this file**: move completed items to "What Was Accomplished", update the status table, increment the iteration number, and adjust this strategy section for the next session.
```

The self-update instruction is mandatory. It's what makes the loop work.

### Section 7: Key Architecture Reminders

```markdown
## Key Architecture Reminders

- {Bullet list of conventions, patterns, and gotchas that every session needs}
```

Pull from `CLAUDE.md` and the input doc. Include:
- Package manager + version pinning
- Formatter + linter (tool names, key rules)
- Testing framework
- Module/component patterns to follow
- Terminology translations (if any)
- Commit message format
- Attribution rules (no AI mentions, etc.)
- Existing services/modules the new code integrates with

---

## Quality Checklist

Before writing the file, verify:

- [ ] Every "not started" component from the PRD has a corresponding tier entry
- [ ] Tiers are ordered by dependency (nothing in Tier 2 can start before Tier 1)
- [ ] File paths are absolute from the repo root (e.g., `apps/server/src/widget/widget.service.ts`)
- [ ] Method signatures include parameter types and return types
- [ ] API endpoints specify method, path, auth requirement, request/response shapes
- [ ] The strategy section tells the agent exactly what to parallelize
- [ ] The self-update instruction is present
- [ ] Conventions from CLAUDE.md are embedded (not referenced — the prompt must be self-contained)
- [ ] No placeholders like "TBD" or "figure out later" — if something is unknown, mark it as an open question with a suggested default

## Output

Write the continuation prompt file using the Write tool. Report the file path and a one-line summary when done.
