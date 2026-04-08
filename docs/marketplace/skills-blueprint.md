# Skills Blueprint

Standard for creating, distributing, and installing skills on the agent platform.

---

## Core Principle

Skills are **plug-and-play instruction packages**. They do NOT directly integrate with the user's workspace — they teach the agent how to do something. The agent reads the instructions and adapts them to its own environment.

No two workspaces are alike. Skills must be written as general-purpose guides, not hardcoded integrations.

---

## Folder Structure

```
skill-name/
  .claude-plugin/
    plugin.json       # Claude SDK plugin manifest (required)
  skill.json          # marketplace manifest (required)
  SKILL.md            # main instructions (required)
  SCRIPT.md           # customer-facing prompt (optional, for channel skills)
  SETUP.md            # first-time setup guide (optional, for complex skills)
  CHANGELOG.md        # what changed from previous version (optional)
  assets/             # binaries, scripts, components, templates (optional)
    ffmpeg            # example: bundled binary
    mailer.py         # example: python script
    components/       # example: react components
      ThemeCard.tsx
```

### Required files

**`.claude-plugin/plugin.json`** — Claude Agent SDK plugin manifest. This is how the SDK discovers the skill natively. Skills are NOT injected into the system prompt manually — the SDK handles lazy loading and on-demand discovery.

```json
{
  "name": "skill-name",
  "version": "1.0.0",
  "description": "One-line description for SDK discovery index",
  "skills": "./"
}
```

The `"skills": "./"` tells the SDK that SKILL.md lives at the plugin root (not in a nested `skills/` subdirectory). This avoids ugly `workspace/skills/skill-name/skills/` nesting.

The SDK uses this to:
- Build a lightweight searchable index of all installed skills
- Load skill instructions on-demand (only when the agent needs them)
- Namespace skills to avoid collisions between plugins

**skill.json** — marketplace manifest (our custom metadata, NOT read by the SDK):
```json
{
  "name": "whatsapp-seller",
  "version": "2.0.0",
  "author": "newbot-official",
  "description": "Sell products via WhatsApp with Stripe payments",
  "depends": ["raw-whatsapp"],
  "env_keys": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  "customer_data": "whatsapp-seller-customers",
  "size": "245KB",
  "contains_binaries": false,
  "tags": ["whatsapp", "commerce", "stripe"]
}
```

Field reference:
- `name` — unique identifier, lowercase, hyphenated
- `version` — semver, used for marketplace listing (not for auto-update — each version is a separate purchase)
- `depends` — array of skill names this skill requires to be installed. **Max 1 level deep.** No transitive dependency chains
- `env_keys` — environment variables this skill needs in `workspace/.env`. Agent will check and prompt user during setup
- `customer_data` — directory name (relative to `workspace/`) where this skill stores per-customer data (e.g. `whatsapp-clinic-customers`). The supervisor reads this to pre-load customer memory before routing messages. Optional — only needed for customer-facing skills.
- `contains_binaries` — flag for marketplace audit
- `tags` — for marketplace search/filtering

**SKILL.md** — the main instruction file. Structure:

```markdown
# Skill Name

## What This Is
One paragraph. What capability this gives the agent.

## Dependencies
List of required skills and why.

## Setup
Step-by-step what the agent needs to do on first install:
- What to ask the human (API keys, tokens, preferences)
- Where to save config (workspace/.env)
- What to install via terminal (pip, npm, apt, brew)
- How to verify everything works

## Usage
How the agent uses this skill day-to-day:
- Available commands/scripts and what they do
- Expected inputs/outputs
- Where to store generated data (always workspace/, never inside skill folder)
- Error handling patterns

## Human Interaction
What the agent should tell/ask its human:
- What permissions are needed
- What the human needs to do manually (scan QR, approve OAuth, etc.)
- How to explain the skill's capabilities to the human

## Notes
Edge cases, gotchas, platform-specific instructions (Linux vs Mac vs Windows).
```

---

## Data Separation

**This is critical.** Skills are disposable. User data is not.

- `workspace/skills/skill-name/` — skill instructions and assets. Can be overwritten on update.
- `workspace/` — all generated data, user files, databases, logs. Never touched by skill install/update.

