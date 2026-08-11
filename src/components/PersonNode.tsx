'use client'

import { memo, useCallback, useState } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { PersonData } from '@/types/tree'
import { SEX_AVATAR_BG } from '@/constants/tree'

/** Screen-reader label so sex is never carried by colour alone (§7). */
const SEX_LABEL: Record<string, string> = {
  M: 'Male',
  F: 'Female',
}

/**
 * Level-of-detail variant selected by canvas zoom, per `docs/DESIGN_SYSTEM.md` §3.2:
 * `dot` below 0.45, `compact` between 0.45 and 0.85, `full` above 0.85.
 */
export type PersonNodeVariant = 'dot' | 'compact' | 'full'

/** `PersonData` plus the LOD variant chosen once at the canvas level and passed down to nodes. */
export type PersonNodeData = PersonData & { lodVariant?: PersonNodeVariant }

/** Falls back to `full` so callers that don't pass a variant (e.g. existing tests) keep prior behaviour. */
const DEFAULT_VARIANT: PersonNodeVariant = 'full'

/**
 * Composes a single accessible-name string carrying name, sex, and dates so
 * colour (the sex tick) is never the only carrier of information (§7), and so
 * the `dot` variant — which renders no visible text — still exposes a full
 * accessible name via `aria-label`/`title`.
 */
function buildAccessibleName(data: PersonData, sexLabel: string, dates: string): string {
  return [data.name || 'Unknown', sexLabel, dates].filter(Boolean).join(', ')
}

/**
 * Builds the `title` for the §3.2 "Has pending edit" indicator, e.g.
 * `"1 suggested edit awaiting review"` / `"3 suggested edits awaiting review"`.
 */
function buildPendingEditTitle(count: number): string {
  return `${count} suggested edit${count === 1 ? '' : 's'} awaiting review`
}

/**
 * PersonNode renders a single person card within the React Flow canvas.
 *
 * Renders one of three level-of-detail variants selected by canvas zoom
 * (`dot`, `compact`, `full`) so a zoomed-out canvas of hundreds of nodes
 * reads as shape rather than illegible text. Sex is encoded as a tick on the
 * leading edge (backed by an accessible name, never colour alone) and, when
 * the person is the current root, a brass border highlight; when the node is
 * the sticky selection (React Flow's own `selected`, wired up from
 * `selectedNodeId` in `FamilyTree`), an accent border and tinted background
 * take over per §3.2 — see the `borderClass`/`bgClass` precedence note below.
 * Invisible top/bottom handles allow React Flow to connect edges while
 * keeping the UI clean. Wrapped in `memo` so a continuous zoom gesture only
 * re-renders nodes when the discrete variant actually changes, not on every
 * frame.
 *
 * @component
 * @param {NodeProps<PersonNodeData>} props - React Flow node props carrying PersonData, the LOD variant, and the `selected` flag
 * @returns {React.ReactElement} Styled person card sized for the active LOD variant
 */
