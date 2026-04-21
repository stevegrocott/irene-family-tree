'use client'

import { Handle, Position, type NodeProps } from 'reactflow'
import type { PersonData } from '@/types/tree'

const SEX_GLOW: Record<string, string> = {
  M: 'shadow-[0_0_20px_rgba(99,179,237,0.4)]',
  F: 'shadow-[0_0_20px_rgba(237,100,166,0.4)]',
}

export default function PersonNode({ data }: NodeProps<PersonData>) {
  const glow = SEX_GLOW[data.sex] ?? 'shadow-[0_0_20px_rgba(148,163,184,0.3)]'
  const rootRing = data.isRoot
    ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-transparent shadow-[0_0_28px_rgba(251,191,36,0.6)]'
    : ''

  const dates = [
    data.birthYear ? `b. ${data.birthYear}` : null,
    data.deathYear ? `d. ${data.deathYear}` : null,
  ]
    .filter(Boolean)
    .join('  ')

  return (
    <div
      className={`bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-4 py-3 min-w-[160px] ${glow} ${rootRing} hover:bg-white/15 hover:scale-[1.03] transition-all duration-200`}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="font-semibold text-white text-sm tracking-wide">{data.name}</div>
      {dates && <div className="text-slate-400 text-xs mt-1">{dates}</div>}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