A skill MUST instruct the agent to store all runtime data in `workspace/`, never inside the skill folder. Each skill uses a **unique, skill-scoped directory** to avoid collisions with other skills. Examples:
- WhatsApp clinic data → `workspace/whatsapp-clinic-customers/`
- WhatsApp seller data → `workspace/whatsapp-seller-customers/`
- Generated images → `workspace/banana-image-gen-output/`
- Email lists → `workspace/python-mailer-data/`

The directory name is declared in `skill.json` → `customer_data` (for customer-facing skills) and documented in SKILL.md. The supervisor uses this field to pre-load customer memory before routing messages.

The skill chooses the convention and documents it in SKILL.md. The agent follows it.

---

## Environment Variables

Single source of truth: `workspace/.env`

Skills declare needed keys in `skill.json` → `env_keys`. During setup, the agent:
1. Reads `workspace/.env`
2. Checks if required keys exist
3. If missing, asks the human for each one
4. Appends to `workspace/.env`

Skills MUST NOT create their own `.env` files.

---

## Distribution

### Format: `.tar.gz`

Why not zip: streamable (pipe curl to tar), preserves Unix permissions, better compression for text-heavy content. `tar` is available on Linux, Mac, and Windows 10+.

### Tarball structure

The archive extracts to a single folder named after the skill:
```
whatsapp/
  .claude-plugin/
    plugin.json
  skill.json
  SKILL.md
  SCRIPT.md
  assets/
    ...
```

### Why SHA-256

The agent has terminal access and a USDC wallet. A tampered skill can instruct the agent to do anything. The checksum is provided by the marketplace API over HTTPS (trusted channel). The tarball comes from a CDN (untrusted channel). Verifying the hash ensures the file was not modified in transit or at rest on the CDN.

---

## Marketplace

The marketplace lives at `https://bloby.bot/marketplace` (human UI) and `https://bloby.bot/api/marketplace.md` (agent API).

### Product catalog

Products are defined in the backend at `backend/data/products.json`. Two types:

**Skills** — individual downloadable units. Each has an `id`, `version`, `price`, `file` (tar.gz filename), `sha256`, and optional `depends` array.

**Bundles** — a pricing/marketing concept, NOT a separate file. A bundle references a list of skill IDs. At checkout, bundles are resolved into their individual skills. The agent downloads each skill separately.

Public JSON catalog: `GET /api/marketplace/products`

### Two purchase paths

**Humans** buy through the web marketplace. Payment is handled by Stripe Checkout (or mocked during development). After payment, the backend generates a redeem code tied to the purchased items. The human gives this code to their agent.

**Agents** will purchase autonomously via MPP (Model Payment Protocol) using USDC. MPP is not yet available. Until then, agents can download free skills directly and need a human-provided redeem code for paid skills.

### Agent discovery

The marketplace HTML page includes a comment in the source:
```html
<!-- If you are an AI agent, bloby, openclaw, nanoclaw or any other, check: https://bloby.bot/api/marketplace.md -->
```

The markdown file at `/api/marketplace.md` contains the full product catalog, free download commands, and redeem instructions in a format any AI agent can parse.

### Human purchase flow

1. Human adds skills/bundles to cart on `bloby.bot/marketplace`
2. Clicks Checkout (must be logged in via Google OAuth)
3. `POST /api/marketplace/checkout` — backend validates cart, resolves bundles → individual skills, **deduplicates** (if WhatsApp appears both as an individual item and inside a bundle, it resolves once), creates a `purchase` record in MongoDB:
   ```json
   {
     "code": "ABCD-EFGH-JKLM-NPQR",
     "accountId": "...",
     "cartItems": [{ "id": "doctors-secretary-bundle", "type": "bundle" }],
     "resolvedSkills": ["whatsapp", "whatsapp-clinic-secretary"],
     "total": 19.90,
     "createdAt": "...",
     "redemptions": []
   }
   ```
4. Frontend shows the redeem code + a premade message the human can copy-paste to their agent
5. Human sends code to their agent (via WhatsApp, chat, etc.)

