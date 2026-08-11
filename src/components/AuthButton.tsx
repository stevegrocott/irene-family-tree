'use client'

import { signIn, signOut, useSession } from 'next-auth/react'
import { FLOATING_PANEL_BASE_CLASS } from '@/constants/tree'

/**
 * AuthButton
 *
 * Position-agnostic, in-flow control that shows either a "Sign in" button or,
 * when authenticated, an avatar pill with the user's name and a "Sign out"
 * action. Renders in normal document flow — callers are responsible for
 * placement (e.g. ViewerShell's top-bar avatar slot, or a positioned wrapper
 * on routes without ViewerShell). Styling follows the solid surface/border/
 * shadow treatment used elsewhere in the canvas — see docs/DESIGN_SYSTEM.md §4.4.
 */
export default function AuthButton() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return (
      <div
        data-testid="auth-button"
        aria-busy="true"
        className={`${FLOATING_PANEL_BASE_CLASS} px-3 py-1.5`}
      >
        <span className="text-xs text-ink-3 select-none">Loading…</span>
      </div>
    )
  }

  if (status === 'authenticated' && session?.user) {
    const name = session.user.name || session.user.email || 'Account'
    const image = session.user.image
    const initial = name.charAt(0).toUpperCase()

    return (
      <div
        data-testid="auth-button"
        className={`${FLOATING_PANEL_BASE_CLASS} px-2 py-1`}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            aria-hidden="true"
            className="w-6 h-6 rounded-full object-cover border border-line"
          />
        ) : (
          <span
            aria-hidden="true"
            className="w-6 h-6 rounded-full bg-surface-2 border border-line flex items-center justify-center text-xs text-ink font-medium"
          >
            {initial}
          </span>
        )}
        <span
          data-testid="auth-button-name"
          className="text-xs text-ink font-medium select-none max-w-[10rem] truncate"
        >
          {name}
        </span>
        <button
          data-testid="auth-button-signout"
          onClick={() => signOut()}
          className="text-xs text-ink-3 hover:text-ink px-2 py-1 rounded-[var(--ft-r-sm)] hover:bg-surface-1 transition-colors"
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    // #256 fix: below `sm` (640px) this collapses to a 44px icon-only tap
    // target — docs/DESIGN_SYSTEM.md §6 ("auth → avatar only") — instead of
    // the full "Sign in" text pill, whose ~59px intrinsic width was the
    // element that overflowed ViewerShell's avatar slot and pushed
    // `document.documentElement.scrollWidth` past the viewport at 360/390px.
    // The full pill returns at `sm:` and up.
    <button
      data-testid="auth-button"
      onClick={() => signIn('google')}
      aria-label="Sign in"
      className={`${FLOATING_PANEL_BASE_CLASS} w-11 h-11 justify-center px-0 py-0 sm:w-auto sm:h-auto sm:justify-start sm:px-4 sm:py-2 text-xs text-ink-2 hover:text-ink hover:bg-surface-1 transition-colors`}
    >
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        aria-hidden="true"
        className="flex-shrink-0 sm:hidden"
      >
        <circle cx="10" cy="7" r="3.25" />
        <path d="M3.75 16.5c0-3.45 2.8-5.75 6.25-5.75s6.25 2.3 6.25 5.75" strokeLinecap="round" />
      </svg>
      <span className="hidden sm:inline">Sign in</span>
    </button>
  )
}
