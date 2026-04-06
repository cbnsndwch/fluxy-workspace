---
name: daily-standup
description: Generates daily standup summaries by analyzing recent file changes, git history, and workspace activity. Use this skill when the user asks for a standup update, daily summary, progress report, or wants to know what changed recently.
---

# Daily Standup

## Overview

This skill generates concise daily standup reports by examining recent changes in the Fluxy workspace — git commits, file modifications, and project activity.

## When to Activate

- User asks for a "standup", "daily update", or "progress report"
- User asks "what changed recently?" or "what did I work on?"
- User wants a summary of recent activity

## How to Generate a Standup

1. **Check git log** for recent commits (last 24 hours or since last standup)
2. **Check modified files** using git status and diff
3. **Identify patterns**: new features, bug fixes, refactors, documentation

## Output Format

### Daily Standup — {date}

**Completed:**

- List of completed work items based on commits and changes

**In Progress:**

- Uncommitted changes or partially completed work

**Blockers:**

- Any issues identified from error logs or failing tests

**Next Steps:**

- Suggested priorities based on the current state of the project

## Rules

1. Keep it concise — no more than 2-3 bullet points per section
2. Focus on what matters — skip trivial changes like formatting
3. Use plain language — avoid overly technical jargon
4. Link to specific files when helpful
