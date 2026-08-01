'use client'

import { useCallback, useState } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { PersonData } from '@/types/tree'

/**
 * Sex tick colours per `docs/DESIGN_SYSTEM.md` §3.2 — the only tints
 * permitted outside the semantic colour set. Falls back to the neutral
 * `--ft-border-strong` token when sex is unknown.
 */
const SEX_TICK_COLOR: Record<string, string> = {
  M: '#4A7DB5',
  F: '#A85F86',
}

/** Screen-reader label so sex is never carried by colour alone (§7). */
const SEX_LABEL: Record<string, string> = {
  M: 'Male',
  F: 'Female',
}

/**
 * PersonNode renders a single person card within the React Flow canvas.
 *
 * Sex is encoded as a 3 px tick on the leading edge (backed by a
 * screen-reader label, never colour alone) and, when the person is the
 * current root, a brass border highlight. Invisible top/bottom handles allow
 * React Flow to connect edges while keeping the UI clean.
 *
 * @component
 * @param {NodeProps<PersonData>} props - React Flow node props carrying PersonData
 * @returns {React.ReactElement} Styled person card with name, birth/death years, and connection handles
 */
export default function PersonNode({ data }: NodeProps<PersonData>) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const handlePhotoError = useCallback(() => setPhotoFailed(true), [])
  const tickColor = SEX_TICK_COLOR[data.sex] ?? 'var(--ft-border-strong)'
  const sexLabel = SEX_LABEL[data.sex] ?? 'Sex unknown'
  const borderClass = data.isRoot ? 'border-2 border-brass' : 'border border-line'

  const dates = data.living
    ? 'Living'
    : [
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
        : 'bg-surface-2'

  return (
    <div
      className={`relative bg-surface ${borderClass} rounded-node px-4 py-3 w-[240px] overflow-hidden shadow-[var(--ft-shadow-1)] hover:border-[var(--ft-border-strong)] hover:shadow-[var(--ft-shadow-2)] transition-[border-color,box-shadow] duration-150 cursor-pointer`}
    >
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[3px]"
        style={{ backgroundColor: tickColor }}
      />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="flex items-center gap-2">
        {data.photoUrl && !photoFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.photoUrl}
            alt=""
            aria-hidden="true"
            data-testid="person-node-photo"
            onError={handlePhotoError}
            className="w-8 h-8 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-ink shrink-0 ${avatarBg}`}>
            {initials}
          </div>
        )}
        <div>
          <div className="font-serif font-semibold text-ink text-sm tracking-wide overflow-hidden whitespace-nowrap text-ellipsis" title={data.name ?? ''}>{data.name || <span className="text-ink-3 italic">Unknown</span>}</div>
          {dates && <div className="text-ink-3 text-xs mt-1" style={{ font: 'var(--ft-mono)' }}>{dates}</div>}
        </div>
      </div>
      <span className="sr-only">{sexLabel}</span>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
