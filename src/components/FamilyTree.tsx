/**
 * @fileoverview Interactive family tree visualisation component.
 * Renders a ReactFlow canvas that fetches person/relationship data from the API,
 * applies a dagre hierarchical layout, and supports search, depth control,
 * node selection, and re-rooting the tree at any person.
 */

'use client'

import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo, useDeferredValue } from 'react'
import type React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useSession, signIn } from 'next-auth/react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  getViewportForBounds,
  type Node,
  type Edge,
  type ReactFlowState,
} from 'reactflow'
import 'reactflow/dist/style.css'

import PersonNode from '@/components/PersonNode'
import UnionNode from '@/components/UnionNode'
import ConfirmDialog from '@/components/ConfirmDialog'
import EmptyState from '@/components/EmptyState'
import SearchOverlay from '@/components/SearchOverlay'
import ViewerShell from '@/components/ViewerShell'
import { applyDagreLayout, GenerationLevel } from '@/lib/layout'
import { formatLifespan } from '@/lib/person'
import { buildTimeline, type TimelineEvent } from '@/lib/timeline'
import { computeLineage } from '@/lib/lineage'
import { resolveArrowTarget, resolveShellAction, type ArrowKey, type ShellView } from '@/lib/keyboardNav'
import type { TreeResponse, PersonData, UnionData, PersonDetailResponse, PersonSummary, FlowNode, FlowEdge } from '@/types/tree'
import { DEFAULT_HOPS, MIN_HOPS, MAX_HOPS, EDGE_STYLES, DEFAULT_ROOT_GEDCOM_ID, getDrawerContainerClass, DEFAULT_DRAWER_DETENT, type DrawerDetent, DRAWER_DRAG_HANDLE_CLASS, DRAWER_DRAG_HANDLE_BAR_CLASS, DRAWER_ACTIONS_CLASS, RESPONSIVE_BUTTON_BASE, BAND_VARS, LINEAGE_VARS, LINEAGE_DIM_TRANSITION_MS, getPersonLodVariant, STATUS_PILL_LIVING_CLASS, STATUS_PILL_PENDING_CLASS, STATUS_PILL_ROOT_CLASS, FACT_ROW_LABEL_CLASS, FACT_ROW_VALUE_CLASS, FACT_ROW_GHOST_CLASS, RELATIONSHIP_ROW_CLASS, EDGE_TYPES, EDGE_RENDER_TYPE, DEFAULT_DENSITY, getDefaultDensity } from '@/constants/tree'
import { APP_NAME } from '@/constants/branding'
import { parseTreeUrlState, buildTreeUrlPath, type TreeView } from '@/lib/treeUrlState'

/** Builds a minimal `PersonData` stub for a person id not present in the current tree view. */
function personStub(gedcomId: string): PersonData {
  return { gedcomId, name: '', sex: 'U', birthYear: null, deathYear: null, birthPlace: null, deathPlace: null, occupation: null, notes: null }
}

/**
 * Minimal person summary used for the search bar and root selection.
 * @property gedcomId - GEDCOM identifier of the person
 * @property name - Display name of the person
 * @property sex - Biological sex code ('M', 'F', or null)
 * @property birthYear - Four-digit birth year string, or null if unknown
 * @property birthPlace - Free-text birth location, or null if unknown
 * @property deathYear - Four-digit death year string, or null if unknown/still living
 */
interface Person { gedcomId: string; name: string; sex: string | null; birthYear: string | null; birthPlace: string | null; deathYear: string | null }

/** Map of custom node types for ReactFlow visualization. */
const nodeTypes = { person: PersonNode, union: UnionNode }

const ARROW_KEYS: readonly ArrowKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/** Narrows a raw `KeyboardEvent.key` string to {@link ArrowKey}. */
function isArrowKey(key: string): key is ArrowKey {
  return (ARROW_KEYS as readonly string[]).includes(key)
}

/**
 * Comfortable inset (px, screen space) kept between a freshly-focused node and the
 * canvas edge when arrow-key navigation pans it into view — matches the toolbar/minimap
 * clearance so the focus ring never hugs the viewport border (docs/DESIGN_SYSTEM.md §7).
 */
const FOCUS_VIEWPORT_MARGIN = 32

/** Default edge styling applied to all edges. */
const defaultEdgeStyle: React.CSSProperties = { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.5 }

/** Default configuration for all edges in the flow. */
const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
}

/**
 * Canvas chrome treatment (docs/DESIGN_SYSTEM.md §3.6) — the minimap, controls, and zoom
 * widget all take a solid `--ft-surface-0` fill with a 1 px `--ft-border` and `--ft-r-md`
 * corners, replacing the translucent/blurred glass panel styling.
 */
const CHROME_STYLE: React.CSSProperties = {
  background: 'var(--ft-surface-0)',
  border: '1px solid var(--ft-border)',
  borderRadius: 'var(--ft-r-md)',
}

/** Minimap panel size (docs/DESIGN_SYSTEM.md §3.6) — 160×120, bottom-right (component default). */
const MINIMAP_STYLE: React.CSSProperties = {
  ...CHROME_STYLE,
  width: 160,
  height: 120,
}

/**
 * Colors each minimap node mark `--ft-edge`, promoting the current root person to
 * `--ft-brass` so it stays identifiable at a glance (docs/DESIGN_SYSTEM.md §3.6).
 */
function minimapNodeColor(node: Node): string {
  return node.type === 'person' && (node.data as PersonData).isRoot ? 'var(--ft-brass)' : 'var(--ft-edge)'
}

/**
 * Button that copies a shareable tree-viewer URL to the clipboard via
 * `navigator.clipboard.writeText`, showing a transient "Copied!" or
 * "Copy failed" label for ~2s before reverting to the resting label.
 *
 * @param {Object} props - Component props
 * @param {Function} props.getUrl - Lazily builds the canonical URL to copy, evaluated on click
 * @param {string} props.testId - `data-testid` applied to the button
 * @param {string} [props.className] - Additional classes for styling
 * @returns {React.ReactElement} Rendered copy-link button
 */
function CopyLinkButton({
  getUrl,
  testId,
  className = '',
}: {
  getUrl: () => string
  testId: string
  className?: string
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(getUrl())
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setStatus('idle'), 2000)
  }

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={handleClick}
      aria-label="Copy shareable link"
      className={className}
    >
      {status === 'copied' ? 'Copied!' : status === 'failed' ? 'Copy failed' : 'Copy link'}
    </button>
  )
}

/**
 * Floating toolbar displaying the app name, tree statistics, and depth control.
 * Shows a small app title followed by ancestor/descendant counts and allows users
 * to adjust the viewing depth (hops).
 *
 * Below the `sm` (640px) breakpoint the toolbar starts collapsed behind a 44px
 * icon button that opens it as a sheet (docs/DESIGN_SYSTEM.md §4.2/§6 — "on
 * mobile it collapses to a single 44 px icon button that opens a sheet"); at
 * `sm` and up the toolbar is always shown via the `sm:flex` override below,
 * regardless of this state.
 *
 * @param {Object} props - Component props
 * @param {Node[]} props.nodes - All nodes in the current tree visualization
 * @param {string} props.rootName - Display name of the current root person
 * @param {number} props.hops - Current viewing depth (hops)
 * @param {Function} props.onHopsChange - Callback when user adjusts the depth stepper
 * @param {boolean} [props.truncated] - Whether the API response reported the tree was truncated
 * @param {number} [props.totalNodes] - Total node count reported by the API when truncated
 * @returns {React.ReactElement | null} Rendered toolbar or null if no persons are visible
 */
