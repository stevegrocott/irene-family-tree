/**
 * @module ViewerShell
 * @description Persistent 56px top bar chrome for the viewer. Renders the wordmark,
 * a hairline divider, the breadcrumb trail of visited people, a search trigger
 * pill, the 3-segment view switcher, and the auth avatar slot.
 *
 * Per docs/DESIGN_SYSTEM.md, every colour comes from a `--ft-*` token (no raw
 * hex, no `text-white`) and interactive elements keep a visible focus ring.
 */

'use client'

import { Fragment, useState } from 'react'
import AuthButton from '@/components/AuthButton'
import { APP_NAME } from '@/constants/branding'
import type { ShellView } from '@/lib/keyboardNav'
import type { TreeView } from '@/lib/treeUrlState'

/** The 3-segment view switcher's options, in display order. */
const SEGMENTS: ReadonlyArray<{ view: ShellView; label: string }> = [
  { view: 'walk', label: 'Walk' },
  { view: 'split', label: 'Split' },
  { view: 'tree', label: 'Tree' },
]

/** The first whitespace-delimited token of `name`, or `name` itself if it has none. */
function firstName(name: string): string {
  const trimmed = name.trim()
  const spaceIndex = trimmed.indexOf(' ')
  return spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)
}

/** Props for {@link ViewerShell}. */
interface Props {
  /** The currently focused person's id, or `null` before anyone has been focused. */
  focusId: string | null
  /** Resolves a person id to their display name (first name is derived from this). */
  getPersonName: (id: string) => string
  /** The currently active view; drives the switcher's pressed segment. */
  view: TreeView
  /** Fired when an enabled switcher segment is activated. */
  onViewChange: (view: ShellView) => void
  /** Fired when a breadcrumb entry is activated, with that entry's person id. */
  onNavigate: (id: string) => void
  /**
   * Called when the search pill is activated (click or Enter/Space). Optional
   * because the search overlay itself is wired up in a later part of #231;
   * omitting it renders an inert (but still focusable and labelled) trigger.
   */
  onSearchClick?: () => void
}

/**
 * Persistent top bar: wordmark, divider, breadcrumb trail, search pill,
 * 3-segment view switcher, and the auth avatar slot (wired to the existing
 * {@link AuthButton}).
 *
 * The breadcrumb trail is derived from the sequence of `focusId` values this
 * component observes: visiting a new person appends to the trail, and
 * revisiting a person already in the trail truncates back to that point
 * instead of appending a duplicate. The switcher is disabled whenever
 * `focusId` is `null`.
 *
 * @param {Props} props - Component props.
 * @param {string | null} props.focusId - The currently focused person's id.
 * @param {(id: string) => string} props.getPersonName - Resolves a person id to their display name.
 * @param {TreeView} props.view - The currently active view.
 * @param {(view: ShellView) => void} props.onViewChange - Fired when an enabled segment is activated.
 * @param {(id: string) => void} props.onNavigate - Fired when a breadcrumb entry is activated.
 * @param {() => void} [props.onSearchClick] - Fired when the search pill is activated.
 * @returns {JSX.Element} The 56px top bar.
 */
