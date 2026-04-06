# Working with Sebastian

Sebastian is the AI agent that lives in this workspace. He has full access to the filesystem, shell, internet, and all the APIs you've connected.

## What he can do

- **Build apps** — new pages, backend routes, database tables
- **Fix bugs** — read the code, understand the problem, patch it
- **Research** — search the web, read docs, summarize findings
- **Remember things** — write to memory files that persist across sessions
- **Run scheduled tasks** — CRON jobs and PULSE checks

## How to talk to him

Use the chat bubble in the bottom-right corner. He understands plain language — no special syntax needed.

### Examples

```
Add a dark mode toggle to the sidebar
```
```
The pipeline tab is showing wrong values — can you look into it?
```
```
Every morning at 9am, summarize my open workspace issues
```
```
Remember: I prefer tables over lists when displaying data
```

## Memory files

Sebastian maintains his memory in:

- `MYSELF.md` — his identity and operating principles
- `MYHUMAN.md` — what he knows about you
- `MEMORY.md` — long-term distilled knowledge
- `memory/YYYY-MM-DD.md` — daily logs

He reads these on every wake-up, so things you tell him persist.

## PULSE & CRON

- **PULSE** — he wakes up every 30 minutes by default to check in, do maintenance, and look for things to improve
- **CRON** — you can schedule specific tasks using natural language

Ask him: _"Remind me every Monday at 9am to review open issues"_
