import type React from 'react'

/** Default root person GEDCOM ID used when no explicit root has been selected. */
export const DEFAULT_ROOT_GEDCOM_ID = '@I85@'

export const MIN_HOPS = 1
export const MAX_HOPS = 16
export const DEFAULT_HOPS = 8
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