function PersonNode({ data, selected }: NodeProps<PersonNodeData>) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const handlePhotoError = useCallback(() => setPhotoFailed(true), [])
  const variant = data.lodVariant ?? DEFAULT_VARIANT
  const tickColor = SEX_AVATAR_BG[data.sex] ?? SEX_AVATAR_BG.default
  const sexLabel = SEX_LABEL[data.sex] ?? 'Sex unknown'
  /**
   * Per `docs/DESIGN_SYSTEM.md` §3.2, both Selected and Root specify a 2px
   * border, so a node that is both can only show one. Documented precedence
   * (issue #266 AC4): Selected — the live, user-driven interaction state —
   * wins the border and background. Root identity is never lost because its
   * brass `⌂` marker (rendered unconditionally below on `data.isRoot`, wholly
   * independent of `borderClass`) stays visible regardless of selection.
   */
  const borderClass = selected
    ? 'border-2 border-accent'
    : data.isRoot
      ? 'border-2 border-brass'
      : 'border border-line'
  /**
   * Per `docs/DESIGN_SYSTEM.md` §3.2 Living/private: `--ft-private-soft`
   * background. Selected takes the same precedence as `borderClass` above —
   * it wins over Living/private so the two 2px-border states stay visually
   * paired (matching border + background change together).
   */
  const bgClass = selected
    ? 'bg-[var(--ft-accent-soft)]'
    : data.living
      ? 'bg-[var(--ft-private-soft)]'
      : 'bg-surface'

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

  /**
   * Per `docs/DESIGN_SYSTEM.md` §0/§1: generation must not be encoded as an
   * avatar tint (an off-palette colour that neither survives a 400-person
   * tree nor belongs to the semantic/sex colour set). The initials avatar
   * always sits on the neutral `--ft-surface-2` token regardless of
   * generation.
   */
  const avatarBg = 'bg-surface-2'

  const accessibleName = buildAccessibleName(data, sexLabel, dates)

  /** Per `docs/DESIGN_SYSTEM.md` §3.2 "Has pending edit": 6px violet dot, top-right, with an explanatory title. */
  const pendingEdits = data.pendingEdits ?? 0
  const pendingEditTitle = pendingEdits > 0 ? buildPendingEditTitle(pendingEdits) : null

  if (variant === 'dot') {
    return (
      <div
        data-testid="person-node-dot"
        role="button"
        tabIndex={0}
        aria-label={accessibleName}
        title={accessibleName}
        className={`relative rounded-[3px] w-[10px] h-[10px] ${borderClass} cursor-pointer focus-visible:outline-none focus-visible:[box-shadow:var(--ft-focus)] max-sm:before:content-[''] max-sm:before:absolute max-sm:before:inset-[-17px]`}
        style={{ backgroundColor: tickColor }}
      >
        <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
        <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      </div>
    )
  }

  if (variant === 'compact') {
    return (
      <div
        data-testid="person-node-compact"
        role="button"
        tabIndex={0}
        aria-label={accessibleName}
        title={accessibleName}
        className={`relative flex items-center ${bgClass} ${borderClass} rounded-node px-4 h-10 w-[240px] overflow-hidden shadow-[var(--ft-shadow-1)] hover:border-[var(--ft-border-strong)] hover:shadow-[var(--ft-shadow-2)] transition-[border-color,box-shadow] duration-150 cursor-pointer focus-visible:outline-none focus-visible:[box-shadow:var(--ft-focus)]`}
      >
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[3px]"
          style={{ backgroundColor: tickColor }}
        />
        {data.isRoot && (
          <span aria-hidden="true" className="absolute top-0.5 right-1.5 text-brass text-sm leading-none">
            ⌂
          </span>
        )}
        {pendingEditTitle && (
          <span
            data-testid="person-node-pending-dot"
            title={pendingEditTitle}
            className="absolute -top-[3px] -right-[3px] w-1.5 h-1.5 rounded-full bg-pending"
          />
        )}
        <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
        <div className="font-serif font-semibold text-ink text-sm tracking-wide overflow-hidden whitespace-nowrap text-ellipsis">
          {data.name || <span className="text-ink-3 italic">Unknown</span>}
          {data.birthYear && <span className="text-ink-3 font-normal"> · b. {data.birthYear}</span>}
        </div>
        <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      </div>
    )
  }

  return (
    <div
      data-testid="person-node-full"
      role="button"
      tabIndex={0}
      aria-label={accessibleName}
      title={accessibleName}
      className={`relative ${bgClass} ${borderClass} rounded-node px-4 py-3 w-[240px] overflow-hidden shadow-[var(--ft-shadow-1)] hover:border-[var(--ft-border-strong)] hover:shadow-[var(--ft-shadow-2)] transition-[border-color,box-shadow] duration-150 cursor-pointer focus-visible:outline-none focus-visible:[box-shadow:var(--ft-focus)]`}
    >
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[3px]"
        style={{ backgroundColor: tickColor }}
      />
      {data.isRoot && (
        <span aria-hidden="true" className="absolute top-1 right-1.5 text-brass text-sm leading-none">
          ⌂
        </span>
      )}
      {pendingEditTitle && (
        <span
          data-testid="person-node-pending-dot"
          title={pendingEditTitle}
          className="absolute -top-[3px] -right-[3px] w-1.5 h-1.5 rounded-full bg-pending"
        />
      )}
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

export default memo(PersonNode)