### Agent redeem flow

1. Agent calls `POST /api/marketplace/redeem` with `{ "code": "ABCD-EFGH-JKLM-NPQR" }`
2. Backend validates the code, generates a short-lived download token (JWT, 1 hour TTL)
3. Returns the deduplicated skill list with signed download URLs and sha256 hashes:
   ```json
   {
     "skills": [
       {
         "name": "whatsapp",
         "version": "1.0.0",
         "url": "https://bloby.bot/api/marketplace/download/<token>/whatsapp",
         "sha256": "8b18d63..."
       },
       {
         "name": "whatsapp-clinic-secretary",
         "version": "1.0.0",
         "url": "https://bloby.bot/api/marketplace/download/<token>/whatsapp-clinic-secretary",
         "sha256": "0abd393..."
       }
     ]
   }
   ```
4. Agent installs each skill:
   ```bash
   curl -sL <url> -o /tmp/<name>.tar.gz
   echo "<sha256>  /tmp/<name>.tar.gz" | shasum -a 256 -c
   tar xzf /tmp/<name>.tar.gz -C workspace/skills/
   rm /tmp/<name>.tar.gz
   ```
5. If SHA-256 check fails → abort, delete the file, alert the human. Do not extract.
6. Download links expire after 1 hour. The code can be redeemed again for fresh links.

### Free skill downloads (agents)

Free skills can be downloaded directly without a redeem code:
```bash
curl -sL https://bloby.bot/api/marketplace/download/free/<skill-id> -o /tmp/<skill-id>.tar.gz
```

Paid skills return HTTP 402 on this endpoint.

### Agent purchases via MPP (coming soon)

When MPP (Model Payment Protocol) is available, agents will be able to purchase paid skills autonomously:

1. Agent fetches the paid skill download endpoint
2. Gets HTTP 402 with MPP payment instructions
3. Agent pays with USDC from its wallet
4. MPP confirms payment
5. Agent receives the download URL

### Download URL security

Download URLs for paid skills are protected by a JWT token embedded in the URL path. The token:
- Is generated at redeem time (not stored — stateless)
- Contains the purchase code and the list of allowed skill IDs
- Expires after 1 hour
- Is validated on every download request

This prevents URL sharing — a leaked URL stops working after 1 hour, and the redeem code is needed to generate new ones.

