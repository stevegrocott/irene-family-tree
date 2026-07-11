import type React from 'react'

/** Default root person GEDCOM ID used when no explicit root has been selected. */
export const DEFAULT_ROOT_GEDCOM_ID = '@I85@'

export const MIN_HOPS = 1
export const MAX_HOPS = 60
export const DEFAULT_HOPS = MAX_HOPS
export const UNION_LABEL = 'Union'

export const EDGE_TYPES = {
  UNION: 'UNION',
  CHILD: 'CHILD',
} as const

export const EDGE_STYLES: Record<string, React.CSSProperties> = {
  [EDGE_TYPES.UNION]: { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.6 },
  [EDGE_TYPES.CHILD]: { stroke: '#a78bfa', strokeWidth: 1, opacity: 0.45 },
}

export const SEX_GLOW: Record<string, string> = {
  M: 'shadow-[0_0_20px_rgba(99,179,237,0.4)]',
  F: 'shadow-[0_0_20px_rgba(237,100,166,0.4)]',
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
export const DRAWER_CONTAINER_CLASS = 'absolute inset-x-0 bottom-0 z-20 w-full max-h-[60vh] rounded-t-2xl border-t border-white/10 bg-[#0a1628]/90 backdrop-blur-xl shadow-[0_-8px_32px_rgba(0,0,0,0.5)] flex flex-col sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-auto sm:h-full sm:max-h-none sm:w-80 sm:rounded-none sm:border-t-0 sm:border-l sm:shadow-[-8px_0_32px_rgba(0,0,0,0.5)]'

export const DRAWER_DRAG_HANDLE_CLASS = 'flex justify-center pt-2 pb-1 sm:hidden'

export const RESPONSIVE_BUTTON_BASE = 'flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors w-11 h-11 sm:w-7 sm:h-7'
