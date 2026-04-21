'use client'

import { Handle, Position, type NodeProps } from 'reactflow'
import type { PersonData } from '@/types/tree'
import { sexDotClass } from '@/lib/person'

const initialsOf = (data: PersonData) => {
  const src = data.name || `${data.givenName ?? ''} ${data.surname ?? ''}`.trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

export default function PersonNode({ data, selected }: NodeProps<PersonData>) {
  const isRoot = data.isRoot
  const sex = data.sex
  const generation = data.generation ?? 0
  const isAncestor = generation < 0
  const isDescendant = generation > 0

  const avatarGradient =
    sex === 'M'
      ? 'from-sky-500/80 to-indigo-600/80'
      : sex === 'F'
      ? 'from-pink-500/80 to-rose-600/80'
      : 'from-slate-500/80 to-slate-700/80'

  const accentLine = sexDotClass(sex)

  const ring = isRoot
    ? 'ring-2 ring-amber-300/90 shadow-[0_0_35px_rgba(252,211,77,0.35)]'
    : selected
    ? 'ring-2 ring-sky-300/70'
    : ''

  const tintClass = isAncestor
    ? 'bg-indigo-950/60 border-indigo-400/20'
    : isDescendant
    ? 'bg-emerald-950/50 border-emerald-400/20'
    : 'bg-slate-900/70 border-white/15'

  const dates = [
    data.birthYear ? data.birthYear : data.birthDate ? '?' : '',
    data.deathYear ? data.deathYear : data.deathDate ? '?' : '',
  ]
  const dateText =
    dates[0] || dates[1] ? `${dates[0] || '?'}–${dates[1] || ''}`.replace(/–$/, '') : ''

  const place = data.birthPlace || data.deathPlace || data.occupation || ''

  return (
    <div
      className={`group relative flex items-center gap-3 rounded-xl border backdrop-blur-md
        px-3 py-2 w-[200px] ${tintClass} ${ring}
        hover:bg-white/10 hover:border-white/30 transition-all duration-150`}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r ${accentLine} opacity-70`} />
      <div
        className={`flex-none h-9 w-9 rounded-full flex items-center justify-center
          text-white text-xs font-semibold bg-gradient-to-br ${avatarGradient} shadow-inner`}
      >
        {initialsOf(data)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-white truncate leading-tight">
          {data.name || '(unknown)'}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-300/80">
          {dateText && <span className="tabular-nums">{dateText}</span>}
          {dateText && place && <span className="opacity-50">·</span>}
          {place && <span className="truncate">{place}</span>}
        </div>
      </div>
      {isRoot && (
        <div className="absolute -top-2 -right-2 h-4 w-4 rounded-full bg-amber-300 text-[10px] text-slate-900 flex items-center justify-center shadow-md">
          ★
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
