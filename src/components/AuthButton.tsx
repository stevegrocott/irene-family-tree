'use client'

import { signIn, signOut, useSession } from 'next-auth/react'

/**
 * AuthButton
 *
 * Absolute-positioned control (top-right) that shows either a "Sign in" button
 * or, when authenticated, an avatar pill with the user's name and a "Sign out"
 * action. Styling follows the solid surface/border/shadow treatment used
 * elsewhere in the canvas — see docs/DESIGN_SYSTEM.md §4.4.
 */
export default function AuthButton() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return (
      <div
        data-testid="auth-button"
        aria-busy="true"
        className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-surface border border-line rounded-[var(--ft-r-md)] px-3 py-1.5 shadow-[var(--ft-shadow-1)]"
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
        className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-surface border border-line rounded-[var(--ft-r-md)] px-2 py-1 shadow-[var(--ft-shadow-1)]"
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
    <button
      data-testid="auth-button"
      onClick={() => signIn('google')}
      className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-surface border border-line rounded-[var(--ft-r-md)] px-4 py-2 shadow-[var(--ft-shadow-1)] text-xs text-ink-2 hover:text-ink hover:bg-surface-1 transition-colors"
    >
      Sign in
    </button>
  )
}
