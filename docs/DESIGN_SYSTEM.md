# Irene Family Tree — Design System

Reference implementation: `Family Tree Design System.dc.html` (open it; every spec below is rendered
there, in both themes). Tokens: `design-system/tokens.css`. Repo ruleset: `design-system/CLAUDE.md`.

This file is written to be dropped into the repo as `docs/DESIGN_SYSTEM.md` and referenced from `CLAUDE.md`.

---

## 0. What we're fixing

The current viewer is a dark-navy canvas of translucent `bg-white/10` glass cards with coloured glows,
`rounded-2xl` corners, and indigo/pink accents. Three problems follow from it:

1. **The graph is unreadable at scale.** Every node is the same size at every zoom, every node glows,
   and nothing distinguishes a generation from the one above it.
2. **No hierarchy.** Sex is encoded as a decorative glow; generation is encoded as a faint avatar tint.
   Neither survives a 400-person tree.
3. **It reads unstyled.** Glassmorphism plus default Tailwind palette is the visual default of a
   scaffolded app, not a considered product.

The fix is not new decoration. It is: **kill the glass, band the generations, make the node size a
function of zoom, and let colour mean exactly one thing at a time.**

---

## 1. Non-negotiables

- **Colour carries meaning, never decoration.** Teal = interactive. Brass = root / union / "you are
  here". Violet = pending review. Green = approved. Red = declined. Grey = private. Nothing else
  is coloured. **Sex is not a colour** — it is a 2 px tick on the node's leading edge and a letter in
  the drawer.
- **No glassmorphism.** No `bg-white/10`, no `backdrop-blur` on nodes, cards, drawers, or toolbars.
  Solid `--ft-surface-0` with a 1 px `--ft-border`. Blur is permitted on exactly one thing: the
  modal scrim.
- **No glow shadows.** Delete every `shadow-[0_0_20px_rgba(...)]`. Elevation is `--ft-shadow-1/2/3`,
  neutral, and used sparingly.
- **No scale transforms on hover.** Nodes shift their border colour, not their size — a graph where
  nodes grow under the cursor is unusable when they are 30 px apart.
- **Radii are conservative.** 3/5/6/8 px. `rounded-2xl` (16 px) is gone everywhere except nothing.
  Pills (999 px) are reserved for status badges.
- **Every person name is set in the serif.** Every date, year, GEDCOM id and diff value is set in
  the mono. This is the identity; it is not optional.
- **44 px minimum touch target** on every interactive element below 640 px. Desktop may go to 28 px.
- **Light and dark are equal citizens.** Never hard-code a hex. Never `text-white`. Use tokens.

---

## 2. Foundations

### Colour
See `tokens.css`. Semantic groups: surfaces, text, accent (teal), brass, semantic states, graph.
Contrast floor: 4.5:1 for body text, 3:1 for UI borders and large text, in **both** themes.

### Type

| Role | Token | Notes |
|---|---|---|
| Page display | `--ft-display` | serif 28/700 |
| Panel title | `--ft-title` | serif 20/600 |
| Person name (drawer) | `--ft-name-lg` | serif 17/600 |
| Person name (node) | `--ft-name` | serif 15/600, `--ft-name-sm` at dense |
| Body | `--ft-body` | sans 14/400 |
| Label | `--ft-label` | sans 13/500 |
| Eyebrow | `--ft-micro` | sans 11/600, uppercase, 0.08em tracking |
| Dates / ids / diffs | `--ft-mono` | mono 12/400 |

Never set body copy below 13 px. Never set node names below 12 px — instead, drop to a smaller
node variant (§3.2).

### Space, radius, motion
4-based scale (`--ft-s1`…`--ft-s8`). Radii `--ft-r-*`. Motion: 120 ms colour, 180 ms movement,
240 ms panel. Easing `--ft-ease`. No springs, no parallax, no bounce.

### Density
`data-density="comfortable" | "compact" | "dense"` on the graph container. **Compact is the default.**
The same attribute drives both CSS and the dagre call — read `--ft-ranksep` / `--ft-nodesep` from
computed style, or mirror the numbers in `src/constants/tree.ts`.

---

## 3. The graph canvas

### 3.1 Generation bands — the single biggest change

Behind the nodes, paint one full-width horizontal band per generation rank.

