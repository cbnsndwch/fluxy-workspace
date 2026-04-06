# Workflows

A visual node-based editor for building automated pipelines. Connect nodes together to fetch data, transform it, branch on conditions, and log results.

## Overview

Workflows live at `/workflows`. The list view shows all saved workflows as cards. Click **Open** (or the play icon) on a card to enter the editor for that workflow.

## Creating a Workflow

1. Click **New workflow** in the top-right
2. Give it a name and an optional description
3. You're dropped straight into the editor

## Editor

The editor is a full-screen canvas powered by React Flow.

- **Add a node** — open the node palette (sidebar or right-click) and drag a node type onto the canvas
- **Connect nodes** — drag from an output handle (right side of a node) to an input handle (left side of another)
- **Configure a node** — click a node to open its settings panel on the right
- **Delete** — select a node or edge and press `Backspace` / `Delete`
- **Pan** — click and drag the canvas background
- **Zoom** — scroll wheel or pinch on trackpad

Changes auto-save when you leave the editor.

## Node Types

| Node | Color | Purpose |
|------|-------|---------|
| **Trigger** | Green | Entry point — every workflow starts here. Carries an optional initial data payload (JSON). |
| **HTTP Request** | Blue | Fetch any URL. Supports GET/POST/etc., custom headers, and a body. Result stored under `output_key`. |
| **Code** | Amber | Transform data with a JavaScript snippet. Has access to `input` (previous node's output). Return value stored under `output_key`. |
| **Condition** | Violet | Branch the workflow with a JS expression (e.g. `input.status === 200`). Evaluates to true/false — connect different edges for each branch. |
| **Log** | Slate | Captures and displays a value. Supports `{{$input}}` template interpolation. Useful for debugging. |

## Data Flow

Each node receives the output of the node(s) connected to its input handle. The `output_key` field on HTTP Request and Code nodes controls the key name where their result is stored, so downstream nodes can reference it.

## Tips

- Start every workflow with a **Trigger** node — it's the required entry point
- Use **Log** nodes liberally while building to inspect intermediate values
- **Code** nodes are full JavaScript — you can use conditionals, array methods, JSON parsing, anything that runs in a sandboxed eval
- Workflows persist across restarts (stored in SQLite)
