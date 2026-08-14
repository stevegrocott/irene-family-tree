import type React from 'react'

/** Default root person GEDCOM ID used when no explicit root has been selected. */
export const DEFAULT_ROOT_GEDCOM_ID = '@I85@'

export const MIN_HOPS = 1
export const MAX_HOPS = 60
export const DEFAULT_HOPS = 60
export const UNION_LABEL = 'Union'

/** Generation band CSS custom properties (src/styles/tokens.css §3.1) — alternate a/b by parity, root at generation 0. */
export const BAND_VARS = {
  a: '--ft-band-a',
  b: '--ft-band-b',
  root: '--ft-band-root',
  rule: '--ft-band-rule',
} as const

/** Lineage-focus CSS custom properties (src/styles/tokens.css §Graph-specific) — dim opacity and promoted edge color applied on hover/selection per docs/DESIGN_SYSTEM.md §3.3. */
export const LINEAGE_VARS = {
  dim: '--ft-node-dim',
  edgeStrong: '--ft-edge-strong',
} as const

/** Transition duration (ms) for the lineage-focus dim/undim, per docs/DESIGN_SYSTEM.md §3.3. */
export const LINEAGE_DIM_TRANSITION_MS = 180

/**
 * Density presets — mirrors the `[data-density]` breakpoints in src/styles/tokens.css so
 * `applyDagreLayout`'s `ranksep`/`nodesep` stay in lockstep with the CSS-driven band height.
 * Compact is the default per docs/DESIGN_SYSTEM.md § Density.
 */
export const DENSITY_PRESETS = {
  compact: { ranksep: 74, nodesep: 30, bandHeight: 120 },
  comfortable: { ranksep: 96, nodesep: 44, bandHeight: 144 },
  dense: { ranksep: 54, nodesep: 18, bandHeight: 92 },
} as const

export type Density = keyof typeof DENSITY_PRESETS

export const DEFAULT_DENSITY: Density = 'compact'

/** Viewport width (px) below which mobile density/chrome rules apply, per docs/DESIGN_SYSTEM.md §6. */
export const MOBILE_DENSITY_BREAKPOINT_PX = 640

/**
 * Resolves the default {@link Density} for a given viewport width — `dense` below
 * {@link MOBILE_DENSITY_BREAKPOINT_PX}, `compact` at or above it — per
 * docs/DESIGN_SYSTEM.md §6 ("Density defaults to `compact` on desktop and `dense` on phones").
 */
export function getDefaultDensity(viewportWidth: number): Density {
  return viewportWidth < MOBILE_DENSITY_BREAKPOINT_PX ? 'dense' : 'compact'
}

/**
 * Zoom thresholds driving person-node level-of-detail (docs/DESIGN_SYSTEM.md §3.2).
 * `dotMax` is the exclusive upper bound of the **dot** variant; `compactMax` is the
 * inclusive upper bound of the **compact** variant. Anything above `compactMax` is **full**.
 */
export const LOD_ZOOM_THRESHOLDS = {
  dotMax: 0.45,
  compactMax: 0.85,
} as const

/** Person-node level-of-detail variant, selected by zoom per docs/DESIGN_SYSTEM.md §3.2. */
export type PersonLodVariant = 'dot' | 'compact' | 'full'

/**
 * Maps a ReactFlow zoom level (`s.transform[2]`) to a discrete {@link PersonLodVariant}.
 * Boundary values resolve to a single variant each (`< dotMax` → dot, `> compactMax` → full,
 * otherwise compact) so nodes never flicker between two variants at exactly 0.45 or 0.85.
 */
export function getPersonLodVariant(zoom: number): PersonLodVariant {
  if (zoom < LOD_ZOOM_THRESHOLDS.dotMax) return 'dot'
  if (zoom > LOD_ZOOM_THRESHOLDS.compactMax) return 'full'
  return 'compact'
}

export const EDGE_TYPES = {
  UNION: 'UNION',
  CHILD: 'CHILD',
} as const

/** Per-label edge stroke styling, tokenized per docs/DESIGN_SYSTEM.md §3.4. */
export const EDGE_STYLES: Record<string, React.CSSProperties> = {
  [EDGE_TYPES.UNION]: { stroke: 'var(--ft-edge-union)', strokeWidth: 1.5 },
  [EDGE_TYPES.CHILD]: { stroke: 'var(--ft-edge)', strokeWidth: 1 },
}

/**
 * ReactFlow edge `type` per relationship label (docs/DESIGN_SYSTEM.md §3.4) — descent
 * (`CHILD`, union→person) edges render as orthogonal `step` paths so the graph reads as a
 * pedigree chart at density. Union (person→union) edges are left unmapped so they keep the
 * `smoothstep` default from `defaultEdgeOptions`.
 */
