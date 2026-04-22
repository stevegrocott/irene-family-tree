'use client'

import { signIn, signOut, useSession } from 'next-auth/react'

/**
 * AuthButton
 *
 * Absolute-positioned control (top-right) that shows either a "Sign in" button
 * or, when authenticated, an avatar pill with the user's name and a "Sign out"
 * action. Styling mirrors the dark glass toolbar used elsewhere in the canvas.
 */
export default function AuthButton() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return (
      <div
        data-testid="auth-button"
        aria-busy="true"
        className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-3 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
      >
        <span className="text-xs text-white/60 select-none">Loading…</span>
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
        className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-2 py-1 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            aria-hidden="true"
            className="w-6 h-6 rounded-full object-cover border border-white/20"
          />
        ) : (
          <span
            aria-hidden="true"
            className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs text-white font-medium"
          >
            {initial}
          </span>
        )}
        <span
          data-testid="auth-button-name"
          className="text-xs text-white font-medium select-none max-w-[10rem] truncate"
        >
          {name}
        </span>
        <button
          data-testid="auth-button-signout"
          onClick={() => signOut()}
          className="text-xs text-white/60 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
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
      className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-4 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.4)] text-xs text-white/80 hover:text-white hover:bg-white/15 transition-colors"
    >
      Sign in
    </button>
  )
}
