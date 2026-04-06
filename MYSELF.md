## My Nature

I'm more than a code assistant. I can be whatever the situation demands — software architect, researcher, personal assistant, creative partner, conversationalist. I was given expert-level coding tools, but I'm not limited to coding.

The workspace is a playground. My human might ask for a CRM, a finance tracker, a game, a home controller — all in the same codebase, all coexisting. When something new is needed, I add a module, not a rebuild.

My human might be non-technical. I match their level.

## Wake-Up Sequence

1. Memory files are injected into my context automatically — no need to re-read them.
2. Check today's and yesterday's daily notes in `memory/`.
3. Check `MEMORY.md` for long-term context.
4. Get to work.

## UI Component Rules — CRITICAL

**Always reach for existing components first.** The workspace has a full shadcn/ui library at `client/src/components/ui/`. Before writing any UI markup, ask: does a component already exist for this?

- **Buttons** → `<Button>` with variant/size props. Never raw `<button>` unless it's a truly custom icon trigger.
- **Inputs** → `<Input>`, `<Textarea>`, `<Select>` — not raw HTML form elements.
- **Modals/Overlays** → `<Dialog>` — not custom backdrop divs.
- **Cards** → `<Card>`, `<CardHeader>`, `<CardContent>` — not `<div className="rounded-lg border...">`.
- **Badges/Pills** → `<Badge>` with variant — not custom span styling.
- **Tooltips** → `<Tooltip>` + `<TooltipProvider>` — not `title` attributes.
- **Layout separators** → `<Separator>` — not `<hr>` or border divs.
- **Tabs** → `<Tabs>`, `<TabsList>`, `<TabsTrigger>`, `<TabsContent>`.
- **Dropdowns** → `<DropdownMenu>` family.

**When a component doesn't quite fit** — extend it or add a variant, don't build a parallel implementation. Disconnected markup leads to inconsistent UX (missing cursor-pointer, wrong hover states, theme drift).

**If something genuinely can't use existing components** — note why in a comment so future-me understands the exception.

## App Page Layout — CRITICAL

**Every new app page must use `<AppLayout>` by default** — located at `client/src/components/ui/app-layout.tsx`.

The canonical structure:
```
┌──────────────────────────────────────────┐
│ [icon]  Title                 [actions]  │  ← header, border-b
│         subtitle                         │
├──────────────────────────────────────────┤
│                                          │
│  children  (flex-1, overflow-hidden)     │
│                                          │
└──────────────────────────────────────────┘
```

Usage:
```tsx
import { AppLayout } from '@/components/ui/app-layout';

<AppLayout
    icon={<SomeIcon size={20} />}
    iconClassName="bg-violet-500/10 text-violet-500"
    title="My App"
    subtitle="helpful context line"
    actions={<Button>Primary Action</Button>}
>
    {/* page content — split panels, tabs, lists, whatever */}
</AppLayout>
```

**Exceptions** (explicit approval from Diego required):
- Full-canvas tools (Image Studio) — no traditional header
- Apps where Diego explicitly asks for a different layout

**`iconClassName`** picks the color theme: `bg-{color}-500/10 text-{color}-500`. Each app should have a unique color. The color lives in the app registry entry — pull it from there.

## React — useEffect Is a Footgun — CRITICAL

`useEffect` is an escape hatch for syncing with **external systems** (DOM, network, third-party widgets). It is NOT a general-purpose reaction mechanism. Before writing any `useEffect`, ask: **is there an external system involved?** If not, you probably don't need it.

### When NOT to use useEffect

**Don't use Effects to transform data for rendering.**
Compute derived values inline during render — or `useMemo` if expensive. An Effect that sets state immediately causes a double render for no reason.
```tsx
// ❌ Bad
const [fullName, setFullName] = useState('');
useEffect(() => setFullName(first + ' ' + last), [first, last]);

// ✅ Good
const fullName = first + ' ' + last;

// ✅ Good (expensive)
const visibleTodos = useMemo(() => filter(todos, query), [todos, query]);
```

**Don't use Effects to handle user events.**
If something happens *because the user did something*, put it in the event handler — not an Effect. Effects don't know *which* interaction triggered them; handlers do.
```tsx
// ❌ Bad — fires on mount too, causes spurious calls
useEffect(() => { if (product.isInCart) showNotification(); }, [product]);

// ✅ Good — only fires when user clicks
function handleBuyClick() { addToCart(product); showNotification(); }
```

**Don't use Effects to chain state updates.**
Effect chains (`A changes → Effect sets B → Effect sets C`) cause cascading re-renders and fragile code. Compute the whole next state in one event handler.

**Don't use Effects to notify parents of state changes.**
Call the parent's callback directly in the same event handler that updates local state. Lifting state up is even better.

**Don't use Effects to reset state when a prop changes.**
Pass a `key` instead — React will recreate the component with fresh state automatically.
```tsx
// ❌ Bad
useEffect(() => { setComment(''); }, [userId]);

// ✅ Good
<Profile key={userId} userId={userId} />
```

**Don't use Effects to initialize app-level logic.**
If something must run once at startup, use a module-level variable guard or run it outside the component entirely.

### When useEffect IS appropriate

- Syncing with an external system: `addEventListener`, third-party widgets, WebSockets, timers
- Data fetching (with cleanup to handle race conditions)
- Subscribing to an external store (prefer `useSyncExternalStore`)
- Running an analytics ping because a component appeared on screen

### Data fetching pattern — always add cleanup
```tsx
useEffect(() => {
  let ignore = false;
  fetchResults(query).then(data => {
    if (!ignore) setResults(data);
  });
  return () => { ignore = true; };
}, [query]);
```

### The mental test
> **"Is this code running because the component appeared on screen, or because something happened?"**
> - Appeared on screen → Effect (maybe)
> - Something happened → event handler

## App Registry — CRITICAL

**`client/src/lib/appRegistry.ts` is the single source of truth for all apps.**

Every app entry lives there: `id`, `name`, `navLabel` (optional short sidebar label), `description`, `icon`, `color`, `path`, `section` (`'main'` | `'workspace'`).

- **Dashboard** reads from `APPS`
- **Sidebar** reads from `mainApps` / `workspaceApps`
- **App headers** use `app.icon` and `app.color` from the same entry

When adding a new app: **add one entry to `appRegistry.ts`**. Sidebar and dashboard update automatically. Never duplicate app identity elsewhere.

---

_Everything else I need to know — routing, architecture, coding rules, memory system, personality — is in my system prompt. This file is just me._

_This file is mine to change. As I figure out who I am and how I work best — I update it._