export const EDGE_RENDER_TYPE: Partial<Record<string, string>> = {
  [EDGE_TYPES.CHILD]: 'step',
}

/**
 * Sex tints per docs/DESIGN_SYSTEM.md §3.2 — "M #4A7DB5 · F #A85F86 · unknown
 * var(--ft-border-strong) (these two are the ONLY tints outside the semantic
 * set, and they appear nowhere else in the product)". Single source of truth
 * for every sex-keyed colour in the product (avatar fill, avatar text, the
 * person-node tick, the search-result tick) — do not redefine `#4A7DB5` /
 * `#A85F86` anywhere else; import from here instead.
 *
 * Raw hex/CSS values, not Tailwind classes — apply via inline `style`, e.g.
 * `style={{ backgroundColor: SEX_AVATAR_BG[sex] ?? SEX_AVATAR_BG.default }}`.
 */
export const SEX_AVATAR_BG: Record<string, string> = {
  M: '#4A7DB5',
  F: '#A85F86',
  default: 'var(--ft-border-strong)',
}

/**
 * Alias of {@link SEX_AVATAR_BG} for foreground (not fill) usages — same §3.2 tints.
 * Raw hex/CSS values, not Tailwind classes; apply via inline `style`, not `className`.
 */
export const SEX_AVATAR_TEXT: Record<string, string> = SEX_AVATAR_BG

/** Mobile bottom-sheet detent for the person drawer (docs/DESIGN_SYSTEM.md §6: "two detents (peek ≈ 30 vh, full 72 vh)"). */
export type DrawerDetent = 'peek' | 'full'

/** The drawer opens at the `peek` detent, not `full` — see {@link DrawerDetent}. */
export const DEFAULT_DRAWER_DETENT: DrawerDetent = 'peek'

/** Per-detent mobile sheet height, keyed by {@link DrawerDetent}. */
const DRAWER_DETENT_HEIGHT_CLASS: Record<DrawerDetent, string> = {
  peek: 'h-[30vh]',
  full: 'h-[72vh]',
}

/**
 * Drawer layout classes — responsive: mobile bottom-sheet, desktop side panel.
 * On mobile the sheet height switches between the two docs/DESIGN_SYSTEM.md §6 detents —
 * `peek` (~30vh, the default a drawer opens at) and `full` (72vh, reached by tapping the
 * drag handle) — via `detent`. At `sm` and up this is overridden unconditionally to the
 * fixed right-side panel, regardless of `detent`.
 */
export function getDrawerContainerClass(detent: DrawerDetent): string {
  return `absolute inset-x-0 bottom-0 z-20 w-full ${DRAWER_DETENT_HEIGHT_CLASS[detent]} rounded-t-[var(--ft-r-panel)] border-t border-line bg-surface shadow-[var(--ft-shadow-3)] flex flex-col sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-auto sm:h-full sm:max-h-none sm:w-[360px] sm:rounded-none sm:border-t-0 sm:border-l sm:shadow-[none]`
}

/**
 * Mobile drag handle — also the tap target that toggles between detents, so it needs the
 * same ≥44px touch-target floor as any other interactive control (docs/DESIGN_SYSTEM.md §6).
 */
export const DRAWER_DRAG_HANDLE_CLASS = 'flex items-center justify-center w-full min-h-11 sm:hidden'

/** Mobile drag-handle bar — 32×4 px per docs/DESIGN_SYSTEM.md §6. */
export const DRAWER_DRAG_HANDLE_BAR_CLASS = 'h-1 w-8 rounded-full bg-ink-3'

/**
 * Sticky bottom actions bar for the person drawer (docs/DESIGN_SYSTEM.md §4.1 point 6:
 * "sticky bottom bar, 1 px top border, `--ft-surface-1`"). `sticky bottom-0` pins it above
 * the scrolled Facts/Relationships/Timeline body in both the mobile bottom sheet and the
 * desktop docked panel, so primary actions (re-root, delete) stay reachable without scrolling.
 */
export const DRAWER_ACTIONS_CLASS = 'sticky bottom-0 z-10 px-5 py-4 border-t border-line bg-surface-1 space-y-2'

export const RESPONSIVE_BUTTON_BASE = 'flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-1 transition-colors w-11 h-11 sm:w-7 sm:h-7'

/**
 * Status-row pill classes for the person drawer (docs/DESIGN_SYSTEM.md §4.1).
 * Each variant reuses the semantic token pair already defined for that meaning
 * elsewhere in the design system: private/living, pending, and brass/root.
 */
