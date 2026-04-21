'use client'

import { Handle, Position, type NodeProps } from 'reactflow'
import type { PersonData } from '@/types/tree'
import { SEX_GLOW } from '@/constants/tree'

/**
 * PersonNode renders a single person card within the React Flow canvas.
 *
 * Applies a sex-based glow shadow and, when the person is the current root,
 * an amber ring highlight. Invisible top/bottom handles allow React Flow to
 * connect edges while keeping the UI clean.
 *
 * @component
 * @param {NodeProps<PersonData>} props - React Flow node props carrying PersonData
 * @returns {React.ReactElement} Styled person card with name, birth/death years, and connection handles
 */
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

  const initials = data.name
    ? data.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('')
    : '?'

  const avatarBg =
    (data.generation ?? 0) < 0
      ? 'bg-indigo-900/40'
      : (data.generation ?? 0) > 0
        ? 'bg-emerald-900/40'
        : 'bg-white/10'

  return (
    <div
      className={`bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-4 py-3 min-w-[160px] ${glow} ${rootRing} hover:bg-white/15 hover:scale-[1.03] transition-all duration-200 cursor-pointer`}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${avatarBg}`}>
          {initials}
        </div>
        <div>
          <div className="font-semibold text-white text-sm tracking-wide">{data.name || <span className="text-slate-500 italic">Unknown</span>}</div>
          {dates && <div className="text-slate-400 text-xs mt-1">{dates}</div>}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