export function Toolbar({
  nodes,
  rootName,
  hops,
  onHopsChange,
  sliderMax = MAX_HOPS,
  getShareUrl,
  truncated = false,
  totalNodes,
}: {
  nodes: Node[]
  rootName: string
  hops: number
  onHopsChange: (hops: number) => void
  sliderMax?: number
  getShareUrl?: () => string
  truncated?: boolean
  totalNodes?: number
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const ancestorGens = nodes.filter(n => n.type === 'person').map(n => (n.data as PersonData).generation).filter((g): g is number => typeof g === 'number' && g < 0)
  const ancestors = ancestorGens.length > 0 ? Math.abs(Math.min(...ancestorGens)) : 0
  const descendantGens = nodes.filter(n => n.type === 'person').map(n => (n.data as PersonData).generation).filter((g): g is number => typeof g === 'number' && g > 0)
  const descendants = descendantGens.length > 0 ? Math.max(...descendantGens) : 0
  const personCount = nodes.filter(n => n.type === 'person').length
  if (personCount === 0) return null
  return (
    <>
      {!mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open toolbar"
          data-testid="toolbar-toggle"
          className="sm:hidden absolute bottom-4 left-4 z-10 min-h-11 min-w-11 flex items-center justify-center bg-slate-800 border border-white/20 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)] text-white focus:outline-none transition-colors"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <line x1="3" y1="6" x2="17" y2="6" strokeLinecap="round" />
            <line x1="3" y1="10" x2="17" y2="10" strokeLinecap="round" />
            <line x1="3" y1="14" x2="17" y2="14" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <div
        data-testid="toolbar"
        className={`${mobileOpen ? 'flex' : 'hidden'} sm:flex absolute bottom-4 inset-x-4 z-10 flex-wrap items-center justify-center gap-x-3 gap-y-2 bg-slate-800 border border-white/20 rounded-lg px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-auto sm:max-w-[calc(100vw-2rem)] sm:flex-nowrap sm:gap-4 sm:py-2`}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close toolbar"
          data-testid="toolbar-close"
          className="sm:hidden order-first min-h-11 min-w-11 -my-3 -ml-4 mr-1 flex items-center justify-center text-white/70 hover:text-white transition-colors flex-shrink-0"
        >
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <line x1="4" y1="4" x2="16" y2="16" strokeLinecap="round" />
            <line x1="16" y1="4" x2="4" y2="16" strokeLinecap="round" />
          </svg>
        </button>
        <span
        data-testid="toolbar-app-name"
        // Issue #275: between the `sm` breakpoint (640px, where `sm:flex-nowrap`
        // forbids wrapping) and ~800px, the toolbar's unshrinkable content
        // overflows both viewport edges. The app name is pure branding — it
        // carries no functional information the rest of the toolbar doesn't
        // already convey — so it's the safest item to drop entirely below
        // ~800px rather than fight for space with the stepper/counts that do
        // carry the toolbar's function.
        className="hidden min-[800px]:inline text-xs text-white font-semibold select-none pr-4 border-r border-white/20 tracking-wide flex-shrink-0 whitespace-nowrap"
      >
        {APP_NAME}
      </span>
      <span data-testid="toolbar-person-count" className="text-xs text-white/60 select-none flex-shrink-0 whitespace-nowrap">
        <span className="text-white font-medium">{personCount}</span> people
      </span>
      {truncated === true && (
        // Intentionally omits flex-shrink-0: this item absorbs tight-width pressure via
        // max-w-[10rem]/sm:max-w-[16rem] + text-ellipsis, while sibling items stay fixed-size.
        // The visible text is degraded to "⚠ + node count" (rather than the full prose) so this
        // remains the toolbar's widest contributor in name only, not in practice — the full
        // sentence is still available in `title` (e.g. on hover).
        // `min-w-[3rem]` (not `min-w-0`) is the floor that keeps it shrinkable but never zero-width:
        // with the #202 stepper widening the row, an unbounded shrink collapsed it entirely at
        // ~800px, silently dropping the #190 AC4 warning instead of ellipsising it.
        <span
          data-testid="toolbar-truncation-notice"
          role="status"
          title={`⚠ Tree truncated${typeof totalNodes === 'number' ? ` — showing a partial view of ${totalNodes} total nodes` : ''}`}
          className="text-xs text-amber-300 select-none max-w-[10rem] overflow-hidden whitespace-nowrap text-ellipsis min-w-[3rem] sm:max-w-[16rem]"
        >
          ⚠{typeof totalNodes === 'number' ? ` ${totalNodes}` : ' Truncated'}
        </span>
      )}
      <span data-testid="toolbar-gen-up" className="text-xs text-white/60 select-none flex-shrink-0 whitespace-nowrap">
        <span className="text-white font-medium">{ancestors}</span> gen up
      </span>
      <span data-testid="toolbar-gen-down" className="text-xs text-white/60 select-none flex-shrink-0 whitespace-nowrap">
        <span className="text-white font-medium">{descendants}</span> gen down
      </span>
      <span
        data-testid="toolbar-viewing"
        // Issue #275: the other widest non-essential contributor (see the
        // app-name comment above) between `sm` (640px) and ~800px. Unlike the
        // app name this still carries useful context, so instead of hiding it
        // outright it's bounded to a max-width with ellipsis truncation below
        // ~800px — the same one-line-with-ellipsis treatment already used for
        // `toolbar-truncation-notice` (#190) — and unbounded again at ~800px
        // and up, matching this row's existing behavior there.
        className="text-xs text-white/60 select-none flex-shrink-0 whitespace-nowrap overflow-hidden text-ellipsis max-w-[7rem] min-[800px]:max-w-none"
      >
        VIEWING: <span className="text-white font-medium">{rootName}</span>
      </span>
      <div
        data-testid="toolbar-depth-stepper"
        role="group"
        aria-label="Depth"
        className="flex items-center gap-1 flex-shrink-0"
      >
        <button
          type="button"
          data-testid="toolbar-depth-decrement"
          aria-label="Decrease depth"
          disabled={hops <= MIN_HOPS}
          onClick={() => onHopsChange(Math.max(MIN_HOPS, hops - 1))}
          className="flex items-center justify-center w-11 h-11 sm:w-6 sm:h-6 rounded-lg text-white/80 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors flex-shrink-0"
        >
          −
        </button>
        <span
          data-testid="toolbar-depth-value"
          aria-live="polite"
          className="text-xs text-white font-medium select-none w-5 text-center flex-shrink-0"
        >
          {hops}
        </span>
        <button
          type="button"
          data-testid="toolbar-depth-increment"
          aria-label="Increase depth"
          disabled={hops >= sliderMax}
          onClick={() => onHopsChange(Math.min(sliderMax, hops + 1))}
          className="flex items-center justify-center w-11 h-11 sm:w-6 sm:h-6 rounded-lg text-white/80 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors flex-shrink-0"
        >
          +
        </button>
      </div>
      {getShareUrl && (
        <CopyLinkButton
          getUrl={getShareUrl}
          testId="toolbar-copy-link"
          className="text-xs text-white/60 hover:text-white select-none pl-4 border-l border-white/20 transition-colors flex-shrink-0 whitespace-nowrap"
        />
      )}
      <Link
        href="/stats"
        data-testid="toolbar-stats-link"
        className="text-xs text-white/60 hover:text-white select-none pl-4 border-l border-white/20 transition-colors flex-shrink-0 whitespace-nowrap"
      >
        Stats
      </Link>
      </div>
    </>
  )
}

/**
 * A list row displaying a person in the drawer's Relationships section
 * (docs/DESIGN_SYSTEM.md §4.1: "each a tappable row (44 px) that re-roots
 * the tree"). Tapping anywhere on the row re-roots the tree on that person;
 * rows are 44 px tall to meet the drawer's touch-target floor (§6). Only
 * rendered while the drawer is in view mode, never mid-edit.
 *
 * @param {Object} props - Component props
 * @param {PersonSummary} props.person - Person to display
 * @param {Function} props.onReroot - Called with person's gedcomId when the row is tapped
 * @param {boolean} [props.small=false] - Render in compact text styling for nested lists (still 44 px tall)
 * @returns {React.ReactElement} Rendered person row
 */
function RelativeRow({
  person,
  onReroot,
  small = false,
}: {
  person: PersonSummary
  onReroot: (id: string) => void
  small?: boolean
}) {
  return (
    <button
      type="button"
      data-testid="relative-row"
      aria-label={`Focus tree on ${person.name || 'person'}`}
      onClick={() => onReroot(person.gedcomId)}
      className={`${RELATIONSHIP_ROW_CLASS} ${small ? 'text-xs text-white/60 hover:text-white/80' : 'text-sm text-white/80 hover:text-white'}`}
    >
      <span className="font-medium">{person.name || 'Unknown'}</span>
      {person.birthYear && (
        <span className={`text-xs ${small ? 'text-slate-600' : 'text-slate-500'}`}>{person.birthYear}</span>
      )}
    </button>
  )
}

/**
 * Mobile drag handle affordance for bottom-sheet drawers. Also the tap target that
 * toggles between the `peek` (~30vh) and `full` (72vh) detents (docs/DESIGN_SYSTEM.md §6).
 */
function DrawerDragHandle({ detent, onToggle }: { detent: DrawerDetent; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="drawer-drag-handle"
      onClick={onToggle}
      aria-label={detent === 'full' ? 'Collapse drawer' : 'Expand drawer'}
      aria-expanded={detent === 'full'}
      className={DRAWER_DRAG_HANDLE_CLASS}
    >
      <div className={DRAWER_DRAG_HANDLE_BAR_CLASS} />
    </button>
  )
}

/**
 * A single label/value row in the person drawer's Facts list (docs/DESIGN_SYSTEM.md §4.1).
 * Rows are separated by full-bleed 1px rules via the parent's `divide-y`, not gaps.
 *
 * @param {Object} props - Component props
 * @param {string} props.label - Fact label, e.g. "Born"
 * @param {React.ReactNode} props.value - Fact value to display
 * @param {boolean} [props.mono=false] - Render the value in monospace (dates, places, ids)
 * @param {boolean} [props.wrap=false] - Allow the value to wrap instead of truncating (long notes)
 * @param {string} [props.testId] - Optional `data-testid` for the row
 * @returns {React.ReactElement} Rendered fact row
 */
function FactRow({
  label,
  value,
  mono = false,
  wrap = false,
  testId,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  wrap?: boolean
  testId?: string
}) {
  return (
    <div data-testid={testId} className="flex items-baseline justify-between gap-4 py-[var(--ft-row-gap)]">
      <span className={FACT_ROW_LABEL_CLASS}>{label}</span>
      <span className={`${FACT_ROW_VALUE_CLASS} ${mono ? '!font-mono' : ''} ${wrap ? 'whitespace-pre-wrap' : 'truncate'}`}>
        {value}
      </span>
    </div>
  )
}

/**
 * A Facts row shown when its value is empty: the label stays put, and an
 * inline `+ Add …` ghost button takes the value slot instead of a dash
 * (docs/DESIGN_SYSTEM.md §4.1). Clicking it jumps straight into the edit
 * sub-view with that field expanded for immediate entry.
 *
 * @param {Object} props - Component props
 * @param {string} props.label - Fact label, e.g. "Birthplace"
 * @param {string} props.addLabel - Field name used in the button text, e.g. "birth place"
 * @param {Function} props.onClick - Called when the ghost button is activated
 * @param {string} [props.testId] - Optional `data-testid` for the button
 * @returns {React.ReactElement} Rendered ghost Facts row
 */
function FactRowGhostButton({
  label,
  addLabel,
  onClick,
  testId,
}: {
  label: string
  addLabel: string
  onClick: () => void
  testId?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[var(--ft-row-gap)]">
      <span className={FACT_ROW_LABEL_CLASS}>{label}</span>
      <button type="button" data-testid={testId} onClick={onClick} className={FACT_ROW_GHOST_CLASS}>
        + Add {addLabel}
      </button>
    </div>
  )
}

const TIMELINE_ICONS: Record<TimelineEvent['type'], string> = {
  birth: '🎂',
  marriage: '💍',
  child: '👶',
  death: '⚰️',
}

/**
 * Renders a single chronological entry in the Timeline section: an icon,
 * a label describing the event (with a clickable person link for marriages
 * and child births), the place, and — for deaths — age at death.
 */
function TimelineEntry({ event, onSelect }: { event: TimelineEvent; onSelect: (id: string) => void }) {
  let label: React.ReactNode
  switch (event.type) {
    case 'birth':
      label = 'Born'
      break
    case 'marriage':
      label = (
        <>
          Married{' '}
          {event.person ? (
            <button
              type="button"
              onClick={() => onSelect(event.person!.gedcomId)}
              className="text-indigo-400 hover:text-indigo-300 underline transition-colors"
            >
              {event.person.name || 'Unknown'}
            </button>
          ) : (
            'Unknown'
          )}
        </>
      )
      break
    case 'child':
      label = (
        <>
          Child born:{' '}
          {event.person ? (
            <button
              type="button"
              onClick={() => onSelect(event.person!.gedcomId)}
              className="text-indigo-400 hover:text-indigo-300 underline transition-colors"
            >
              {event.person.name || 'Unknown'}
            </button>
          ) : (
            'Unknown'
          )}
        </>
      )
      break
    case 'death':
      label = `Died${event.age !== null ? `, aged ${event.age}` : ''}`
      break
  }

  return (
    <li className="flex items-start gap-2 text-sm text-white/80">
      <span aria-hidden="true">{TIMELINE_ICONS[event.type]}</span>
      <span>
        <span className="text-slate-500 text-xs mr-2">{event.dateUnknown ? '—' : event.year}</span>
        {label}
        {event.place && <span className="text-slate-500 text-xs"> · {event.place}</span>}
      </span>
    </li>
  )
}

/**
 * A shared header/container for sub-views within the PersonDrawer.
 * Provides a back button and title for nested views like edit and add-relative modes.
 *
 * @param {Object} props - Component props
 * @param {string} props.title - Title to display in the header
 * @param {Function} props.onBack - Called when user clicks the back button
 * @param {DrawerDetent} props.detent - Current mobile bottom-sheet detent ('peek' or 'full')
 * @param {Function} props.onToggleDetent - Called when the drag handle is tapped to toggle the detent
 * @param {React.ReactNode} props.children - Content to render below the header
 * @returns {React.ReactElement} Rendered drawer sub-view container
 */
function DrawerSubView({
  title,
  onBack,
  detent,
  onToggleDetent,
  children,
}: {
  title: string
  onBack: () => void
  detent: DrawerDetent
  onToggleDetent: () => void
  children: React.ReactNode
}) {
  return (
    <div
      data-testid="drawer-sub-view"
      className={getDrawerContainerClass(detent)}
    >
      <DrawerDragHandle detent={detent} onToggle={onToggleDetent} />
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
        <button
          onClick={onBack}
          aria-label="Back"
          className={RESPONSIVE_BUTTON_BASE}
        >
          ←
        </button>
        <h2 className="text-white font-semibold text-sm truncate flex-1">{title}</h2>
      </div>
      {children}
    </div>
  )
}

/**
 * Number of connections to show in the cascade-delete confirm dialog.
 * Falls back to the total parent/marriage count when relationshipChanges is
 * missing, so the dialog never understates what will be deleted as "0".
 */
export function computeCascadeDeleteConnectionCount(
  relationshipChanges: Array<unknown> | null | undefined,
  totalConnections: number
): number {
  return relationshipChanges?.length ?? totalConnections
}

/** ReactFlow store selectors (constant to avoid recreation on every render). */
const selectCanvasWidth = (s: ReactFlowState) => s.width
const selectCanvasHeight = (s: ReactFlowState) => s.height
const selectTransform = (s: ReactFlowState) => s.transform
/** Zoom factor only (`transform[2]`) — the single subscription point for node level-of-detail (docs/DESIGN_SYSTEM.md §3.2). */
const selectZoom = (s: ReactFlowState) => s.transform[2]

/**
 * Side drawer panel showing details for a selected person.
 * Fetches and displays name, dates, GEDCOM ID, and immediate relatives
 * (parents, siblings, marriages). Allows re-rooting or navigating to relatives.
 * When signed in, shows buttons to add relatives via search or create form.
 *
 * @param {PersonData} person - Person to display details for
 * @param {Function} onClose - Called when user closes the drawer
 * @param {Function} onReroot - Called with person's gedcomId to re-root the tree
 * @param {Function} onSelectPerson - Called with gedcomId to open another person's drawer
 * @param {Function} [onSelectRoot] - Called to refresh the tree after adding a relative
 * @param {string} [rootName] - Display name of the current tree root, used to label the relationship calculator
 */
export function PersonDrawer({
  person,
  onClose,
  onReroot,
  onSelectPerson,
  onSelectRoot,
  rootId,
  rootName,
  getShareUrl,
}: {
  person: PersonData
  onClose: () => void
  onReroot: (id: string) => void
  onSelectPerson: (id: string) => void
  onSelectRoot?: (id: string) => void
  rootId?: string
  rootName?: string
  getShareUrl?: () => string
}) {
  const { data: session, status } = useSession()
  const isSignedIn = status === 'authenticated'
  const isAdmin = session?.user?.role === 'admin'

  const dates = formatLifespan(person)
  const rootLabel = rootName || 'root'
  // Mobile bottom-sheet detent (docs/DESIGN_SYSTEM.md §6): opens at `peek`, tapping the
  // drag handle toggles to `full`. Reset per person below so re-opening the drawer for a
  // different person always starts collapsed.
  const [detent, setDetent] = useState<DrawerDetent>(DEFAULT_DRAWER_DETENT)
  const toggleDetent = useCallback(() => {
    setDetent(prev => (prev === 'peek' ? 'full' : 'peek'))
  }, [])
  // Reset the detent when the drawer switches to a different person. Adjusted during
  // render (React's "adjusting state when a prop changes" pattern) rather than in an
  // effect, so re-opening the drawer for someone else always starts collapsed without
  // an extra post-commit render pass.
  const [detentPersonId, setDetentPersonId] = useState(person.gedcomId)
  if (detentPersonId !== person.gedcomId) {
    setDetentPersonId(person.gedcomId)
    setDetent(DEFAULT_DRAWER_DETENT)
  }
  const [detail, setDetail] = useState<PersonDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailVersion, setDetailVersion] = useState(0)

  // Prefer the fetched detail record's name over the summary `person` prop, which is
  // empty (`personStub`) when a Timeline link targets someone outside the current tree
  // view — `detail` fills in once its fetch resolves, but `person` itself never does.
  const displayName = detail?.name || person.name

  const [mode, setMode] = useState<'view' | 'add-relative' | 'edit'>('view')

  const [editBirthPlace, setEditBirthPlace] = useState('')
  const [addRelativeType, setAddRelativeType] = useState<'parent' | 'spouse' | 'child'>('child')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Person[]>([])
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)

  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [newBirthYear, setNewBirthYear] = useState('')
  const [newSex, setNewSex] = useState('U')

  const [editGivenName, setEditGivenName] = useState('')
  const [editFamilyName, setEditFamilyName] = useState('')
  const [editSex, setEditSex] = useState('U')
  const [editBirthYear, setEditBirthYear] = useState('')
  const [editDiedYear, setEditDiedYear] = useState('')
  const [editDeathPlace, setEditDeathPlace] = useState('')
  const [editOccupation, setEditOccupation] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoUploadAbortRef = useRef<AbortController | null>(null)
  const [showEditBirthPlace, setShowEditBirthPlace] = useState(false)
  const [showEditDiedYear, setShowEditDiedYear] = useState(false)
  const [showEditDeathPlace, setShowEditDeathPlace] = useState(false)
  const [showEditOccupation, setShowEditOccupation] = useState(false)
  const [showEditNotes, setShowEditNotes] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingRemoveParentId, setPendingRemoveParentId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [suggestionSubmitted, setSuggestionSubmitted] = useState(false)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)

  const [relationship, setRelationship] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'success'; label: string }
  >({ status: 'idle' })
  const relationshipAbortRef = useRef<AbortController | null>(null)

  const [myChanges, setMyChanges] = useState<{
    createChange: { id: string; changeType: string; targetId: string; newValue: Record<string, unknown>; appliedAt: string } | null
    relationshipChanges: Array<{ id: string; newValue: Record<string, unknown>; appliedAt: string }>
    updateChanges: Array<{ id: string; newValue: Record<string, unknown>; appliedAt: string }>
  } | null>(null)

  // Reset the detail record and enter the loading state as soon as we know we're
  // fetching for a new person/version, adjusted during render rather than as a
  // synchronous setState at the top of the effect below (which would otherwise
  // trigger cascading renders).
  const detailFetchKey = `${person.gedcomId}:${detailVersion}`
  const [loadedDetailKey, setLoadedDetailKey] = useState<string | null>(null)
  if (loadedDetailKey !== detailFetchKey) {
    setLoadedDetailKey(detailFetchKey)
    setDetail(null)
    setDetailLoading(true)
  }

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false
    fetch(`/api/person/${encodeURIComponent(person.gedcomId)}`, { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<PersonDetailResponse>
      })
      .then(data => { if (!cancelled) setDetail(data) })
      .catch(err => {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Failed to fetch person detail', err)
        }
      })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true; ctrl.abort() }
  }, [person.gedcomId, detailVersion])

  // Same render-time-adjustment pattern as `detailFetchKey` above: clear the
  // previous person's changes before the fetch below runs, without a synchronous
  // setState inside the effect body.
  const myChangesFetchKey = `${person.gedcomId}:${detailVersion}`
  const [loadedMyChangesKey, setLoadedMyChangesKey] = useState<string | null>(null)
  if (loadedMyChangesKey !== myChangesFetchKey) {
    setLoadedMyChangesKey(myChangesFetchKey)
    setMyChanges(null)
  }

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false
    fetch(`/api/person/${encodeURIComponent(person.gedcomId)}/my-changes`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return
        // Only accept responses that match the expected shape; guards against
        // unmocked test environments that might serve arbitrary JSON here.
        if (
          Array.isArray(data.relationshipChanges) &&
          Array.isArray(data.updateChanges) &&
          (data.createChange === null ||
            (typeof data.createChange === 'object' && typeof data.createChange.id === 'string'))
        ) {
          setMyChanges(data)
        }
      })
      .catch(err => {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Failed to fetch my-changes', err)
        }
      })
    return () => { cancelled = true; ctrl.abort() }
  }, [person.gedcomId, detailVersion])

  // Aborts any in-flight photo upload when the drawer switches to a different
  // person, so a stale response can't overwrite the new person's edit form.
  useEffect(() => {
    return () => { photoUploadAbortRef.current?.abort() }
  }, [person.gedcomId])

  // Relationship calculation is on-demand (triggered by the button below), so
  // reset any previous result whenever the selected person or root changes —
  // adjusted during render, per the pattern above — and abort any in-flight
  // request on that change or on unmount.
  const relationshipKey = `${person.gedcomId}:${rootId ?? ''}`
  const [trackedRelationshipKey, setTrackedRelationshipKey] = useState(relationshipKey)
  if (trackedRelationshipKey !== relationshipKey) {
    setTrackedRelationshipKey(relationshipKey)
    setRelationship({ status: 'idle' })
  }
  useEffect(() => {
    return () => { relationshipAbortRef.current?.abort() }
  }, [person.gedcomId, rootId])

  const handleCalculateRelationship = async () => {
    if (!rootId) return
    relationshipAbortRef.current?.abort()
    const abortCtrl = new AbortController()
    relationshipAbortRef.current = abortCtrl
    setRelationship({ status: 'loading' })
    try {
      const res = await fetch(
        `/api/relationship?from=${encodeURIComponent(rootId)}&to=${encodeURIComponent(person.gedcomId)}`,
        { signal: abortCtrl.signal }
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof body?.error === 'string' ? body.error : 'Failed to calculate relationship. Please try again.'
        setRelationship({ status: 'error', message })
        return
      }
      setRelationship({ status: 'success', label: body.label })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('Failed to calculate relationship', err)
      setRelationship({ status: 'error', message: 'Failed to calculate relationship. Please try again.' })
    }
  }

  /**
   * Revert a change via POST /api/changes/[id]/revert.
   * Returns `{ ok: true }` on 2xx or `{ ok: false, detail }` on failure,
   * pulling a human-readable message from `conflictingChange.detail` or
   * `error` in the response body.
   */
  const revertChangeRequest = async (
    changeId: string
  ): Promise<{ ok: true } | { ok: false; detail: string }> => {
    const res = await fetch(`/api/changes/${encodeURIComponent(changeId)}/revert`, { method: 'POST' })
    if (res.ok) return { ok: true }
    const body = await res.json().catch(() => ({}))
    const detail = body?.conflictingChange?.detail ?? body?.error ?? 'Revert failed'
    return { ok: false, detail: String(detail) }
  }

  // Clear stale search results as soon as the add-relative search becomes inactive
  // (mode changes away from add-relative, or the query is cleared) — adjusted
  // during render rather than via a synchronous setState in the effect below.
  const searchActive = mode === 'add-relative' && !!searchQuery.trim()
  const [wasSearchActive, setWasSearchActive] = useState(searchActive)
  if (wasSearchActive !== searchActive) {
    setWasSearchActive(searchActive)
    if (!searchActive && searchResults.length > 0) setSearchResults([])
  }

  useEffect(() => {
    if (!searchActive) return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (searchAbortRef.current) searchAbortRef.current.abort()
    searchTimerRef.current = setTimeout(() => {
      const abortCtrl = new AbortController()
      searchAbortRef.current = abortCtrl
      fetch(`/api/persons?q=${encodeURIComponent(searchQuery)}`, { signal: abortCtrl.signal })
        .then(r => r.ok ? r.json() as Promise<Person[]> : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(data => { if (!abortCtrl.signal.aborted) setSearchResults(data) })
        .catch(err => { if (err instanceof Error && err.name !== 'AbortError') console.error('Search failed', err) })
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      if (searchAbortRef.current) searchAbortRef.current.abort()
    }
  }, [searchQuery, mode, searchActive])

  /** Clears all form state for adding a relative, preparing for a new add-relative flow. */
  const resetAddRelativeForm = () => {
    setSearchQuery('')
    setSearchResults([])
    setGivenName('')
    setFamilyName('')
    setNewBirthYear('')
    setNewSex('U')
  }

  /**
   * Opens the add-relative sub-view for the specified relationship type.
   * @param {string} type - Relationship type: 'parent', 'spouse', or 'child'
   */
  const openAddRelative = (type: 'parent' | 'spouse' | 'child') => {
    setAddRelativeType(type)
    resetAddRelativeForm()
    setActionError(null)
    setSuggestionSubmitted(false)
    setSuggestionError(null)
    setMode('add-relative')
  }

  /**
   * Submit a relationship change for the target person.
   *
   * Non-admin users adding a *parent* route through `/api/suggestions` for
   * moderation; every other case (and every admin case) links directly via the
   * relationships endpoint and goes live immediately.
   *
   * A failed suggestion POST is handled here rather than left to the caller's
   * generic catch: it must never fall through to the direct-link path below
   * (that would silently write a live relationship after moderation was
   * declined), and the drawer must return to view mode so the error is
   * rendered where the success confirmation would have appeared — the
   * add-relative sub-view carries no `person-drawer` test id, so an error left
   * there is invisible to anything scoped to the drawer.
   */
  const submitRelationshipChange = async (targetId: string) => {
    if (!isAdmin && addRelativeType === 'parent') {
      let suggestRes: Response
      try {
        suggestRes = await fetch('/api/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            changeType: 'ADD_RELATIONSHIP',
            payload: { type: addRelativeType, targetId, childId: person.gedcomId },
          }),
        })
      } catch (err) {
        console.error('Failed to submit suggestion', err)
        setSuggestionError('Failed to submit suggestion. Please try again.')
        setMode('view')
        return
      }
      if (!suggestRes.ok) {
        console.error('Failed to submit suggestion', new Error(`HTTP ${suggestRes.status}`))
        setSuggestionError('Failed to submit suggestion. Please try again.')
        setMode('view')
        return
      }
      resetAddRelativeForm()
      setMode('view')
      setSuggestionError(null)
      setSuggestionSubmitted(true)
      return
    }
    const res = await fetch(`/api/person/${encodeURIComponent(person.gedcomId)}/relationships`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, type: addRelativeType }),
    })
    if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`)
    resetAddRelativeForm()
    setMode('view')
    setDetailVersion(v => v + 1)
    onSelectRoot?.(person.gedcomId)
  }

  /**
   * Links an existing person as a relative and returns to view mode.
   * Refreshes the person detail and parent drawer after successful link.
   * @param {Person} relative - The person to link as a relative
   */
  const handleSelectRelative = async (relative: Person) => {
    setIsSubmitting(true)
    try {
      await submitRelationshipChange(relative.gedcomId)
    } catch (err) {
      console.error('Failed to add relative', err)
      setActionError('Failed to add relative. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Creates a new person and links them as a relative in a single operation.
   * Silently fails if no name is provided. Refreshes person detail on success.
   */
  const handleCreateAndLink = async () => {
    if (!givenName.trim() || !familyName.trim()) {
      setActionError('Both given name and family name are required.')
      return
    }
    const fullName = `${givenName.trim()} ${familyName.trim()}`
    setIsSubmitting(true)
    try {
      const createRes = await fetch('/api/persons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fullName, sex: newSex || null, birthYear: newBirthYear || null }),
      })
      if (!createRes.ok) throw new Error(`HTTP ${createRes.status}`)
      const newPerson = await createRes.json() as Person
      await submitRelationshipChange(newPerson.gedcomId)
    } catch (err) {
      console.error('Failed to create and link relative', err)
      setActionError('Failed to create and link person. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * True when the detail record has direct edges (parents or marriages) on the Person
   * node. When true, delete uses the cascade-revert endpoint instead of the simple
   * change revert, so all connected Union nodes are cleaned up atomically.
   */
  const detailHasRelationships = !!(
    detail && (detail.parents.length > 0 || detail.marriages.length > 0)
  )

  // True when connections exist that the current user did not author — determined
  // client-side by checking each live parent/spouse connection against the user's
  // own relationship changes, avoiding a server round-trip. Must compare per
  // connection (by type + targetId) rather than by count: an equal tally can still
  // hide foreign connections when the user's changes reference different people
  // (e.g. a child added elsewhere) than the person's current parents/spouse.
  const authoredConnectionTargetIds = new Set(
    (myChanges?.relationshipChanges ?? [])
      .filter(c => c.newValue?.type === 'parent' || c.newValue?.type === 'spouse')
      .map(c => c.newValue?.targetId as string | undefined)
      .filter((id): id is string => !!id)
  )
  // Some ADD_RELATIONSHIP records carry only `unionId` in `newValue`, with no
  // `type`/`targetId` (the server's own cascade-revert authorship check — see
  // src/lib/cascade-revert.ts — keys solely on unionId for exactly this reason).
  // `detail.parents` has no unionId to match against client-side, so these can't
  // be tied to one specific connection. Rather than assume every one of them is
  // foreign, give each an unmatched connection to account for — bounded by how
  // many the per-connection check above couldn't already explain. A record whose
  // `type` doesn't match ('child', etc.) is real signal, not missing data, and
  // must NOT fall into this bucket.
  const untypedRelationshipChangeCount = (myChanges?.relationshipChanges ?? [])
    .filter(c => c.newValue?.type == null).length
  const unmatchedConnectionCount = detailHasRelationships && myChanges
    ? detail!.parents.filter(p => !authoredConnectionTargetIds.has(p.gedcomId)).length +
      detail!.marriages.filter(m => !m.spouse?.gedcomId || !authoredConnectionTargetIds.has(m.spouse.gedcomId)).length
    : 0
  const hasForeignConnections = detailHasRelationships && !!myChanges &&
    unmatchedConnectionCount > untypedRelationshipChangeCount

  /**
   * Calls the cascade-revert endpoint to atomically remove the person and all
   * connected unions. Invoked after the user confirms via the in-app modal.
   */
  const performCascadeDelete = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/person/${encodeURIComponent(person.gedcomId)}/cascade-revert`, { method: 'POST' })
      if (res.ok) {
        setMyChanges(null)
        const connectedId =
          detail?.parents[0]?.gedcomId ??
          detail?.marriages[0]?.spouse?.gedcomId ??
          null
        const refreshId = connectedId ?? (rootId && rootId !== person.gedcomId ? rootId : '')
        onSelectRoot?.(refreshId)
        onClose()
      } else if (res.status === 403) {
        const body = await res.json().catch(() => ({})) as { blockedBy?: Array<{ authorName: string }> }
        const names = body.blockedBy?.map(b => b.authorName).filter(Boolean).join(', ')
        setActionError(names
          ? `Connections added by ${names} cannot be removed. Contact an admin.`
          : 'Some connections cannot be removed. Contact an admin.')
      } else {
        const body = await res.json().catch(() => ({})) as {
          error?: string
          conflictingChange?: { detail?: string }
        }
        setActionError(body.conflictingChange?.detail ?? body.error ?? 'Failed to delete person. Please try again.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Reverts the CREATE_PERSON change for a person with no relationships.
   * Invoked after the user confirms via the in-app modal.
   */
  const performSimpleDelete = async () => {
    if (!myChanges?.createChange) return
    setIsSubmitting(true)
    try {
      const result = await revertChangeRequest(myChanges.createChange.id)
      if (result.ok) {
        setMyChanges(null)
        const refreshId = rootId && rootId !== person.gedcomId ? rootId : ''
        onSelectRoot?.(refreshId)
        onClose()
      } else {
        setActionError(result.detail)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const openConfirm = (message: string, onConfirm: () => void | Promise<void>) => {
    if (isSubmitting) return
    setConfirmAction({
      message,
      onConfirm: () => { setConfirmAction(null); void onConfirm() },
    })
  }

  /**
   * Deletes the current person. When the person has relationships, uses the
   * cascade-revert endpoint to atomically remove all connected unions;
   * otherwise reverts the CREATE_PERSON change directly. Either path is
   * gated behind the in-app confirm modal instead of `window.confirm()`.
   */
  const handleDeletePerson = () => {
    if (!myChanges?.createChange) return

    if (detailHasRelationships) {
      const connCount = computeCascadeDeleteConnectionCount(
        myChanges.relationshipChanges,
        detail!.parents.length + detail!.marriages.length
      )
      openConfirm(
        `Delete ${person.name || 'this person'} and remove all ${connCount} of their connections? This cannot be undone.`,
        performCascadeDelete
      )
      return
    }

    openConfirm(
      `Delete ${person.name || 'this person'}? This cannot be undone.`,
      performSimpleDelete
    )
  }

  /**
   * Removes a marriage/union by reverting the author's ADD_RELATIONSHIP change for it.
   * On success, bumps `detailVersion` so both the person detail and `my-changes`
   * re-fetch (the marriage disappears from the list). On 409 surfaces the detail
   * inline via `actionError`.
   * @param {string} changeId - id of the `ADD_RELATIONSHIP` Change to revert
   */
  const performRemoveMarriage = async (changeId: string) => {
    setIsSubmitting(true)
    try {
      const result = await revertChangeRequest(changeId)
      if (result.ok) {
        onSelectRoot?.(person.gedcomId)
        setDetailVersion(v => v + 1)
      } else {
        setActionError(result.detail)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRemoveMarriage = (changeId: string) => {
    openConfirm('Remove this marriage? This cannot be undone.', () => performRemoveMarriage(changeId))
  }

  /**
   * Reverts an `ADD_RELATIONSHIP` change of `type: 'parent'`, removing the
   * Union node and its UNION/CHILD edges. Bumps `detailVersion` so the drawer
   * refetches detail and `my-changes`. On 409 surfaces the detail inline.
   */
  const handleRemoveParent = async (changeId: string) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await revertChangeRequest(changeId)
      if (result.ok) {
        onSelectRoot?.(person.gedcomId)
        setDetailVersion(v => v + 1)
      } else {
        setActionError(result.detail)
      }
    } finally {
      setIsSubmitting(false)
      setPendingRemoveParentId(null)
    }
  }

  /**
   * Reverts one of this author's UPDATE_PERSON changes on this person.
   * On success, bumps `detailVersion` so the "Your edits" list shrinks and the
   * person detail reflects the restored previousValue. On 409 surfaces the detail
   * inline via `actionError`.
   * @param {string} changeId - id of the `UPDATE_PERSON` Change to revert
   */
  const performRevertEdit = async (changeId: string) => {
    setIsSubmitting(true)
    try {
      const result = await revertChangeRequest(changeId)
      if (result.ok) {
        onSelectRoot?.(person.gedcomId)
        setDetailVersion(v => v + 1)
      } else {
        setActionError(result.detail)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRevertEdit = (changeId: string) => {
    openConfirm('Revert this edit? The previous values will be restored.', () => performRevertEdit(changeId))
  }

  /** Resets all edit fields from the current person/detail. */
  const resetEditForm = () => {
    setEditGivenName(person.givenName ?? '')
    setEditFamilyName(person.surname ?? '')
    setEditSex(person.sex ?? 'U')
    setEditBirthYear(person.birthYear ?? '')
    setEditBirthPlace(detail?.birthPlace ?? '')
    setEditDiedYear(person.deathYear ?? '')
    setEditDeathPlace(person.deathPlace ?? '')
    setEditOccupation(person.occupation ?? '')
    setEditNotes(person.notes ?? '')
    setEditPhotoUrl(detail?.photoUrl ?? person.photoUrl ?? null)
    setShowEditBirthPlace(!!(detail?.birthPlace))
    setShowEditDiedYear(!!(person.deathYear))
    setShowEditDeathPlace(!!(person.deathPlace))
    setShowEditOccupation(!!(person.occupation))
    setShowEditNotes(!!(person.notes))
    setActionError(null)
  }

  /** Opens the edit sub-view, initializing all edit fields from current person/detail. */
  const openEdit = () => {
    resetEditForm()
    setMode('edit')
  }

  /**
   * Opens the edit sub-view with a single optional field pre-expanded, so a
   * Facts row's "+ Add …" ghost button drops the user straight into that
   * field's input rather than the generic edit form.
   * @param {Function} expandField - Setter that reveals the target field's input (e.g. `() => setShowEditBirthPlace(true)`)
   */
  const openEditField = (expandField: () => void) => {
    resetEditForm()
    expandField()
    setMode('edit')
  }

  /**
   * Handles a Facts ghost "+ Add …" button click. Signed-out visitors are
   * prompted to sign in first (mirrors the footer's "Sign in to suggest
   * edits" CTA); signed-in users jump straight into the edit sub-view with
   * the field expanded.
   * @param {Function} expandField - Setter that reveals the target field's input
   */
  const handleAddFact = (expandField: () => void) => {
    if (!isSignedIn) {
      signIn('google')
      return
    }
    openEditField(expandField)
  }

  /** Discards pending edits and returns to view mode. */
  const handleCancelEdit = () => {
    resetEditForm()
    setMode('view')
  }

  /**
   * Uploads the selected file to the person's photo route and stores the
   * returned URL in `editPhotoUrl`, to be submitted via save/suggest.
   */
  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setActionError('Photo must be a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setActionError('Photo must be 5 MB or smaller.')
      return
    }
    photoUploadAbortRef.current?.abort()
    const ctrl = new AbortController()
    photoUploadAbortRef.current = ctrl
    setPhotoUploading(true)
    setActionError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/person/${encodeURIComponent(person.gedcomId)}/photo`, {
        method: 'POST',
        body: formData,
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { url: string }
      setEditPhotoUrl(data.url)
    } catch (err) {
      if (ctrl.signal.aborted) return
      console.error('Failed to upload photo', err)
      setActionError('Failed to upload photo. Please try again.')
    } finally {
      if (!ctrl.signal.aborted) setPhotoUploading(false)
    }
  }

  /**
   * PATCHes the person record with the current edit-form values and returns to view mode.
   * Increments `detailVersion` to trigger a re-fetch of the updated person detail.
   */
  const handleSaveEdit = async () => {
    try {
      const res = await fetch(`/api/person/${encodeURIComponent(person.gedcomId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: [editGivenName.trim(), editFamilyName.trim()].filter(Boolean).join(' ') || null,
          sex: editSex,
          birthYear: editBirthYear.trim() || null,
          birthPlace: showEditBirthPlace ? (editBirthPlace.trim() || null) : null,
          deathYear: showEditDiedYear ? (editDiedYear.trim() || null) : null,
          deathPlace: showEditDeathPlace ? (editDeathPlace.trim() || null) : null,
          occupation: showEditOccupation ? (editOccupation.trim() || null) : null,
          notes: showEditNotes ? (editNotes.trim() || null) : null,
          photoUrl: editPhotoUrl,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMode('view')
      setDetailVersion(v => v + 1)
    } catch (err) {
      console.error('Failed to save edit', err)
      setActionError('Failed to save changes. Please try again.')
    }
  }

  const handleSuggestChange = async () => {
    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changeType: 'UPDATE_PERSON',
          payload: {
            targetId: person.gedcomId,
            name: [editGivenName.trim(), editFamilyName.trim()].filter(Boolean).join(' ') || null,
            sex: editSex,
            birthYear: editBirthYear.trim() || null,
            birthPlace: showEditBirthPlace ? (editBirthPlace.trim() || null) : null,
            deathYear: showEditDiedYear ? (editDiedYear.trim() || null) : null,
            deathPlace: showEditDeathPlace ? (editDeathPlace.trim() || null) : null,
            occupation: showEditOccupation ? (editOccupation.trim() || null) : null,
            notes: showEditNotes ? (editNotes.trim() || null) : null,
            photoUrl: editPhotoUrl,
          },
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMode('view')
    } catch (err) {
      console.error('Failed to submit suggestion', err)
      setActionError('Failed to submit suggestion. Please try again.')
    }
  }

  const confirmDialog = (
    <ConfirmDialog
      open={!!confirmAction}
      message={confirmAction?.message ?? ''}
      onConfirm={() => confirmAction?.onConfirm()}
      onCancel={() => setConfirmAction(null)}
    />
  )

  // Status row pills (docs/DESIGN_SYSTEM.md §4.1): living/redacted, root of the current
  // tree, and a count of this user's own unreviewed suggestions.
  const isLiving = detail?.living ?? person.living ?? false
  const isRootPerson = !!rootId && rootId === person.gedcomId
  const pendingChangeCount = myChanges
    ? (myChanges.createChange ? 1 : 0) + myChanges.relationshipChanges.length + myChanges.updateChanges.length
    : 0

  let content: React.ReactNode
  if (mode === 'edit') {
    content = (
      <DrawerSubView title={`Edit ${person.name || 'person'}`} onBack={() => setMode('view')} detent={detent} onToggleDetent={toggleDetent}>
        <div
          data-testid="person-drawer-edit-form"
          className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
        >
          <div>
            <label htmlFor="edit-given-name" className="text-xs text-slate-400 block mb-1">Given name</label>
            <input
              id="edit-given-name"
              type="text"
              value={editGivenName}
              onChange={e => setEditGivenName(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label htmlFor="edit-family-name" className="text-xs text-slate-400 block mb-1">Family name</label>
            <input
              id="edit-family-name"
              type="text"
              value={editFamilyName}
              onChange={e => setEditFamilyName(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label htmlFor="edit-photo" className="text-xs text-slate-400 block mb-1">Photo</label>
            <div className="flex items-center gap-3">
              {editPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={editPhotoUrl}
                  alt=""
                  aria-hidden="true"
                  data-testid="person-drawer-edit-photo-preview"
                  className="w-12 h-12 rounded-full object-cover border border-white/20 flex-shrink-0"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-white/40 flex-shrink-0"
                >
                  No photo
                </span>
              )}
              <input
                id="edit-photo"
                data-testid="person-drawer-photo-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoFileChange}
                disabled={photoUploading}
                className="text-xs text-white/70 file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border-0 file:bg-slate-800 file:text-white/80 file:text-xs hover:file:bg-slate-700 disabled:opacity-50"
              />
            </div>
            {photoUploading && <p className="text-xs text-slate-400 mt-1">Uploading…</p>}
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">Sex</p>
            <div className="flex gap-2">
              {(['M', 'F', 'U'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setEditSex(s)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${editSex === s ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-white/60 hover:bg-slate-700'}`}
                >
                  {s === 'M' ? 'Male' : s === 'F' ? 'Female' : 'Unknown'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="edit-birth-year" className="text-xs text-slate-400 block mb-1">Born year</label>
            <input
              id="edit-birth-year"
              type="text"
              value={editBirthYear}
              onChange={e => setEditBirthYear(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
            />
          </div>
          {showEditBirthPlace ? (
            <div>
              <label htmlFor="edit-birth-place" className="text-xs text-slate-400 block mb-1">Birth place</label>
              <input
                id="edit-birth-place"
                type="text"
                value={editBirthPlace}
                onChange={e => setEditBirthPlace(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setShowEditBirthPlace(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              + Add birth place
            </button>
          )}
          {showEditDiedYear ? (
            <div>
              <label htmlFor="edit-died-year" className="text-xs text-slate-400 block mb-1">Died year</label>
              <input
                id="edit-died-year"
                type="text"
                value={editDiedYear}
                onChange={e => setEditDiedYear(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setShowEditDiedYear(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              + Add died year
            </button>
          )}
          {showEditDeathPlace ? (
            <div>
              <label htmlFor="edit-death-place" className="text-xs text-slate-400 block mb-1">Death place</label>
              <input
                id="edit-death-place"
                type="text"
                value={editDeathPlace}
                onChange={e => setEditDeathPlace(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setShowEditDeathPlace(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              + Add death place
            </button>
          )}
          {showEditOccupation ? (
            <div>
              <label htmlFor="edit-occupation" className="text-xs text-slate-400 block mb-1">Occupation</label>
              <input
                id="edit-occupation"
                type="text"
                value={editOccupation}
                onChange={e => setEditOccupation(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setShowEditOccupation(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              + Add occupation
            </button>
          )}
          {showEditNotes ? (
            <div>
              <label htmlFor="edit-notes" className="text-xs text-slate-400 block mb-1">Notes</label>
              <textarea
                id="edit-notes"
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400 resize-none"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setShowEditNotes(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              + Add notes
            </button>
          )}
          {myChanges && myChanges.updateChanges.length > 0 && (
            <section
              data-testid="person-drawer-your-edits"
              className="pt-3 mt-3 border-t border-white/10 space-y-2"
            >
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Your edits to this person
              </h3>
              <ul className="space-y-2">
                {myChanges.updateChanges.map(c => (
                  <li
                    key={c.id}
                    data-testid={`your-edit-${c.id}`}
                    className="flex items-center gap-2 text-xs text-white/70"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="block truncate text-white/80">
                        {Object.keys(c.newValue).join(', ') || '(no fields)'}
                      </span>
                      <time className="block text-[10px] text-slate-500">
                        {new Date(c.appliedAt).toISOString()}
                      </time>
                    </div>
                    <button
                      type="button"
                      data-testid={`your-edit-revert-${c.id}`}
                      onClick={() => handleRevertEdit(c.id)}
                      disabled={isSubmitting}
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Revert
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {actionError && (
            <p data-testid="person-drawer-edit-action-error" className="text-red-400 text-xs">{actionError}</p>
          )}
          <div className="flex gap-2">
            <button
              data-testid="person-drawer-cancel"
              onClick={handleCancelEdit}
              className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            {isAdmin ? (
              <button
                onClick={handleSaveEdit}
                disabled={photoUploading}
                className="flex-1 py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                Save change
              </button>
            ) : (
              <button
                data-testid="suggest-change"
                onClick={handleSuggestChange}
                disabled={photoUploading}
                className="flex-1 py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                Suggest this change
              </button>
            )}
          </div>
        </div>
      </DrawerSubView>
    )
  } else if (mode === 'add-relative') {
    content = (
      <DrawerSubView title={`Add a ${addRelativeType} for ${person.name || 'person'}`} onBack={() => setMode('view')} detent={detent} onToggleDetent={toggleDetent}>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <input
              data-testid="add-relative-search"
              type="text"
              placeholder={`Search for a ${addRelativeType}…`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
            />
            {searchResults.length > 0 && (
              <ul className="mt-2 space-y-1">
                {searchResults.map(p => (
                  <li key={p.gedcomId}>
                    <button
                      onClick={() => handleSelectRelative(p)}
                      disabled={isSubmitting}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-white/80 hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="font-medium">{p.name || 'Unknown'}</span>
                      {p.birthYear && <span className="ml-2 text-xs text-slate-500">{p.birthYear}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <hr className="border-white/10" />

          <div className="space-y-3">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Or create new</p>
            <div className="space-y-2">
              <div>
                <label htmlFor="create-given-name" className="text-xs text-slate-400 block mb-1">Given name</label>
                <input
                  id="create-given-name"
                  type="text"
                  value={givenName}
                  onChange={e => setGivenName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label htmlFor="create-family-name" className="text-xs text-slate-400 block mb-1">Family name</label>
                <input
                  id="create-family-name"
                  type="text"
                  value={familyName}
                  onChange={e => setFamilyName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label htmlFor="create-birth-year" className="text-xs text-slate-400 block mb-1">Birth year</label>
                <input
                  id="create-birth-year"
                  type="text"
                  value={newBirthYear}
                  onChange={e => setNewBirthYear(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label htmlFor="create-sex" className="text-xs text-slate-400 block mb-1">Sex</label>
                <select
                  id="create-sex"
                  value={newSex}
                  onChange={e => setNewSex(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-[#0a1628] border border-white/20 text-white text-sm focus:outline-none focus:border-indigo-400"
                >
                  <option value="U">Unknown</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>
            </div>
            {actionError && (
              <p className="text-red-400 text-xs">{actionError}</p>
            )}
            <button
              onClick={handleCreateAndLink}
              disabled={isSubmitting}
              className="w-full py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save change
            </button>
          </div>
        </div>
      </DrawerSubView>
    )
  } else {
    content = (
    <div
      data-testid="person-drawer"
      className={getDrawerContainerClass(detent)}
    >
      <DrawerDragHandle detent={detent} onToggle={toggleDetent} />
      {/* Header — avatar, name, lifespan, close (docs/DESIGN_SYSTEM.md §4.1) */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-line">
        <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
          {(detail?.photoUrl ?? person.photoUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(detail?.photoUrl ?? person.photoUrl) as string}
              alt=""
              aria-hidden="true"
              data-testid="person-drawer-photo"
              className="w-12 h-12 rounded-full object-cover border border-line flex-shrink-0"
            />
          ) : (
            // Neutral surface, not the sex tint. §3.2 specifies those two tints
            // for a 3px tick — an element carrying no text, held to §2's 3:1 UI
            // floor. Behind white initials they read as body text and are held
            // to 4.5:1, which #4A7DB5 fails at 4.29:1. Matches the node avatar,
            // which #243 made unconditionally neutral for the same reason. Sex
            // stays carried by the tick and the drawer (§1: sex is not a colour).
            <div
              aria-hidden="true"
              className="w-12 h-12 rounded-full flex items-center justify-center bg-surface-2 text-ink text-lg font-semibold flex-shrink-0"
            >
              {(displayName || '?').trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-ink [font:var(--ft-name-lg)] truncate">
              {displayName || <span className="text-ink-3 italic">Unknown</span>}
            </h2>
            {dates && (
              <p className="text-ink-3 [font:var(--ft-mono)] truncate">{dates}</p>
            )}
          </div>
        </div>
        {isSignedIn && (
          <button
            data-testid="person-drawer-edit"
            onClick={openEdit}
            aria-label="Edit person"
            className={`${RESPONSIVE_BUTTON_BASE} mr-1`}
          >
            ✎
          </button>
        )}
        {getShareUrl && (
          <CopyLinkButton
            getUrl={getShareUrl}
            testId="person-drawer-copy-link"
            className="px-2 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-slate-800 transition-colors mr-1 text-[10px] whitespace-nowrap"
          />
        )}
        <button
          data-testid="person-drawer-close"
          onClick={onClose}
          aria-label="Close panel"
          className={`${RESPONSIVE_BUTTON_BASE} text-lg leading-none`}
        >
          ×
        </button>
      </div>

      {/* Status row — Living / pending edits / Root pills (docs/DESIGN_SYSTEM.md §4.1) */}
      {(isLiving || isRootPerson || pendingChangeCount > 0) && (
        <div data-testid="person-drawer-status-row" className="flex flex-wrap items-center gap-2 px-5 py-2 border-b border-line">
          {isLiving && (
            <span data-testid="person-drawer-status-living" className={STATUS_PILL_LIVING_CLASS}>Living</span>
          )}
          {pendingChangeCount > 0 && (
            <span data-testid="person-drawer-status-pending" className={STATUS_PILL_PENDING_CLASS}>
              {pendingChangeCount} pending edit{pendingChangeCount === 1 ? '' : 's'}
            </span>
          )}
          {isRootPerson && (
            <span data-testid="person-drawer-status-root" className={STATUS_PILL_ROOT_CLASS}>Root</span>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {/* Facts — label/value rows, full-bleed rule below, rows divided by hairlines (docs/DESIGN_SYSTEM.md §4.1) */}
        <div data-testid="person-drawer-facts" className="px-5 border-b border-line divide-y divide-line">
          <FactRow testId="person-drawer-gedcom-id" label="ID" value={person.gedcomId} mono />
          {detail && (
            detail.birthPlace ? (
              <FactRow testId="person-drawer-fact-birthplace" label="Birthplace" value={detail.birthPlace} mono />
            ) : (
              <FactRowGhostButton
                testId="person-drawer-fact-birthplace-add"
                label="Birthplace"
                addLabel="birth place"
                onClick={() => handleAddFact(() => setShowEditBirthPlace(true))}
              />
            )
          )}
          {detail && (
            detail.deathPlace ? (
              <FactRow testId="person-drawer-fact-deathplace" label="Death place" value={detail.deathPlace} mono />
            ) : (
              <FactRowGhostButton
                testId="person-drawer-fact-deathplace-add"
                label="Death place"
                addLabel="death place"
                onClick={() => handleAddFact(() => setShowEditDeathPlace(true))}
              />
            )
          )}
          {detail && (
            detail.occupation ? (
              <FactRow testId="person-drawer-fact-occupation" label="Occupation" value={detail.occupation} />
            ) : (
              <FactRowGhostButton
                testId="person-drawer-fact-occupation-add"
                label="Occupation"
                addLabel="occupation"
                onClick={() => handleAddFact(() => setShowEditOccupation(true))}
              />
            )
          )}
          {detail && (
            detail.notes ? (
              <FactRow testId="person-drawer-fact-notes" label="Notes" value={detail.notes} wrap />
            ) : (
              <FactRowGhostButton
                testId="person-drawer-fact-notes-add"
                label="Notes"
                addLabel="notes"
                onClick={() => handleAddFact(() => setShowEditNotes(true))}
              />
            )
          )}
        </div>

        <div className="px-5 py-4 space-y-4">
        {rootId && person.gedcomId !== rootId && (
          <div data-testid="person-drawer-relationship">
            {relationship.status !== 'success' && (
              <button
                type="button"
                data-testid="person-drawer-relationship-button"
                onClick={handleCalculateRelationship}
                disabled={relationship.status === 'loading'}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-50"
              >
                {relationship.status === 'loading' ? 'Calculating…' : `How related to ${rootLabel}?`}
              </button>
            )}
            {relationship.status === 'error' && (
              <p data-testid="person-drawer-relationship-error" className="text-red-400 text-xs mt-1">
                {relationship.message}
              </p>
            )}
            {relationship.status === 'success' && (
              <p data-testid="person-drawer-relationship-result" className="text-slate-300 text-xs">
                {displayName || 'This person'} is {rootLabel}&rsquo;s{' '}
                <span className="font-semibold text-white">{relationship.label}</span>.
              </p>
            )}
          </div>
        )}

        {suggestionSubmitted && (
          <div className="flex items-center justify-between gap-2 bg-[var(--ft-approved-soft)] rounded-lg px-3 py-2">
            <p data-testid="suggestion-submitted" className="text-[var(--ft-approved)] text-xs">Suggestion submitted for admin review.</p>
            <button
              type="button"
              onClick={() => setSuggestionSubmitted(false)}
              className="text-xs text-ink-2 hover:text-ink font-medium transition-colors shrink-0"
            >
              Done
            </button>
          </div>
        )}

        {suggestionError && (
          <div className="flex items-center justify-between gap-2 bg-[var(--ft-declined-soft)] rounded-lg px-3 py-2">
            <p data-testid="suggestion-error" className="text-[var(--ft-declined)] text-xs">{suggestionError}</p>
            <button
              type="button"
              onClick={() => setSuggestionError(null)}
              className="text-xs text-ink-2 hover:text-ink font-medium transition-colors shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {detailLoading && (
          <div className="flex items-center justify-center py-6">
            <div
              className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"
              aria-label="Loading"
            />
          </div>
        )}

        {detail && (
          <>
            <section data-testid="person-drawer-parents">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Parents</h3>
              {detail.parents.length === 0 ? (
                <p className="text-slate-600 text-xs italic">None recorded</p>
              ) : (
                <ul className="space-y-1">
                  {detail.parents.map(p => {
                    const removableChange = myChanges?.relationshipChanges?.find(
                      c => c.newValue.type === 'parent' && c.newValue.targetId === p.gedcomId
                    )
                    return (
                      <li key={p.gedcomId} className="flex items-center gap-1">
                        <div className="flex-1 min-w-0">
                          <RelativeRow person={p} onReroot={onReroot} />
                        </div>
                        {removableChange && pendingRemoveParentId !== removableChange.id && (
                          <button
                            type="button"
                            data-testid={`parent-remove-${p.gedcomId}`}
                            aria-label="Remove parent"
                            title="Remove parent"
                            onClick={() => setPendingRemoveParentId(removableChange.id)}
                            disabled={isSubmitting}
                            className="w-6 h-6 flex items-center justify-center rounded-lg text-white/40 hover:text-red-400 hover:bg-slate-800 transition-colors text-sm leading-none flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            ×
                          </button>
                        )}
                        {removableChange && pendingRemoveParentId === removableChange.id && (
                          <div className="flex items-center gap-1 flex-shrink-0" role="group" aria-label="Confirm remove parent">
                            <span className="text-xs text-slate-400">Remove?</span>
                            <button
                              type="button"
                              data-testid={`parent-remove-confirm-${p.gedcomId}`}
                              aria-label="Confirm remove parent"
                              onClick={() => handleRemoveParent(removableChange.id)}
                              disabled={isSubmitting}
                              className="px-2 h-6 flex items-center justify-center rounded-lg bg-red-500/80 hover:bg-red-500 text-white transition-colors text-xs leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              data-testid={`parent-remove-cancel-${p.gedcomId}`}
                              aria-label="Cancel remove parent"
                              onClick={() => setPendingRemoveParentId(null)}
                              disabled={isSubmitting}
                              className="px-2 h-6 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-white/80 transition-colors text-xs leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              No
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {isSignedIn && (
                <button
                  onClick={() => openAddRelative('parent')}
                  className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  + Add parent
                </button>
              )}
            </section>

            <section data-testid="person-drawer-siblings">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Siblings</h3>
              {detail.siblings.length === 0 ? (
                <p className="text-slate-600 text-xs italic">None recorded</p>
              ) : (
                <ul className="space-y-1">
                  {detail.siblings.map(s => <li key={s.gedcomId}><RelativeRow person={s} onReroot={onReroot} /></li>)}
                </ul>
              )}
            </section>

            <section data-testid="person-drawer-marriages">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Marriages</h3>
              {detail.marriages.length === 0 ? (
                <p className="text-slate-600 text-xs italic">None recorded</p>
              ) : (
                <ul className="space-y-3">
                  {detail.marriages.map(m => {
                    const removableChange = myChanges?.relationshipChanges?.find(
                      c => c.newValue.unionId === m.unionId
                    )
                    return (
                      <li key={m.unionId} className="space-y-1">
                        <div className="flex items-center gap-1">
                          <div className="flex-1 min-w-0">
                            {m.spouse && <RelativeRow person={m.spouse} onReroot={onReroot} />}
                          </div>
                          {removableChange && (
                            <button
                              type="button"
                              data-testid={`marriage-remove-${m.unionId}`}
                              aria-label="Remove marriage"
                              title="Remove marriage"
                              onClick={() => handleRemoveMarriage(removableChange.id)}
                              disabled={isSubmitting}
                              className="w-6 h-6 flex items-center justify-center rounded-lg text-white/40 hover:text-red-400 hover:bg-slate-800 transition-colors text-sm leading-none flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        {m.children.length > 0 && (
                          <ul className="pl-4 space-y-1">
                            {m.children.map(c => <li key={c.gedcomId}><RelativeRow person={c} onReroot={onReroot} small /></li>)}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {isSignedIn && (
                <div className="mt-2 flex gap-3">
                  <button
                    onClick={() => openAddRelative('spouse')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    + Add spouse
                  </button>
                  <button
                    onClick={() => openAddRelative('child')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    + Add child
                  </button>
                </div>
              )}
            </section>

            <section data-testid="person-drawer-timeline">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Timeline</h3>
              {(() => {
                const events = buildTimeline(detail)
                return events.length === 0 ? (
                  <p className="text-slate-600 text-xs italic">No events recorded</p>
                ) : (
                  <ul className="space-y-2">
                    {events.map((event, i) => (
                      <TimelineEntry key={i} event={event} onSelect={onSelectPerson} />
                    ))}
                  </ul>
                )
              })()}
            </section>
          </>
        )}
        </div>
      </div>

      {/* Actions — sticky bottom bar: re-root, delete, unauthenticated CTA (docs/DESIGN_SYSTEM.md §4.1 point 6) */}
      <div data-testid="person-drawer-actions" className={DRAWER_ACTIONS_CLASS}>
        <button
          data-testid="person-drawer-reroot"
          onClick={() => { onReroot(person.gedcomId); onClose() }}
          className="w-full py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors uppercase tracking-wide"
        >
          FOCUS TREE ON {(displayName || 'PERSON').toUpperCase()}
        </button>
        {myChanges?.createChange && (
          <>
            <button
              data-testid="person-drawer-delete"
              onClick={handleDeletePerson}
              disabled={isSubmitting || hasForeignConnections}
              aria-label={`Delete ${person.name || 'person'}`}
              className="w-full py-2 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-500/80"
            >
              Delete this person
            </button>
          </>
        )}
        {(hasForeignConnections || actionError) && (
          <p data-testid="person-drawer-action-error" className="text-red-400 text-xs">
            {actionError ?? 'Some connections cannot be removed. Contact an admin.'}
          </p>
        )}
        {!isSignedIn && (
          <button
            onClick={() => signIn('google')}
            className="w-full py-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors text-center"
          >
            Sign in to suggest edits
          </button>
        )}
      </div>
    </div>
    )
  }

  return (
    <>
      {content}
      {confirmDialog}
    </>
  )
}

/** Unicode minus sign (U+2212), used instead of a hyphen for negative generation numbers. */
const GENERATION_MINUS = '−'

/**
 * Human-readable name for a signed generation offset, e.g. -2 -> "GRANDPARENTS",
 * 1 -> "CHILDREN", 0 -> "ROOT". Steps beyond great-grandparent/grandchild (|generation| > 3)
 * repeat the "GREAT-" prefix rather than hard-coding a finite list, so deep trees (per the
 * issue's "band count grows with hop depth" risk) still get a sensible label.
 */
function generationName(generation: number): string {
  if (generation === 0) return 'ROOT'
  const steps = Math.abs(generation)
  const greatPrefix = steps > 2 ? 'GREAT-'.repeat(steps - 2) : ''
  return generation < 0
    ? steps === 1 ? 'PARENTS' : `${greatPrefix}GRANDPARENTS`
    : steps === 1 ? 'CHILDREN' : `${greatPrefix}GRANDCHILDREN`
}

/** Eyebrow label for a generation band's sticky gutter tag, e.g. "GEN −2 · GRANDPARENTS". */
function generationLabel(generation: number): string {
  const signed = generation < 0 ? `${GENERATION_MINUS}${Math.abs(generation)}` : `${generation}`
  return `GEN ${signed} · ${generationName(generation)}`
}

/**
 * Renders one full-width horizontal band per generation rank behind the canvas edges and
 * nodes — see docs/DESIGN_SYSTEM.md §3.1. Band boundaries come from the y-positions dagre
 * already assigned to each person node (via `applyDagreLayout`), so bands can never drift
 * from the rows they highlight.
 *
 * Rendered as a `<ReactFlow>` child (not inside the transformed `.react-flow__viewport`),
 * so the pan/zoom `transform` is applied by hand — the same approach ReactFlow's own
 * `<Background>` uses. That placement also keeps it painted behind `.react-flow__renderer`
 * (edges + nodes) without any explicit z-index, and it is entirely `pointer-events: none`
 * so it never intercepts clicks or drags.
 *
 * Each band also carries a left gutter label (eyebrow type, `--ft-text-3`, gold `--ft-brass`
 * for generation 0). The label lives inside the band's own full-width container, which is
 * never translated horizontally (only `translateY`/`zoom` are applied) — so it stays pinned
 * to the viewport's left edge while the canvas pans, without needing real CSS `position:
 * sticky` against a scroll container that doesn't exist here.
 *
 * @param generationLevels - Clustered generation y-levels from `applyDagreLayout`, already
 * sorted ascending by y — reused as-is so bands can never drift from the rows they highlight.
 */
function GenerationBands({ generationLevels }: { generationLevels: GenerationLevel[] }) {
  const [, translateY, zoom] = useStore(selectTransform)

  const bands = useMemo(() => {
    if (generationLevels.length === 0) return []

    // Each band spans the midpoints between its row's y-level and its neighbors',
    // so adjacent bands tile the canvas with no gaps or overlaps. A single-row tree has no
    // neighbor to derive a gap from — fall back to a fixed height so the band still shows.
    const FALLBACK_ROW_GAP = 140
    return generationLevels.map((row, i) => {
      const prevGap = i > 0 ? row.y - generationLevels[i - 1].y : undefined
      const nextGap = i < generationLevels.length - 1 ? generationLevels[i + 1].y - row.y : undefined
      const gapAbove = prevGap ?? nextGap ?? FALLBACK_ROW_GAP
      const gapBelow = nextGap ?? prevGap ?? FALLBACK_ROW_GAP
      return {
        generation: row.generation,
        top: row.y - gapAbove / 2,
        height: gapAbove / 2 + gapBelow / 2,
      }
    })
  }, [generationLevels])

  if (bands.length === 0) return null

  return (
    <div
      className="react-flow__generation-bands"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      {bands.map(band => (
        <div
          key={band.generation}
          data-testid="generation-band"
          data-generation={band.generation}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: translateY + band.top * zoom,
            height: band.height * zoom,
            background: band.generation === 0
              ? `var(${BAND_VARS.root})`
              : band.generation % 2 === 0 ? `var(${BAND_VARS.a})` : `var(${BAND_VARS.b})`,
            borderBottom: `1px solid var(${BAND_VARS.rule})`,
            pointerEvents: 'none',
          }}
        >
          <span
            data-testid="generation-band-label"
            data-generation={band.generation}
            className="absolute left-3 top-2 whitespace-nowrap uppercase"
            style={{
              font: 'var(--ft-micro)',
              letterSpacing: 'var(--ft-micro-track)',
              color: band.generation === 0 ? 'var(--ft-brass)' : 'var(--ft-text-3)',
            }}
          >
            {generationLabel(band.generation)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Main canvas for rendering the family tree using ReactFlow.
 * Fetches tree data from API, applies hierarchical layout, and handles user interactions
 * (node selection, depth adjustment, pan/zoom).
 *
 * @param {string} rootId - GEDCOM ID of the tree root person
 * @param {Function} onSelectRoot - Called when user selects a new root person
 */
function FlowCanvas({
  rootId,
  onSelectRoot,
  treeVersion,
  initialUrlState,
  view,
}: {
  rootId: string
  onSelectRoot: (id: string) => void
  treeVersion: number
  initialUrlState: ReturnType<typeof parseTreeUrlState>
  /** Current display mode ('walk' | 'split' | 'tree'), included in the synced URL and share links. */
  view: TreeView
}) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [treeBounds, setTreeBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [generationLevels, setGenerationLevels] = useState<GenerationLevel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [totalNodes, setTotalNodes] = useState<number | undefined>(undefined)
  const [hops, setHops] = useState(() => initialUrlState.hops ?? DEFAULT_HOPS)
  const [actualMaxDepth, setActualMaxDepth] = useState<number>(MAX_HOPS)
  const [selectedPerson, setSelectedPerson] = useState<PersonData | null>(() =>
    initialUrlState.person ? personStub(initialUrlState.person) : null
  )
  /** Id of the person node currently hovered (desktop) — a transient, non-sticky lineage focus. */
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const { setViewport, getViewport } = useReactFlow()
  /**
   * Container-measured canvas dimensions from the ReactFlow store. These reflect
   * the actual `<ReactFlow>` element size (kept current by ReactFlow's internal
   * ResizeObserver) rather than the full window, so viewport-fit math stays
   * correct across resize and orientation changes on any device.
   */
  const canvasWidth = useStore(selectCanvasWidth)
  const canvasHeight = useStore(selectCanvasHeight)
  /**
   * Single canvas-level zoom subscription driving person-node level-of-detail
   * (docs/DESIGN_SYSTEM.md §3.2). Subscribing once here — instead of once per
   * node — keeps 368-node trees off the store's hot path; only the discrete
   * variant below, not this raw float, reaches node data.
   */
  const zoom = useStore(selectZoom)
  /**
   * Deferred copy of {@link zoom} (React 19 `useDeferredValue`) — see issue #271.
   * A threshold crossing swaps `lodVariant` for all ~370 person nodes at once;
   * profiling a zoom-control click burst (CDP trace, `Tracing.start` with the
   * V8 CPU profiler category) showed the cost is real DOM/element creation for
   * the `full` variant's richer markup (`React.createElement` self time — the
   * single largest non-idle contributor in the trace, well above any one
   * app-level function), committed synchronously once per crossing. Rapid
   * clicks queue several of these full-tree commits back-to-back with no
   * chance for the main thread to answer input or `Runtime.evaluate` in
   * between, which is the stall in #271. Deferring `zoom` — instead of
   * subscribing `lodVariant` straight to it — lets React keep rendering the
   * previous (cheaper) variant while it computes the new one at background
   * priority, coalescing a rapid click burst into far fewer committed
   * crossings and yielding the main thread between them, without changing the
   * variant nodes eventually settle on.
   */
  const deferredZoom = useDeferredValue(zoom)
  /** Discrete LOD variant for the current (deferred) zoom, memoised so it only changes at a threshold crossing. */
  const lodVariant = useMemo(() => getPersonLodVariant(deferredZoom), [deferredZoom])
  /**
   * `nodes` with the current {@link lodVariant} injected into person node data.
   * Memoised on `[nodes, lodVariant]` so a continuous zoom gesture only produces
   * a new array — and only triggers a `PersonNode` re-render — at a threshold
   * crossing, not on every frame (docs/DESIGN_SYSTEM.md §3.2).
   */
  const nodesWithLod = useMemo(
    () => nodes.map((n) =>
      n.type === 'person' ? { ...n, data: { ...(n.data as PersonData), lodVariant } } : n
    ),
    [nodes, lodVariant]
  )
  const abortRef = useRef<AbortController | null>(null)
  /** Tracks whether the user has actively changed depth or person, so an untouched initial load never rewrites the URL. */
  const userInteractedRef = useRef(false)
  /**
   * Tracks whether the initial fit-to-bounds viewport has already been applied, so
   * that first fit snaps instantly instead of animating. Animating it left a brief
   * window where nodes rendered at their pre-fit dagre coordinates while the 300ms
   * pan/zoom transition was still in flight — on large trees that's a real spot a
   * node can appear on-screen mid-transition and then end up off-screen once the
   * transition settles. Re-roots and depth changes still animate (the tree the user
   * is already looking at should transition smoothly), only the very first fit skips it.
   */
  const hasFitOnceRef = useRef(false)

  /** Display name of the current root person, derived from `nodes` and `rootId`. */
  const rootName = useMemo(() => {
    const rootNode = nodes.find(n => n.type === 'person' && (n.data as PersonData).gedcomId === rootId)
    return rootNode ? (rootNode.data as PersonData).name ?? '' : ''
  }, [nodes, rootId])

  /** ReactFlow node id of the selected (drawer-open) person — the sticky lineage focus, if any. */
  const selectedNodeId = useMemo(() => {
    if (!selectedPerson) return null
    return nodes.find(n => n.type === 'person' && (n.data as PersonData).gedcomId === selectedPerson.gedcomId)?.id ?? null
  }, [nodes, selectedPerson])

  /**
   * The lineage focus node id: an active selection is sticky and always wins over hover
   * (per docs/DESIGN_SYSTEM.md §3.3), so hover is only consulted when nothing is selected.
   */
  const focusNodeId = selectedNodeId ?? hoveredNodeId

  /**
   * `nodes`/`edges` mapped to the plain {@link FlowNode}/{@link FlowEdge} shape shared by
   * the lineage BFS and arrow-key navigation resolution — both need only id/type/position
   * and id/source/target/label, not the full ReactFlow `Node`/`Edge` shape.
   */
  const flowNodes = useMemo<FlowNode[]>(() => nodes.map(n => ({
    id: n.id,
    type: n.type as 'person' | 'union',
    data: n.data as PersonData | UnionData,
    position: n.position,
  })), [nodes])
  const flowEdges = useMemo<FlowEdge[]>(() => edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: (e.data as { relType?: string } | undefined)?.relType ?? '',
  })), [edges])

  /**
   * In-lineage node/edge id set for the current focus (hover or sticky selection), computed
   * in a single O(nodes + edges) pass over the already-loaded graph — no network request.
   * `null` when nothing is focused, meaning no dimming is applied.
   */
  const lineage = useMemo(() => {
    if (!focusNodeId) return null
    return computeLineage(flowNodes, flowEdges, focusNodeId)
  }, [flowNodes, flowEdges, focusNodeId])

  /**
   * Nodes as rendered by ReactFlow, with off-lineage nodes dimmed via `--ft-node-dim` while a
   * focus is active, and `selected` set from {@link selectedNodeId} — the sole source of truth
   * for selection (the canvas is a fully controlled flow with no `onNodesChange`), so React Flow
   * marks the clicked node `selected` and #266's §3.2 Selected treatment can render.
   */
  const displayNodes = useMemo(() => {
    return nodesWithLod.map(n => {
      const dimmed = !!lineage && !lineage.nodeIds.has(n.id)
      return {
        ...n,
        selected: n.id === selectedNodeId,
        style: {
          ...n.style,
          opacity: dimmed ? `var(${LINEAGE_VARS.dim})` : 1,
          transition: `opacity ${LINEAGE_DIM_TRANSITION_MS}ms ease`,
        },
      }
    })
  }, [nodesWithLod, lineage, selectedNodeId])

  /**
   * Edges as rendered by ReactFlow: off-lineage edges dim via `--ft-node-dim` and in-lineage
   * edges promote their stroke to `--ft-edge-strong`, while a focus is active.
   */
  const displayEdges = useMemo(() => {
    return edges.map(e => {
      const inLineage = !!lineage && lineage.edgeIds.has(e.id)
      const dimmed = !!lineage && !inLineage
      return {
        ...e,
        style: {
          ...e.style,
          opacity: dimmed ? `var(${LINEAGE_VARS.dim})` : e.style?.opacity,
          stroke: inLineage ? `var(${LINEAGE_VARS.edgeStrong})` : e.style?.stroke,
          transition: `opacity ${LINEAGE_DIM_TRANSITION_MS}ms ease, stroke ${LINEAGE_DIM_TRANSITION_MS}ms ease`,
        },
      }
    })
  }, [edges, lineage])

  /** Updates `selectedPerson`, marking the viewer state as user-touched so URL sync activates. */
  const selectPerson = useCallback((person: PersonData | null) => {
    userInteractedRef.current = true
    setSelectedPerson(person)
  }, [])

  /** Updates `hops`, marking the viewer state as user-touched so URL sync activates. */
  const handleHopsChange = useCallback((next: number) => {
    userInteractedRef.current = true
    setHops(next)
  }, [])

  /** Builds the canonical relative URL path for the current root/person/hops/view state. */
  const buildPath = useCallback(
    () => buildTreeUrlPath({ root: rootId || null, person: selectedPerson?.gedcomId ?? null, hops, view }),
    [rootId, selectedPerson, hops, view]
  )

  /** Builds the canonical shareable URL for the current root/person/hops state. */
  const buildShareUrl = useCallback(() => {
    const path = buildPath()
    return typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
  }, [buildPath])

  /**
   * Keeps the URL in sync with viewer state (root, person, hops) via the native
   * History API so re-rooting, depth changes, and person selection are shareable
   * without adding history entries or scrolling. Skipped until the user has
   * actually interacted (or the root has changed via {@link onSelectRoot}) so an
   * untouched initial load — including one that arrived via a deep link — never
   * rewrites the URL.
   *
   * Uses `window.history.replaceState` directly rather than the App Router's
   * `router.replace()`. The latter triggers a soft navigation (an RSC payload
   * round-trip) that resolves asynchronously and isn't guaranteed to have
   * committed by the time this function returns — a real race for anything that
   * reads the URL immediately after, e.g. a page reload right after re-rooting
   * (see `tests/e2e/reroot-persistence.spec.ts`). `history.replaceState` updates
   * the address bar synchronously and still integrates with `usePathname`/
   * `useSearchParams` per Next's docs on the native History API.
   */
  useEffect(() => {
    if (!userInteractedRef.current && treeVersion === 0) return
    window.history.replaceState(null, '', buildPath())
  }, [buildPath, treeVersion])

  /**
   * Opens the person drawer when a person node is clicked.
   *
   * @param _event - Unused mouse event from ReactFlow
   * @param node - The clicked ReactFlow node
   */
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type === 'person') {
      selectPerson(node.data as PersonData)
    }
  }, [selectPerson])

  /** Sets the transient (non-sticky) lineage focus when the pointer enters a person node. */
  const handleNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type === 'person') setHoveredNodeId(node.id)
  }, [])

  /**
   * Clears the transient lineage focus when the pointer leaves a person node — only if that
   * node is still the current hover, so a fast enter-into-the-next-node never clobbers it.
   */
  const handleNodeMouseLeave = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type === 'person') setHoveredNodeId(prev => (prev === node.id ? null : prev))
  }, [])

  /** DOM element ReactFlow renders its `.react-flow` wrapper into — used to locate node elements by id for keyboard focus moves. */
  const reactFlowWrapperRef = useRef<HTMLDivElement>(null)

  /**
   * Pans the viewport by the minimal amount needed to bring `el` fully inside the canvas
   * bounds (a `FOCUS_VIEWPORT_MARGIN` inset on every side) — the same "nearest edge" logic
   * as `Element.scrollIntoView({ block: 'nearest' })`, hand-rolled because the ReactFlow
   * pane isn't a natively scrollable element (docs/DESIGN_SYSTEM.md §7, AC3).
   *
   * Deliberately never touches zoom and never moves a node that's already fully visible,
   * unlike `fitView`/`setCenter` which would recentre (and often rescale) on every focus
   * move — that would fight both the tree's initial auto-fit and any pan/zoom the user has
   * mid-gesture (AC4). When nothing needs to move, `setViewport` is not called at all.
   */
  const scrollFocusedNodeIntoView = useCallback((el: HTMLElement | null) => {
    const wrapper = reactFlowWrapperRef.current
    if (!el || !wrapper) return
    const wrapperRect = wrapper.getBoundingClientRect()
    const nodeRect = el.getBoundingClientRect()

    let dx = 0
    if (nodeRect.left < wrapperRect.left + FOCUS_VIEWPORT_MARGIN) {
      dx = wrapperRect.left + FOCUS_VIEWPORT_MARGIN - nodeRect.left
    } else if (nodeRect.right > wrapperRect.right - FOCUS_VIEWPORT_MARGIN) {
      dx = wrapperRect.right - FOCUS_VIEWPORT_MARGIN - nodeRect.right
    }

    let dy = 0
    if (nodeRect.top < wrapperRect.top + FOCUS_VIEWPORT_MARGIN) {
      dy = wrapperRect.top + FOCUS_VIEWPORT_MARGIN - nodeRect.top
    } else if (nodeRect.bottom > wrapperRect.bottom - FOCUS_VIEWPORT_MARGIN) {
      dy = wrapperRect.bottom - FOCUS_VIEWPORT_MARGIN - nodeRect.bottom
    }

    if (dx === 0 && dy === 0) return

    const current = getViewport()
    setViewport({ x: current.x + dx, y: current.y + dy, zoom: current.zoom }, { duration: 200 })
  }, [getViewport, setViewport])

  /**
   * Resolves `↑`/`↓`/`←`/`→` against the loaded graph to move focus to a parent, child, or
   * sibling (docs/DESIGN_SYSTEM.md §7). Only acts when the key originates from a focused
   * person node (identified via the nearest `.react-flow__node` ancestor); if focus is on
   * the pane/canvas instead, the event is left untouched so panning and any other ReactFlow
   * bindings keep working (AC4).
   *
   * Handled as `onKeyDownCapture` so it runs before ReactFlow's own per-node `onKeyDown`,
   * and calls `stopPropagation` for every arrow key once a node is confirmed focused —
   * pre-empting ReactFlow's default "arrow keys move the selected node" behavior, which
   * would otherwise fire immediately after this handler returns.
   *
   * Once focus lands on the target node, {@link scrollFocusedNodeIntoView} nudges the
   * viewport just enough to bring it fully on-screen (AC3), without disturbing pan/zoom
   * otherwise.
   */
  const handleGraphKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!isArrowKey(event.key)) return
    const target = event.target as HTMLElement
    const nodeEl = target.closest('.react-flow__node') as HTMLElement | null
    if (!nodeEl) return
    const currentId = nodeEl.getAttribute('data-id')
    if (!currentId) return

    event.preventDefault()
    event.stopPropagation()

    const nextId = resolveArrowTarget(flowNodes, flowEdges, currentId, event.key)
    if (!nextId) return
    const nextEl = reactFlowWrapperRef.current?.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${CSS.escape(nextId)}"] [role="button"]`
    )
    nextEl?.focus()
    scrollFocusedNodeIntoView(nextEl ?? null)
  }, [flowNodes, flowEdges, scrollFocusedNodeIntoView])

  // Enter the loading state and clear the previous error/hover as soon as we know
  // we're fetching a new rootId/hops/treeVersion combination — adjusted during
  // render rather than as a synchronous setState at the top of `fetchTree` below
  // (which would otherwise trigger cascading renders when the effect calls it).
  const treeFetchKey = `${rootId}:${hops}:${treeVersion}`
  const [loadedTreeKey, setLoadedTreeKey] = useState<string | null>(null)
  if (rootId && loadedTreeKey !== treeFetchKey) {
    setLoadedTreeKey(treeFetchKey)
    setLoading(true)
    setError(null)
    // A fresh load replaces `nodes` wholesale, so a stale hover id from the previous
    // tree (e.g. after re-rooting) would otherwise resolve to an empty lineage set —
    // dimming everything — until the pointer happens to re-enter a node.
    setHoveredNodeId(null)
  }

  /**
   * Fetches tree data for the current `rootId` and `hops` depth, applies dagre
   * layout, and updates the node/edge state. Aborts any in-flight request first.
   */
  const fetchTree = useCallback(async () => {
    if (!rootId) return
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const res = await fetch(`/api/tree/${rootId}?hops=${hops}`, { signal: abortRef.current.signal })
      if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`)
      const data: TreeResponse = await res.json()

      const rawNodes: Node[] = data.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        data: n.type === 'person'
          ? { ...n.data, isRoot: (n.data as PersonData).gedcomId === rootId }
          : n.data,
        position: n.position,
      }))

      const rawEdges: Edge[] = data.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: EDGE_RENDER_TYPE[e.label],
        style: EDGE_STYLES[e.label] ?? defaultEdgeStyle,
        data: { relType: e.label },
      }))

      const laid = applyDagreLayout(rawNodes, rawEdges, { rootId })
      setNodes(laid.nodes)
      const laidPersonGens = laid.nodes
        .filter(n => n.type === 'person')
        .map(n => (n.data as PersonData).generation)
        .filter((g): g is number => typeof g === 'number')
      const laidAncestorGens = laidPersonGens.filter(g => g < 0)
      const laidDescendantGens = laidPersonGens.filter(g => g > 0)
      setActualMaxDepth(Math.max(
        1,
        laidAncestorGens.length > 0 ? Math.abs(Math.min(...laidAncestorGens)) : 0,
        laidDescendantGens.length > 0 ? Math.max(...laidDescendantGens) : 0,
      ))
      setEdges(laid.edges)
      setTreeBounds(laid.bounds)
      setGenerationLevels(laid.generationLevels)
      setTruncated(data.truncated === true)
      setTotalNodes(typeof data.totalNodes === 'number' ? data.totalNodes : undefined)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Unknown error')
      setTruncated(false)
      setTotalNodes(undefined)
    } finally {
      setLoading(false)
    }
  }, [rootId, hops, treeVersion])

  /** Re-fetches the tree whenever `rootId`, `hops`, or `treeVersion` changes. */
  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  /**
   * Fits the viewport to the tree bounds after layout completes.
   * Falls back to centering on the root node when the tree is too large to fit at MIN_ZOOM.
   *
   * Runs in `useLayoutEffect`, synchronously before the browser paints, rather than
   * `useEffect` behind a `setTimeout`. The previous async delay meant nodes could
   * paint at their raw, un-fit dagre coordinates for a frame (or more) before this
   * ran — on a large tree, that's a real window where a node genuinely sits inside
   * the viewport pre-fit and then leaves it once the fit lands, which is
   * indistinguishable from a race to anything reading node positions right after
   * load (e.g. a real user's click landing between the two states).
   */
  useLayoutEffect(() => {
    if (!treeBounds || nodes.length === 0) return
    // Wait until ReactFlow has measured its container before fitting.
    if (canvasWidth === 0 || canvasHeight === 0) return
    const vw = canvasWidth
    const vh = canvasHeight
    const PADDING = 0.15
    const MIN_ZOOM = 0.18
    const duration = hasFitOnceRef.current ? 300 : 0
    hasFitOnceRef.current = true

    const idealZoom = Math.min(
      (vw * (1 - 2 * PADDING)) / treeBounds.width,
      (vh * (1 - 2 * PADDING)) / treeBounds.height,
    )

    if (idealZoom >= MIN_ZOOM) {
      setViewport(getViewportForBounds(treeBounds, vw, vh, MIN_ZOOM, 2, PADDING), { duration })
    } else {
      const rootNode = nodes.find(
        n => n.type === 'person' && (n.data as PersonData).gedcomId === rootId
      )
      if (rootNode) {
        setViewport({
          zoom: MIN_ZOOM,
          x: vw / 2 - (rootNode.position.x + 80) * MIN_ZOOM,
          y: vh / 2 - (rootNode.position.y + 34) * MIN_ZOOM,
        }, { duration })
      }
    }
  }, [treeBounds, nodes, rootId, setViewport, canvasWidth, canvasHeight])

  return (
    <>
      <Toolbar
        nodes={nodes}
        rootName={rootName}
        hops={hops}
        onHopsChange={handleHopsChange}
        sliderMax={actualMaxDepth}
        getShareUrl={buildShareUrl}
        truncated={truncated}
        totalNodes={totalNodes}
      />
      {/* Loading/error overlays — ReactFlow stays mounted so its viewport is always initialized */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 z-10 pointer-events-none">
          Loading family tree…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400 z-10 pointer-events-none">
          {error}
        </div>
      )}
      <ReactFlow
        ref={reactFlowWrapperRef}
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
        minZoom={0.18}
        defaultViewport={{ x: 0, y: 0, zoom: 0.18 }}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onKeyDownCapture={handleGraphKeyDown}
        nodesFocusable={false}
      >
        <GenerationBands generationLevels={generationLevels} />
        <Background variant={BackgroundVariant.Dots} color="#1e2a4a" gap={28} size={1} />
        <MiniMap
          style={MINIMAP_STYLE}
          nodeColor={minimapNodeColor}
          nodeStrokeWidth={2}
          maskColor="var(--ft-overlay)"
        />
        <Controls style={CHROME_STYLE} />
      </ReactFlow>
      {selectedPerson && (
        <PersonDrawer
          person={selectedPerson}
          onClose={() => selectPerson(null)}
          onReroot={(id) => { onSelectRoot(id); selectPerson(null) }}
          onSelectPerson={(id) => {
            const node = nodes.find(n => n.type === 'person' && (n.data as PersonData).gedcomId === id)
            if (node) {
              selectPerson(node.data as PersonData)
            } else {
              // Person may not be in the current tree view — create minimal stub so drawer can fetch detail
              selectPerson(personStub(id))
            }
          }}
          onSelectRoot={onSelectRoot}
          rootId={rootId}
          rootName={rootName}
          getShareUrl={buildShareUrl}
        />
      )}
    </>
  )
}

const TREE_ROOT_STORAGE_KEY = 'family-tree-root-id'

/** Narrows a parsed URL `view` to a `ShellView` (excludes `entry`, which is never persisted as a choice). */
function isShellView(view: TreeView | null): view is ShellView {
  return view !== null && view !== 'entry'
}

/** Whether `el` is a form control (or contenteditable) that should keep single-key shortcuts from firing while it has focus. */
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

/**
 * Root component for the interactive family tree visualization.
 * Fetches available people and renders the tree canvas with search and navigation.
 * Persists the selected root person in localStorage for session continuity.
 *
 * @returns {React.ReactElement} Rendered family tree canvas with provider and error handling
 */
export default function FamilyTree() {
  const [rootId, setRootId] = useState('')
  const [persons, setPersons] = useState<Person[]>([])
  const [personsError, setPersonsError] = useState<string | null>(null)
  const [treeVersion, setTreeVersion] = useState(0)
  const [personsVersion, setPersonsVersion] = useState(0)
  const searchParams = useSearchParams()
  // Captured once on mount so later URL updates (from our own history.replaceState calls) don't
  // re-trigger root resolution — only the URL present on initial load takes precedence.
  const [initialUrlState] = useState(() => parseTreeUrlState(searchParams))
  // null until mount so SSR/first paint uses DEFAULT_DENSITY, avoiding a hydration mismatch
  // (docs/DESIGN_SYSTEM.md §6: density defaults to dense below 640px, compact at/above it).
  const [viewportWidth, setViewportWidth] = useState<number | null>(null)
  /** True once the initial focus-resolution pass (below) has run — gates the entry/viewer branch so it never flashes the entry state while that resolution is still in flight. */
  const [focusResolved, setFocusResolved] = useState(false)
  /** Guards the `/api/persons` effect's URL/localStorage focus resolution so it only runs on the first load — later `personsVersion` bumps (re-rooting, add/delete) must refresh the persons list without resetting `rootId` back to the initial URL/localStorage root (issue #292). */
  const initialFocusResolvedRef = useRef(false)
  /** Explicit view chosen via the switcher/URL; `null` defers to 'walk' once a focus is set (see `view` below). */
  const [shellView, setShellView] = useState<ShellView | null>(() =>
    isShellView(initialUrlState.view) ? initialUrlState.view : null
  )
  /** Whether the global ⌘K/Ctrl+K search overlay is open. */
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth)
    updateViewportWidth()
    window.addEventListener('resize', updateViewportWidth)
    return () => window.removeEventListener('resize', updateViewportWidth)
  }, [])

  const density = viewportWidth === null ? DEFAULT_DENSITY : getDefaultDensity(viewportWidth)

  /**
   * The tree viewer's current display mode. No focus person means the entry
   * state is showing, regardless of any `shellView`/URL value — the switcher
   * itself is disabled until a focus is set (see `ViewerShell`). Once a focus
   * is set, `shellView` wins if the user (or the URL) picked one; otherwise
   * choosing a focus defaults straight to `walk` (docs: issue #232 AC2).
   */
  const view: TreeView = rootId ? (shellView ?? 'walk') : 'entry'

  /**
   * Updates the active root person and persists the selection to localStorage
   * so the same person is shown on next page load. Bumps `treeVersion` and
   * `personsVersion` so the tree and persons list re-fetch even when the
   * resolved root id is unchanged (e.g. after a delete).
   *
   * An empty `id` (e.g. after deleting the current root with no other known
   * connection — see `PersonDrawer`'s delete handlers) falls back to the
   * first available person other than the outgoing root, so a successful
   * delete never re-roots onto the person that was just removed. Only when
   * no other person exists does it fall through to `''` (entry state).
   * @param {string} id - GEDCOM ID of the newly selected root person
   */
  const handleSelectRoot = useCallback((id: string) => {
    const resolved = id || persons.find(p => p.gedcomId !== rootId)?.gedcomId || ''
    setRootId(resolved)
    setTreeVersion(v => v + 1)
    setPersonsVersion(v => v + 1)
    if (typeof window !== 'undefined' && resolved) {
      localStorage.setItem(TREE_ROOT_STORAGE_KEY, resolved)
    }
  }, [persons, rootId])

  /**
   * Sets the active focus person — from an entry-state row, a search result
   * (overlay or entry-state field), or a breadcrumb entry. Entering focus for
   * the first time (from the entry state) also enters `walk`; navigating
   * while already focused preserves whatever view is active. Always closes
   * the search overlay, since every one of its callers is a selection.
   * @param {string} id - GEDCOM ID of the person to focus
   */
  const handleFocusPerson = useCallback((id: string) => {
    const enteringFromEmptyState = !rootId
    handleSelectRoot(id)
    if (enteringFromEmptyState) setShellView('walk')
    setSearchOpen(false)
  }, [rootId, handleSelectRoot])

  /**
   * Clears the active focus, returning to the entry state. localStorage is
   * left untouched (rather than removed) so the entry state's "resume where
   * you left off" row can still offer the just-cleared person back.
   */
  const handleClearFocus = useCallback(() => {
    setRootId('')
    setShellView(null)
  }, [])

  // Global keyboard shortcuts available from any view (docs: issue #232 AC3):
  // ⌘K/Ctrl+K opens the search overlay, Esc closes it, digit keys 1/2/3 switch
  // views once focused, and Esc with no overlay open clears focus back to the
  // entry state. Skipped while a form field has focus so typing (e.g. a birth
  // year) is never hijacked.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveShellAction(event, { searchOpen, hasFocus: !!rootId })
      if (action?.type === 'openSearch') {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (action?.type === 'closeSearch') {
        setSearchOpen(false)
        return
      }
      if (action?.type === 'setView') {
        if (isEditableTarget(document.activeElement)) return
        setShellView(action.view)
        return
      }
      if (event.key === 'Escape' && !searchOpen && rootId && !isEditableTarget(document.activeElement)) {
        handleClearFocus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [searchOpen, rootId, handleClearFocus])

  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/persons', { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Person[]) => {
        setPersons(data)
        // `personsVersion` bumps on every `handleSelectRoot` call (including
        // re-rooting via a relationship row or the drawer's reroot button) so
        // the persons list stays fresh after adds/deletes. But the focus
        // resolution below must only run on the very first load: it derives
        // `rootId` from the URL/localStorage snapshot captured at mount
        // (`initialUrlState` never changes), so re-running it on a later
        // `personsVersion` bump would immediately snap `rootId` — and thus
        // `rootName` — back to the original page-load root, silently undoing
        // whatever root the user just navigated to (issue #292).
        if (initialFocusResolvedRef.current) {
          return
        }
        initialFocusResolvedRef.current = true
        // Precedence for the entry-vs-viewer branch: URL root/person > localStorage.
        // Unlike before, there is no further fallback to DEFAULT_ROOT_GEDCOM_ID or
        // the first named person — an unresolved focus now renders the entry state
        // instead of silently landing on a default person (docs: issue #232 AC1).
        const urlFocusId = initialUrlState.root ?? initialUrlState.person
        const urlPerson = urlFocusId ? data.find(p => p.gedcomId === urlFocusId) : null
        const storedId = typeof window !== 'undefined' ? localStorage.getItem(TREE_ROOT_STORAGE_KEY) : null
        const storedPerson = storedId ? data.find(p => p.gedcomId === storedId) : null
        const focusPerson = urlPerson ?? storedPerson ?? null
        if (focusPerson) setRootId(focusPerson.gedcomId)
        setFocusResolved(true)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        console.error('Failed to load persons', err)
        setPersonsError('Could not load family members. Please check your database connection and refresh.')
        setFocusResolved(true)
      })
    return () => ctrl.abort()
  }, [personsVersion, initialUrlState])

  /** Resolves a person id to their display name for the breadcrumb trail; unknown ids render blank rather than the raw id. */
  const getPersonName = useCallback((id: string) => persons.find(p => p.gedcomId === id)?.name ?? '', [persons])

  /** The tree's designated root person, offered as the entry state's "Root person" row. */
  const rootPersonForEntry = useMemo(
    () => persons.find(p => p.gedcomId === DEFAULT_ROOT_GEDCOM_ID) ?? null,
    [persons]
  )
  /** The earliest-born person with a known birth year, offered as the entry state's "Earliest ancestor" row. */
  const earliestAncestorForEntry = useMemo(() => (
    persons.reduce<Person | null>((earliest, p) => {
      if (!p.birthYear) return earliest
      if (!earliest || !earliest.birthYear || parseInt(p.birthYear, 10) < parseInt(earliest.birthYear, 10)) return p
      return earliest
    }, null)
  ), [persons])
  /**
   * The last root persisted to localStorage, offered as the entry state's
   * "Resume where you left off" row. Only ever visible once focus has been
   * cleared (via Esc) without also clearing localStorage — re-reads on every
   * `rootId` change since that's precisely when localStorage was last written
   * or the entry state was last (re-)entered.
   */
  const resumePersonForEntry = useMemo(() => {
    if (typeof window === 'undefined') return null
    const storedId = localStorage.getItem(TREE_ROOT_STORAGE_KEY)
    return storedId ? persons.find(p => p.gedcomId === storedId) ?? null : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persons, rootId])

  if (personsError) {
    return (
      <div className="relative w-full h-dvh bg-[var(--ft-canvas)] flex items-center justify-center">
        <div className="bg-slate-800 border border-red-400/30 rounded-lg p-6 max-w-sm text-center shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <p className="text-red-300 text-sm">{personsError}</p>
        </div>
      </div>
    )
  }

  if (!focusResolved) {
    return (
      <div className="relative w-full h-dvh bg-[var(--ft-canvas)] flex items-center justify-center" data-density={density}>
        <p className="text-ink-3 [font:var(--ft-body)]">Loading…</p>
      </div>
    )
  }

  return (
    // #256 task 1 finding: at 360/390px viewports (signed out, drawer/search/toolbar
    // open) `document.documentElement.scrollWidth` is a constant 561px regardless of
    // viewport width — measured via a temporary Playwright probe that walks every
    // element, skips any clipped by an ancestor's `overflow`, and sorts by right edge.
    // The unclipped element whose right edge lands at exactly 561.4px is
    // `data-testid="auth-button"` (src/components/AuthButton.tsx:74-82, the signed-out
    // "Sign in" state, className `${FLOATING_PANEL_BASE_CLASS} px-4 py-2 ...`, natural
    // width ~58.7px). It renders inside ViewerShell's `viewer-shell-avatar-slot`
    // (src/components/ViewerShell.tsx:191-196), a fixed `w-6 h-6` (24px) box sized only
    // for the authenticated circular avatar — the wider "Sign in" button isn't clipped
    // or shrunk there, so it spills out to the right past the viewport edge. Nothing
    // between it and this root container constrains overflow (ViewerShell's `<header>`
    // is a non-wrapping flex row with no `overflow-hidden`, and this container is
    // `w-full` with no `max-w`/`overflow-x` clamp), so the overflow propagates all the
    // way to `document.documentElement`. All contributing widths (180px search pill,
    // ~146px switcher, the button's own padding) are fixed/intrinsic, not
    // viewport-relative, which is why scrollWidth stays 561 at both 360px and 390px.
    // Two previously-suspected candidates were ruled out: `LayoutAuthButton` renders
    // null on the viewer route (`/`), and the react-flow canvas nodes at large
    // transformed coordinates are clipped by the canvas pane's `overflow: hidden` and
    // so don't contribute to document scrollWidth. Task 2 constrains this chain.
    <div className="relative w-full h-dvh bg-[var(--ft-canvas)] flex flex-col" data-density={density}>
      {rootId && (
        <ViewerShell
          focusId={rootId}
          getPersonName={getPersonName}
          view={view}
          onViewChange={setShellView}
          onNavigate={handleFocusPerson}
          onSearchClick={() => setSearchOpen(true)}
        />
      )}
      <div className="relative flex-1 min-h-0">
        {rootId ? (
          <ReactFlowProvider>
            <FlowCanvas
              rootId={rootId}
              onSelectRoot={handleSelectRoot}
              treeVersion={treeVersion}
              initialUrlState={initialUrlState}
              view={view}
            />
          </ReactFlowProvider>
        ) : (
          <EmptyState
            personCount={persons.length}
            rootPerson={rootPersonForEntry}
            earliestAncestor={earliestAncestorForEntry}
            resumePerson={resumePersonForEntry}
            onSelectPerson={handleFocusPerson}
            onSearchClick={() => setSearchOpen(true)}
          />
        )}
      </div>
      <SearchOverlay
        open={searchOpen}
        persons={persons}
        onSelect={handleFocusPerson}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  )
}