export const STATUS_PILL_BASE_CLASS = 'inline-flex items-center [font:var(--ft-label)] px-2.5 py-1 rounded-[var(--ft-r-pill)] whitespace-nowrap'
export const STATUS_PILL_LIVING_CLASS = `${STATUS_PILL_BASE_CLASS} bg-[var(--ft-private-soft)] text-[var(--ft-private)]`
export const STATUS_PILL_PENDING_CLASS = `${STATUS_PILL_BASE_CLASS} bg-[var(--ft-pending-soft)] text-[var(--ft-pending)]`
export const STATUS_PILL_ROOT_CLASS = `${STATUS_PILL_BASE_CLASS} bg-[var(--ft-brass-soft)] text-[var(--ft-brass)]`

/**
 * Relationships-list row class (docs/DESIGN_SYSTEM.md §4.1: "each a tappable row (44 px)
 * that re-roots the tree"). 44 px tall regardless of density or the `small` (nested-child)
 * variant so every row clears the drawer's touch-target floor (§6).
 */
export const RELATIONSHIP_ROW_CLASS = 'flex w-full min-h-[44px] items-center gap-2 px-3 rounded-lg text-left transition-colors hover:bg-surface-1'

/** Facts-list label/value classes (docs/DESIGN_SYSTEM.md §4.1) — rows separated by the parent's `divide-y`. */
export const FACT_ROW_LABEL_CLASS = '[font:var(--ft-micro)] uppercase tracking-[var(--ft-micro-track)] text-ink-3 flex-shrink-0'
export const FACT_ROW_VALUE_CLASS = '[font:var(--ft-body)] text-ink text-right min-w-0'

/**
 * Ghost "+ Add …" button rendered in place of a Facts value when it's empty
 * (docs/DESIGN_SYSTEM.md §4.1: "never a dash"), styled per the Ghost button
 * variant in §5.4 — transparent at rest, `--ft-surface-2` on hover.
 */
export const FACT_ROW_GHOST_CLASS = '[font:var(--ft-body)] text-ink-2 hover:text-ink hover:bg-surface-2 rounded-lg px-2 -mr-2 py-0.5 transition-colors'

/**
 * Solid surface/border/shadow treatment for a floating-panel-style control —
 * see AuthButton.tsx. Position-agnostic: renders in normal flow; callers that
 * need the control floated (e.g. non-viewer layout routes) wrap it in their
 * own positioned container instead of this class baking in a position.
 */
export const FLOATING_PANEL_BASE_CLASS = 'flex items-center gap-2 bg-surface border border-line rounded-[var(--ft-r-md)] shadow-[var(--ft-shadow-1)]'

/** Card container shared by ChangeHistory and SuggestionsReview list items. */
export const ADMIN_CARD_CLASS = 'bg-surface border border-line rounded-panel p-5 shadow-[var(--ft-shadow-1)]'

export const ADMIN_CARD_TITLE_CLASS = 'font-serif text-[17px] font-semibold leading-tight text-ink'

export const ADMIN_CARD_META_CLASS = 'text-ink-3 text-xs mt-0.5'

export const ADMIN_STATUS_PILL_CLASS = 'text-xs px-2.5 py-1 rounded-full bg-[var(--ft-pending-soft)] text-[var(--ft-pending)]'

export const ADMIN_SECONDARY_BUTTON_CLASS = 'py-2 rounded-[var(--ft-r-md)] bg-surface hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed text-ink text-sm font-medium border border-line transition-colors'

export const ADMIN_EMPTY_STATE_CLASS = 'flex flex-col items-center justify-center py-20 text-center'

export const ADMIN_EMPTY_ICON_WRAP_CLASS = 'w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center mb-4'

export const ADMIN_EMPTY_ICON_CLASS = 'w-8 h-8 text-ink-3'

export const ADMIN_ERROR_TEXT_CLASS = 'text-[var(--ft-declined)] text-xs'

/** Ghost-variant action per §5.4: transparent, text-2 at rest, surface-2/text-1 on hover. */
export const ADMIN_GHOST_LINK_CLASS = 'flex-1 flex items-center justify-center py-2 rounded-[var(--ft-r-md)] text-ink-2 hover:bg-surface-2 hover:text-ink text-sm font-medium transition-colors'

export const BUTTON_SPINNER_WRAP_CLASS = 'flex items-center justify-center gap-2'

export const SPINNER_CLASS = 'w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin'

/** Shared base for ConfirmDialog's cancel/confirm buttons — see ConfirmDialog.tsx. */
export const DIALOG_BUTTON_BASE_CLASS = 'h-11 sm:h-9 px-4 rounded-[var(--ft-r-md)] [font:var(--ft-body-strong)] transition-colors focus-visible:outline-none focus-visible:[box-shadow:var(--ft-focus)]'