- Bands alternate `--ft-band-a` / `--ft-band-b`. Generation 0 (the root's rank) gets `--ft-band-root`.
- A 1 px `--ft-band-rule` line separates bands.
- Each band carries a **left gutter label**, position-sticky to the viewport's left edge so it stays
  visible while panning: eyebrow type, e.g. `GEN −2 · GREAT-GRANDPARENTS`, in `--ft-text-3`;
  gold for generation 0.
- Bands sit in a pane *below* the edges (`react-flow` `<Background>` slot or a custom pane at
  z-index 0). They never intercept pointer events.

Band height derives from the dagre rank spacing already computed in `applyDagreLayout` — expose the
y-levels it clusters in `generationsFromLayout` and reuse them, don't recompute.

### 3.2 Person node — three levels of detail

One component, three variants chosen by **zoom level**, not by data:

| Zoom | Variant | Content |
|---|---|---|
| `< 0.45` | **Dot** | 10 px rounded square, sex tick colour only. No text. |
| `0.45 – 0.85` | **Compact** | Name (serif, truncated) + birth year. No avatar. Height 40 px. |
| `> 0.85` | **Full** | Avatar, name, `b. 1901 – d. 1974` in mono, sex tick, status marks. |

React Flow exposes zoom via `useStore(s => s.transform[2])`. Switch on it, memoised. This is what
makes a 400-person tree legible: at overview zoom you see *shape*, not text you can't read.

**Full node spec**

```
width      var(--ft-node-w)      height var(--ft-node-h)
background var(--ft-surface-0)   border 1px solid var(--ft-border)
radius     var(--ft-r-node)      padding var(--ft-node-pad)
shadow     var(--ft-shadow-1)
layout     flex, gap 10px, avatar | (name / dates)
name       var(--ft-name), var(--ft-text-1), truncate to one line, title= full name
dates      var(--ft-mono), var(--ft-text-3)
sex tick   3px full-height bar on the leading edge, radius 3px 0 0 3px
           M #4A7DB5  ·  F #A85F86  ·  unknown var(--ft-border-strong)
           (these two are the ONLY tints outside the semantic set, and they appear
            nowhere else in the product)
```

**States** — all borders, never glows:

| State | Treatment |
|---|---|
| Hover | `border-color: var(--ft-border-strong)`, `box-shadow: var(--ft-shadow-2)` |
| Selected | 2 px `--ft-accent` border, `--ft-accent-soft` background |
| Root | 2 px `--ft-brass` border + brass `⌂` marker top-right; band tinted `--ft-band-root` |
| Off-lineage (dimmed) | `opacity: var(--ft-node-dim)`, no other change |
| Has pending edit | 6 px violet dot, top-right, `title="1 suggested edit awaiting review"` |
| Living / private | `--ft-private-soft` background, dates replaced by `Living`, mono, `--ft-text-3` |
| Unknown person | name renders as `Unknown` in `--ft-text-3` italic serif |
| Focus (keyboard) | `box-shadow: var(--ft-focus)` |

### 3.3 Lineage focus — the readability lever

On hover (desktop) or tap (mobile) of a person: compute their direct line — all ancestors, all
descendants, plus spouses at each of those unions — and set every node and edge *not* in that set to
`--ft-node-dim`. Transition 180 ms. Clears on mouse-out / tap-elsewhere. Selecting a person makes it
sticky until deselect.

This costs one BFS over the already-loaded graph and is the difference between "a hairball" and "a
family". Ship it before anything else on this list.

### 3.4 Edges

- **Descent** (union → child): orthogonal `step` path, 1 px, `--ft-edge`, no arrowhead, no label.
  Bezier curves read as noise at density; right angles read as a pedigree chart.
- **Union** (person → union node): 1.5 px, `--ft-edge-union`.
- **On lineage focus**, in-line edges promote to `--ft-edge-strong` at 1.5 px.
- Never render edge labels. `.react-flow__edge-text { display: none }` stays.

### 3.5 Union node

6 px circle, `--ft-brass` fill, no border, no shadow. Tooltip on hover: `m. 1948 · Ballarat, VIC` in
mono, `--ft-surface-0` popover with 1 px border and `--ft-shadow-2` — not a black pill.

### 3.6 Canvas chrome

`react-flow` controls, minimap, and the zoom widget all take `--ft-surface-0` + 1 px `--ft-border` +
`--ft-r-md`. Delete the `rgba(255,255,255,0.08)` + `blur(12px)` overrides in `globals.css`.

Add a **minimap** (bottom-right, 160×120, `--ft-surface-0`, nodes as 2 px `--ft-edge` marks, root in
brass). A pannable graph with 60 hops and no minimap is a maze.

---

## 4. Panels & chrome

### 4.1 Person drawer

Desktop ≥ 640 px: right side panel, width 360 px (up from 320 — the current one truncates names),
full height, `--ft-surface-0`, 1 px left `--ft-border`, **no blur, no shadow** — it is a docked
region, not a floating sheet.

Mobile < 640 px: bottom sheet, `max-height: 72vh`, radius `8px 8px 0 0`, `--ft-shadow-3`, drag handle
32×4 px `--ft-surface-3` centred with 10 px padding.

Internal structure, top to bottom:

1. **Header** — avatar 48 px, name `--ft-name-lg`, lifespan mono `--ft-text-3`, close button 44 px.
2. **Status row** — pills: `Living`, `3 pending edits`, `Root`.
3. **Facts list** — label/value rows. Label `--ft-micro` uppercase `--ft-text-3`; value `--ft-body`
   `--ft-text-1`; dates and places in mono. Row gap `--ft-row-gap`, 1 px `--ft-border` between rows.
   Empty values render an inline `+ Add birth place` ghost button, not a dash.
4. **Relationships** — grouped `Parents / Siblings / Spouses / Children`, each a tappable row (44 px)
   that re-roots the tree. Group heading `--ft-micro`.
5. **Timeline** — vertical rule `--ft-border`, events as mono year + body description.
6. **Actions** — sticky bottom bar, 1 px top border, `--ft-surface-1`: primary `Suggest an edit`,
   ghost `Make root`, danger-ghost `Delete`.

Sections are separated by 1 px `--ft-border` full-bleed rules, not gaps.

### 4.2 Toolbar

Top-left, `--ft-surface-0`, 1 px border, `--ft-r-md`, `--ft-shadow-1`. Contains: search, hop-depth
control, density toggle, theme toggle, fit-view. On mobile it collapses to a single 44 px icon button
that opens a sheet — the current top-strip of controls eats a third of a phone screen.

Hop depth is a **stepper with a numeric readout**, not a slider: `− 6 +` with the range 1–60. Sliders
cannot be operated precisely on a graph you are simultaneously reading.

### 4.3 Search

`--ft-surface-0`, 1 px border, 5 px radius, min-height 44 px. Results are a plain list on
`--ft-surface-0`: sex tick (2 px leading bar, not a dot), serif name, mono birth year,
`--ft-text-3` place. Hover `--ft-surface-1`; keyboard-active `--ft-accent-soft` with a 2 px accent
leading bar. Highlight the matched substring with `--ft-brass-soft` background, no bolding.

### 4.4 Auth control

Top-right, same solid treatment. Avatar 24 px, name `--ft-label`, `Sign out` as a text button.

---

## 5. Review & edit workflow

This is the part of the product that most needs to feel trustworthy — it changes shared family
history. It should read like a document, not an app.

### 5.1 Status pills

`--ft-r-pill`, 11 px `--ft-micro` uppercase, 2/8 px padding, soft background + solid text:

| Status | bg / text |
|---|---|
| Pending | `--ft-pending-soft` / `--ft-pending` |
| Approved | `--ft-approved-soft` / `--ft-approved` |
| Declined | `--ft-declined-soft` / `--ft-declined` |
| Living | `--ft-private-soft` / `--ft-private` |
| Root | `--ft-brass-soft` / `--ft-brass` |

### 5.2 Suggestion card

`--ft-surface-0`, 1 px border, `--ft-r-panel`, padding 20 px, `--ft-shadow-1`. Never a coloured
left-border stripe.

- Header: person name `--ft-name-lg` serif; `Proposed by <name>` `--ft-body` `--ft-text-2`;
  relative time mono `--ft-text-3`; change-type pill right-aligned.
- **Diff**: two columns on desktop, stacked on mobile. Field label `--ft-micro` uppercase.
  Before value: mono, `--ft-text-3`, `text-decoration: line-through`, `--ft-declined-soft` background.
  After value: mono, `--ft-text-1`, `--ft-approved-soft` background. Empty → `(none)` italic
  `--ft-text-3`. The current two-column "before/after" with no visual diff makes reviewers
  compare strings by eye — don't.
- Actions: `Approve` (primary), `Decline` (secondary), and a `View in tree` ghost link that re-roots
  the graph on that person. Reviewers need context; a card in isolation is not enough to judge.

### 5.3 Admin tabs

Underline tabs, not filled pills: `--ft-label`, 12/4 px padding, active gets a 2 px `--ft-accent`
bottom border and `--ft-text-1`; inactive `--ft-text-3`. A count badge sits after the label —
`Pending Suggestions` + a `--ft-pending-soft` pill with the number.

### 5.4 Buttons

| Variant | Rest | Hover | Press | Disabled |
|---|---|---|---|---|
| Primary | `--ft-accent` bg, `--ft-text-on-accent` | `--ft-accent-hover` | `--ft-accent-press` | 40 % opacity |
| Secondary | `--ft-surface-0`, 1 px `--ft-border`, `--ft-text-1` | `--ft-surface-1`, border-strong | `--ft-surface-2` | 40 % opacity |
| Ghost | transparent, `--ft-text-2` | `--ft-surface-2`, `--ft-text-1` | `--ft-surface-3` | 40 % opacity |
| Danger | `--ft-declined` bg, white | 6 % darker | 12 % darker | 40 % opacity |

Height 36 px desktop / 44 px mobile, radius `--ft-r-md`, `--ft-body-strong`. No shadow. No scale.
Loading state: replace the label with a 14 px 2 px-stroke spinner in the label colour + the
progressive verb (`Approving…`) — keep the button's width fixed so the row doesn't reflow.

### 5.5 Inputs

Height 40/44 px, `--ft-surface-0`, 1 px `--ft-border`, `--ft-r-md`, `--ft-body`, placeholder
`--ft-text-3`. Focus: `border-color: var(--ft-accent)` + `box-shadow: var(--ft-focus)` — never
`focus:ring-1 focus:ring-indigo-400/60`. Error: `--ft-declined` border + 12 px message below.

### 5.6 Dialog

Scrim `--ft-overlay` + `blur(2px)`. Panel `--ft-surface-0`, 1 px border, `--ft-r-panel`, max-width
420 px, padding 24 px, `--ft-shadow-3`. Title `--ft-title` serif, body `--ft-body` `--ft-text-2`,
actions right-aligned with the destructive action as `Danger` and focus defaulting to `Cancel`.

---

## 6. Mobile

Desktop and mobile carry equal weight. Rules:

- Every tap target ≥ 44 px. No exceptions in the drawer, toolbar, search results, or relationship rows.
- The graph gets the whole viewport. Chrome collapses: toolbar → one icon button, search → one icon
  button, auth → avatar only.
- The drawer is a bottom sheet with a drag handle and two detents (peek ≈ 30 vh, full 72 vh).
- Pinch-zoom drives the same LOD switch as desktop zoom, so the overview is always readable.
- Density defaults to `compact` on desktop and `dense` on phones.
- Test at 360 × 640.

---

## 7. Accessibility

- Contrast floors as §2. Verify both themes.
- Focus is always visible: `--ft-focus`. Never `focus:outline-none` without a replacement.
- Nodes are `role="button"`, `tabIndex=0`, arrow-key navigable between generations
  (`↑` parent, `↓` child, `←/→` sibling). A pannable canvas with no keyboard path is unusable.
- `prefers-reduced-motion` disables all transitions (already in `tokens.css`).
- Sex tick colour is backed by the letter in the drawer and by `aria-label` — colour is never the
  only carrier.
- Dialogs trap focus and restore it on close.

---

## 8. Implementation order

1. Tokens + theme switch (`tokens.css`, `@theme inline` bridge, `data-theme` on `<html>`).
2. De-glass: nodes, drawer, toolbar, search, auth, admin cards, `globals.css` overrides.
3. Generation bands + gutter labels.
4. Lineage focus dimming.
5. Node LOD by zoom.
6. Orthogonal edges + minimap.
7. Drawer restructure (facts / relationships / timeline / sticky actions).
8. Review-card diff treatment + underline tabs.
9. Keyboard navigation.
10. Mobile chrome collapse + sheet detents.

Steps 3–5 are what fix "unreadable and too dense". Do them together.

---

## 9. Files this touches

| Concern | File |
|---|---|
| Tokens, resets, react-flow overrides | `src/app/globals.css` |
| Node/edge/drawer class constants, density numbers | `src/constants/tree.ts` |
| Node LOD, sex tick, states | `src/components/PersonNode.tsx` |
| Union dot + tooltip | `src/components/UnionNode.tsx` |
| Bands, lineage focus, toolbar, drawer | `src/components/FamilyTree.tsx` |
| Search results | `src/components/SearchBar.tsx` |
| Auth pill | `src/components/AuthButton.tsx` |
| Dialog | `src/components/ConfirmDialog.tsx` |
| Tabs, review card, diff | `src/app/admin/*` |
| Rank/node spacing fed to dagre | `src/lib/layout.ts` |
