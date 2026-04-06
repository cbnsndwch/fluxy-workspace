# Flow Capture

Speak your user flow — or type it — and watch AI render it as a live Mermaid diagram in real time. Sessions are persistent, so you can pick up where you left off, edit individual segments, and build on a flow across multiple conversations.

## Getting started

1. Open Flow Capture from the sidebar
2. Click **New Session** (or pick an existing one from the lobby)
3. Choose **Voice** or **Text** mode in the transcript panel
4. Start talking (or typing) — each pause or paragraph becomes a saved segment
5. When you're ready, hit **Regenerate** to produce a diagram from all segments

The session name is set automatically by AI once your first diagram generates. Click the name to rename it manually at any time.

## Two input modes

### Voice
Click **Start Recording** at the bottom of the transcript panel. Your browser's Speech Recognition API transcribes live. Each natural pause (~2.5s of silence) commits a segment. Click **Stop Recording** to end the session.

Works best for: real-time meetings, verbal walkthroughs, thinking out loud.

### Text
Switch to **Text** mode and paste or type your flow description. Paragraphs separated by blank lines each become their own segment. Press **⌘↵** (or **Ctrl↵**) to import without reaching for the mouse.

Works best for: importing written notes, refining an existing flow, mixed voice+text sessions.

## Transcript panel

- **Segments** — each committed chunk is shown as a numbered card with its timestamp
- **Edit** — click any card to open an edit modal (plain textarea). Saving marks the diagram stale
- **Delete** — hover a card to reveal the × button
- Segments scroll within the panel; the tabs and record button stay fixed

## Diagram panel

### Preview vs Source

Toggle between **Preview** and **Source** (Mermaid code) using the footer buttons.

**Preview** — the rendered Mermaid SVG on a dark canvas. Fully pannable and zoomable:
- Scroll wheel to zoom
- Click and drag to pan
- Footer controls: zoom in (+), zoom out (−), reset/fit

**Source** — a Monaco editor with Mermaid syntax highlighting. Edit the Mermaid code directly. Hit **Save** to persist and clear the stale flag.

### Stale state

The diagram does **not** auto-generate. When new segments arrive after a diagram has been generated, the footer shows an amber dot (*"New segments — diagram is stale"*). The **Regenerate** button turns amber. Click it to produce a fresh diagram from all current segments.

**Remix** generates from scratch without using the prior diagram as a starting point — useful if the diagram drifted from what you meant.

## Session lobby

`/flow-capture` shows all sessions as cards. Each card shows the session name, segment count, and age. Click a card to open the session. Hover to reveal a delete button.

## Tips

- **Start with Text, extend with Voice** — paste written notes → diagram appears → switch to Voice → keep talking to grow the flow
- **The sample script** — click ··· → "Try a Sample Script" to see a realistic speech example. Hit **Start Recording** inside the dialog to begin immediately
- **Branching flows** — Mermaid naturally handles conditionals. Speak "if the user does X" and the AI renders a branch
- **Remix when stuck** — if the diagram went in an odd direction, Remix regenerates from all segments without being anchored to the previous output
- **Source edits are persistent** — manual Mermaid edits survive page reloads (saved via PATCH to the session)

## Data model

```
flow_sessions   id, name, created_at, updated_at
flow_chunks     id, session_id, sequence, text, source (voice|text), created_at
flow_diagrams   id, session_id, mermaid_source, svg_content, created_at
```

Each session holds many chunks; the latest diagram per session is kept. All data is stored in the workspace SQLite database.