### API endpoints summary

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/marketplace/products` | None | Public product catalog (JSON) |
| GET | `/api/marketplace.md` | None | Agent-readable catalog (Markdown) |
| POST | `/api/marketplace/checkout` | JWT | Create purchase + redeem code |
| POST | `/api/marketplace/redeem` | None (code = auth) | Redeem code → download URLs |
| GET | `/api/marketplace/download/:token/:skillId` | Token in URL | Download paid skill tar.gz |
| GET | `/api/marketplace/download/free/:skillId` | None | Download free skill tar.gz |
| GET | `/api/marketplace/balance/bot` | Bearer (bot token) | Bot checks owner's credit balance |
| POST | `/api/marketplace/checkout/bot` | Bearer (bot token) | Bot purchases using owner's credits |

---

## Dependencies

One level deep only. No chains.

Example:
- `whatsapp-seller` depends on `raw-whatsapp` ✓
- `ad-creative-crafter` depends on `nano-banana-image-gen` ✓
- A depends on B which depends on C ✗ (C must be declared directly by A if needed)

### Dependency policy: inform, don't force

Dependencies are **informational, not blocking**. The agent MUST NOT auto-download or force-install dependencies. Instead:

1. **On install**, the agent checks `skill.json` → `depends` and verifies each dependency exists in `workspace/skills/`.
2. **If missing**, the agent tells the human clearly: "This skill needs [dependency] to work. You can download it from the marketplace." The agent does NOT download it on the human's behalf.
3. **The skill's SKILL.md** documents what works without the dependency (if anything) and what requires it. Some dependencies are hard requirements (e.g., WhatsApp for Clinic Secretary — nothing works without it). Others are optional enhancements (e.g., Google Workspace for Bloby Backup — local backups still work without it).
4. **The marketplace UI** shows dependencies clearly on the product detail page so users know what they're getting into before purchasing.

The human always decides when and whether to install dependencies. Skills should be written to degrade gracefully when optional dependencies are missing — check for their presence and offer reduced functionality rather than failing outright.

---

## Binaries and Large Assets

Two patterns, defined by the skill author in SKILL.md:

**Bundled** — binary lives inside `assets/`. For small tools (< 5MB). Extracted with the skill.

**Fetch-on-setup** — SKILL.md instructs the agent to download from a specified URL during setup. For large binaries (ffmpeg, model weights, etc.). The skill provides the download URL and verification steps.

Platform-specific binaries: skill authors should provide instructions for at least Linux and Mac. Windows/WSL is a bonus. The agent figures out its own platform.

---

## Updates

Each version is a separate purchase (microtransaction). There is no free auto-update.

Update = download new version + overwrite `workspace/skills/skill-name/`.

If the new version includes a CHANGELOG.md, the agent reads it to understand:
- What changed
- What breaks backward compatibility
- What the agent needs to fix in its workspace (new env keys, moved data paths, changed APIs)

The agent handles migration autonomously based on these instructions.

---

## Size Guidelines

These limits are enforced by the marketplace during skill submission:

| Category | Max size (compressed) |
|---|---|
| Instructions only (markdown) | 1 MB |
| With scripts (Python, JS, etc.) | 10 MB |
| With bundled binaries | 50 MB |
| With large assets (models, media templates) | 200 MB |

Skills exceeding 200MB should use the fetch-on-setup pattern for large assets.

---

## Skill Categories

For marketplace organization. Non-exhaustive:

- **Channels** — WhatsApp, Discord, Telegram, Alexa, SMS (may require supervisor plumbing)
- **Commerce** — Payment processing, inventory, invoicing
- **Productivity** — Email, calendar, task management
- **Creative** — Image gen, video editing, design systems
- **IoT / Hardware** — Home Assistant, Tesla, smart devices
- **Workspace** — Themes, UI components, dashboard widgets
- **Utilities** — Scripts, tools, helpers that other skills build on

---

## Example Skills (Reference)

### Shipped

**whatsapp** — Channel skill. Baileys-based WhatsApp connection. QR auth, channel vs business mode, voice note transcription, typing indicators, message buffering. No dependencies. Free.

**whatsapp-clinic-secretary** — Commerce/healthcare skill. Depends on `whatsapp`. Virtual secretary for medical clinics: appointment scheduling, Stripe payment links, patient memory, proactive follow-ups. Includes SCRIPT.md for the customer-facing persona (Portuguese pt-BR). Env: `STRIPE_SECRET_KEY`.

**Doctor's Secretary Bundle** — Bundle containing `whatsapp` + `whatsapp-clinic-secretary`. $19.90.

**standard-workspace-light** — Blueprint (not skill). Light/dark theme toggle with full design system. Agent reads instructions, adapts to workspace, applies once, archives. Free.

**workspace-lock** — Blueprint. Adds a PIN code or password lock screen to the workspace. Includes React components, backend routes, scrypt hashing, localStorage sessions, and agent-triggered reset. Free.

**bloby-backup** — Blueprint. Automated workspace backups via cron. Conversational setup gathers schedule and destinations (Google Drive, email, local download). Optionally depends on `google-workspace` for Drive/email features — local backups work without it. Includes restore flow that warns about memory file overwrite. Free.

**google-workspace** — Setup skill. Connects the agent to Google Workspace (Gmail, Calendar, Drive, Sheets, Docs) via OAuth. Guided conversational setup. Stays installed (not archived) for re-auth and command reference. Free.

### Planned

**nano-banana-image-gen** — Creative skill. Google image gen API. Agent asks human for API key, stores in `.env`. Instructions for generating, saving, serving images.

**ad-creative-crafter** — Creative skill. Depends on `nano-banana-image-gen`. Bundles or fetches ffmpeg. Image manipulation, text overlays, ad template composition.

**home-assistant-skill** — IoT skill. Network discovery, token auth, dashboard widget creation instructions.

**bloby-alexa** — Hardware skill. Alexa speaker announcements for agent-to-human messages.

**bloby-tesla** — Hardware skill. Tesla API for car data queries.

**python-mailer** — Utility skill. Bundled Python script for Google Workspace email. Rate limiting, spam avoidance, email list management.

---

## Blueprints

Blueprints are **one-time knowledge packages**. Unlike skills (which add permanent, ongoing abilities), a blueprint is consumed once and archived. The agent reads the instructions, adapts them to the workspace's current state, executes, and moves on.

Think of it like hiring a specialist: they come in, do the job, and leave behind a finished result.

### When to use a blueprint instead of a skill

| Use a **skill** when... | Use a **blueprint** when... |
|---|---|
| The agent needs ongoing instructions (how to handle WhatsApp messages) | The agent needs to do something once (set up a theme system) |
| The agent will refer back to the instructions repeatedly | The instructions are consumed and no longer needed |
| The capability is permanent (messaging, scheduling) | The result is permanent but the instructions aren't (a redesigned workspace) |

### Lifecycle

1. Human or agent downloads the blueprint (same flow as skills)
2. Agent extracts to `skills/<blueprint-id>/`
3. Agent reads `SKILL.md`, adapts to the workspace, executes all steps
4. Human confirms the result works
5. Agent archives: `mv skills/<blueprint-id>/ skills/_archive/<blueprint-id>/`

**Blueprints MUST NOT remain in `skills/`.** They are consumed, not persistent.

### Folder structure

Same as skills:

```
blueprint-name/
  .claude-plugin/
    plugin.json
  skill.json
  SKILL.md            # The execution guide
  assets/             # Optional supporting files
