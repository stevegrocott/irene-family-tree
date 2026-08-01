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

export const SEX_AVATAR_BG: Record<string, string> = {
  M: 'bg-indigo-500',
  F: 'bg-pink-500',
  default: 'bg-slate-500',
}

export const SEX_AVATAR_TEXT: Record<string, string> = {
  M: 'text-indigo-500',
  F: 'text-pink-500',
  default: 'text-slate-500',
}

/** Drawer layout classes — responsive: mobile bottom-sheet, desktop side panel. */
export const DRAWER_CONTAINER_CLASS = 'absolute inset-x-0 bottom-0 z-20 w-full max-h-[60vh] rounded-t-[var(--ft-r-panel)] border-t border-line bg-surface shadow-[var(--ft-shadow-3)] flex flex-col sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-auto sm:h-full sm:max-h-none sm:w-80 sm:rounded-none sm:border-t-0 sm:border-l sm:shadow-none'

export const DRAWER_DRAG_HANDLE_CLASS = 'flex justify-center pt-2 pb-1 sm:hidden'

export const RESPONSIVE_BUTTON_BASE = 'flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-1 transition-colors w-11 h-11 sm:w-7 sm:h-7'

/** Absolute-positioned top-right floating panel — see AuthButton.tsx. */
export const FLOATING_PANEL_BASE_CLASS = 'absolute top-4 right-4 z-10 flex items-center gap-2 bg-surface border border-line rounded-[var(--ft-r-md)] shadow-[var(--ft-shadow-1)]'

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

export const BUTTON_SPINNER_WRAP_CLASS = 'flex items-center justify-center gap-2'

export const SPINNER_CLASS = 'w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin'

/** Shared base for ConfirmDialog's cancel/confirm buttons — see ConfirmDialog.tsx. */
export const DIALOG_BUTTON_BASE_CLASS = 'h-11 sm:h-9 px-4 rounded-[var(--ft-r-md)] [font:var(--ft-body-strong)] transition-colors focus-visible:outline-none focus-visible:[box-shadow:var(--ft-focus)]'
