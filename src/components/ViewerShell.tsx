/**
 * @module ViewerShell
 * @description Persistent 56px top bar chrome for the viewer. Renders the wordmark,
 * a hairline divider, a search trigger pill, and the auth avatar slot. This is
 * task 3 of issue #231 — the breadcrumb trail and 3-segment view switcher are
 * added on top of this bar in task 4; this component intentionally does not
 * render either yet.
 *
 * Per docs/DESIGN_SYSTEM.md, every colour comes from a `--ft-*` token (no raw
 * hex, no `text-white`) and interactive elements keep a visible focus ring.
 */

'use client'

import AuthButton from '@/components/AuthButton'
import { APP_NAME } from '@/constants/branding'

/** Props for {@link ViewerShell}. */
interface Props {
  /**
   * Called when the search pill is activated (click or Enter/Space). Optional
   * because the search overlay itself is wired up in a later part of #231;
   * omitting it renders an inert (but still focusable and labelled) trigger.
   */
  onSearchClick?: () => void
}

/**
 * Persistent top bar: wordmark, divider, search pill, and the auth avatar
 * slot (wired to the existing {@link AuthButton}).
 *
 * @param {Props} props - Component props.
 * @param {() => void} [props.onSearchClick] - Fired when the search pill is activated.
 * @returns {JSX.Element} The 56px top bar.
 */
export default function ViewerShell({ onSearchClick }: Props) {
  return (
    <header
      data-testid="viewer-shell"
      className="relative flex items-center gap-3 h-14 px-4 bg-surface border-b border-line"
    >
      <span
        data-testid="viewer-shell-wordmark"
        className="[font:var(--ft-micro)] uppercase tracking-[var(--ft-micro-track)] text-brass whitespace-nowrap select-none"
      >
        {APP_NAME}
      </span>

      <span
        aria-hidden="true"
        data-testid="viewer-shell-divider"
        className="w-px h-4 flex-shrink-0 bg-line"
      />

      <button
        type="button"
        onClick={onSearchClick}
        aria-label="Search"
        data-testid="viewer-shell-search"
        className="flex items-center gap-2 w-[180px] h-8 flex-shrink-0 px-3 bg-surface-1 border border-line rounded-[var(--ft-r-md)] text-ink-3 hover:text-ink hover:bg-surface-2 focus:outline-none focus:border-[var(--ft-accent)] focus:shadow-[var(--ft-focus)] transition-colors"
      >
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" className="flex-shrink-0">
          <circle cx="8.5" cy="8.5" r="6" />
          <line x1="13.2" y1="13.2" x2="18" y2="18" strokeLinecap="round" />
        </svg>
        <span className="flex-1 text-left text-sm truncate">Search</span>
        <kbd
          aria-hidden="true"
          className="[font:var(--ft-micro)] text-ink-3 flex-shrink-0"
        >
          ⌘K
        </kbd>
      </button>

      <div
        data-testid="viewer-shell-auth-slot"
        className="ml-auto flex items-center justify-center w-6 h-6"
      >
        <AuthButton />
      </div>
    </header>
  )
}