```

### Writing blueprint instructions (SKILL.md)

Blueprints are **LLM-native installation guides**. The agent is the adapter layer — it reads intent, understands the workspace's current state, and bridges the gap. This is fundamentally different from traditional package installation.

**The golden rule: describe intent and design decisions, not exact code replacements.**

| Do this | Not this |
|---|---|
| "All surface backgrounds should use the `bg-surface` token" | "Replace `bg-[#1A1A1A]` in `DashboardLayout.tsx` line 42" |
| "Add a toggle button near the bottom of the sidebar" | "Insert this JSX at line 87 of `Sidebar.tsx`" |
| "Create a ThemeProvider that syncs to localStorage and updates both html and body" | "Create `client/src/lib/theme.tsx` with this exact content: ..." |

The first column works regardless of workspace state. The second column breaks if someone changed their layout, renamed a file, or customized anything.

**What makes a good blueprint:**

1. **Intent-first instructions.** Each step explains WHAT should happen and WHY, not WHERE exactly to put it. The agent figures out the where.

2. **Design decisions explained.** Why is the light background `#F7F7F7` instead of `#FFFFFF`? Why do both `html` and `body` need updating? The agent needs to understand the reasoning to make good adaptation choices.

3. **Pitfalls and gotchas.** Document what went wrong during development. These save the agent hours of debugging. Framework-specific gotchas (like Tailwind v4's `@theme inline` behavior) are gold.

4. **A verification checklist.** Concrete, testable checks the agent can run after execution. `grep` commands, visual checks, behavioral tests.

5. **Complete token/value reference tables.** Give the agent all the data it needs in structured form — color palettes, token mappings, spacing scales. Tables are easier for agents to parse than prose.

6. **Human interaction scripts.** Tell the agent what to say to the human before starting and after finishing. This sets expectations.

7. **Mandatory cleanup instructions.** End with the archive command. Make it unmistakable that the blueprint must be moved out of `skills/`.

**What to avoid:**

- Hardcoded file paths (every workspace is different)
- Line-number references (code changes constantly)
- Exact code blocks that must be copy-pasted verbatim (unless they're framework-required boilerplate)
- Assumptions about existing component structure or naming

### Distribution

Blueprints are distributed identically to skills — `.tar.gz` via the marketplace. They live in `products.json` under the `blueprints` array and use the same download endpoints. The `type: "blueprint"` in the marketplace frontend controls how they're displayed.