export default function ViewerShell({ focusId, getPersonName, view, onViewChange, onNavigate, onSearchClick }: Props) {
  const [trail, setTrail] = useState<string[]>([])
  // Tracks the last `focusId` this render observed so the trail can be adjusted
  // during render (React's documented pattern for deriving state from a changed
  // prop) rather than via a useEffect + setState, which would trigger an extra
  // cascading render.
  const [lastSeenFocusId, setLastSeenFocusId] = useState<string | null>(null)

  if (focusId !== lastSeenFocusId) {
    setLastSeenFocusId(focusId)
    if (focusId !== null) {
      const index = trail.indexOf(focusId)
      setTrail(index === -1 ? [...trail, focusId] : trail.slice(0, index + 1))
    }
  }

  const hasFocus = focusId !== null

  return (
    <header
      data-testid="viewer-shell"
      className="relative flex items-center gap-3 h-14 px-4 bg-surface border-b border-line"
    >
      {/*
        #256 fix: the wordmark and its divider are fixed/intrinsic-width chrome
        that, combined with the search pill and switcher below, summed to a
        constant ~560px row — well past a 360/390px viewport — pushing
        `document.documentElement.scrollWidth` past `clientWidth` regardless
        of auth state. Per docs/DESIGN_SYSTEM.md §6 ("the graph gets the whole
        viewport. Chrome collapses...") this non-essential branding chrome
        hides below `sm` (640px) so the remaining row fits.
      */}
      <span
        data-testid="viewer-shell-wordmark"
        className="hidden sm:inline-block [font:var(--ft-micro)] uppercase tracking-[var(--ft-micro-track)] text-brass whitespace-nowrap select-none"
      >
        {APP_NAME}
      </span>

      <span
        aria-hidden="true"
        data-testid="viewer-shell-divider"
        className="hidden sm:block w-px h-4 flex-shrink-0 bg-line"
      />

      {trail.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          data-testid="viewer-shell-breadcrumb"
          className="flex items-center gap-1 min-w-0 overflow-hidden"
        >
          {trail.map((id, index) => {
            const isCurrent = index === trail.length - 1
            return (
              <Fragment key={id}>
                {index > 0 && (
                  <span aria-hidden="true" className="text-ink-3 text-xs flex-shrink-0">
                    →
                  </span>
                )}
                <button
                  type="button"
                  data-testid="viewer-shell-breadcrumb-item"
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => onNavigate(id)}
                  className={`[font:var(--ft-mono)] px-1.5 py-0.5 rounded-[var(--ft-r-md)] truncate max-w-[8rem] focus:outline-none focus:shadow-[var(--ft-focus)] ${
                    isCurrent
                      ? 'bg-[var(--ft-brass-soft)] text-ink font-medium'
                      : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  {firstName(getPersonName(id))}
                </button>
              </Fragment>
            )
          })}
        </nav>
      )}

      {/*
        #256 fix: the 180px fixed-width pill (label + ⌘K kbd) is part of the
        row that overflowed 360/390px viewports. Collapses to a 44px
        icon-only tap target below `sm`, matching §6 ("search → one icon
        button"); the full pill returns at `sm:` and up.
      */}
      <button
        type="button"
        onClick={onSearchClick}
        aria-label="Search"
        data-testid="viewer-shell-search"
        className="flex items-center justify-center gap-2 w-11 h-11 sm:w-[180px] sm:h-8 flex-shrink-0 px-0 sm:px-3 bg-surface-1 border border-line rounded-[var(--ft-r-md)] text-ink-3 hover:text-ink hover:bg-surface-2 focus:outline-none focus:border-[var(--ft-accent)] focus:shadow-[var(--ft-focus)] transition-colors"
      >
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" className="flex-shrink-0">
          <circle cx="8.5" cy="8.5" r="6" />
          <line x1="13.2" y1="13.2" x2="18" y2="18" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline flex-1 text-left text-sm truncate">Search</span>
        <kbd
          aria-hidden="true"
          className="hidden sm:inline [font:var(--ft-micro)] text-ink-3 flex-shrink-0"
        >
          ⌘K
        </kbd>
      </button>

      <div
        data-testid="viewer-shell-switcher"
        role="group"
        aria-label="View"
        className="flex items-center gap-0.5 flex-shrink-0 bg-surface-1 border border-line rounded-[var(--ft-r-md)] p-0.5"
      >
        {SEGMENTS.map(segment => {
          const isActive = view === segment.view
          return (
            <button
              key={segment.view}
              type="button"
              disabled={!hasFocus}
              aria-pressed={isActive}
              data-testid={`viewer-shell-switcher-${segment.view}`}
              onClick={() => onViewChange(segment.view)}
              className={`px-2.5 h-6 text-xs rounded-[var(--ft-r-md)] transition-colors focus:outline-none focus:shadow-[var(--ft-focus)] disabled:opacity-40 disabled:cursor-not-allowed ${
                isActive && hasFocus
                  ? 'bg-surface text-ink'
                  : 'text-ink-3 hover:enabled:text-ink hover:enabled:bg-surface-2'
              }`}
            >
              {segment.label}
            </button>
          )
        })}
      </div>

      {/*
        #256 fix: this slot was a fixed 24px (`w-6 h-6`) box sized only for
        the authenticated circular avatar. The signed-out "Sign in" button
        (AuthButton) is wider than that and, since the box never clipped or
        shrank it, rendered centered on the slot and spilled out both sides —
        the exact 561px overflow this issue reports. `flex-shrink-0` alone
        (no forced width/height) lets the slot size to whatever AuthButton
        actually renders, which is now itself a 44px icon tap target below
        `sm` (§6 "auth → avatar only") instead of the full-width pill.
      */}
      <div
        data-testid="viewer-shell-avatar-slot"
        className="ml-auto flex items-center justify-center flex-shrink-0"
      >
        <AuthButton />
      </div>
    </header>
  )
}
