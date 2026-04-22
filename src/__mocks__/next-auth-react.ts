/**
 * @fileoverview Test stub for `next-auth/react`.
 * Returns a fixed unauthenticated session so unit tests that render
 * components using `useSession` or `SessionProvider` do not require
 * a real NextAuth setup.
 */

/** Returns a fixed unauthenticated session — no network call is made. */
const useSession = () => ({ data: null, status: 'unauthenticated' as const })

/** No-op sign-in stub — resolves immediately without redirecting. */
const signIn = () => Promise.resolve(undefined)

/** No-op sign-out stub — resolves immediately without redirecting. */
const signOut = () => Promise.resolve(undefined)

/** Passthrough provider — renders children without a real session context. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SessionProvider = ({ children }: { children: any }) => children

export { useSession, signIn, signOut, SessionProvider }
