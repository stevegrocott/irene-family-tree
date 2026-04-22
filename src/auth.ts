import NextAuth, { type DefaultSession, type Session, type NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'
import type { JWT } from 'next-auth/jwt'

type Role = 'admin' | 'user'

declare module 'next-auth' {
  interface Session {
    user: {
      role?: Role
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: Role
  }
}

type Callbacks = NonNullable<NextAuthConfig['callbacks']>
type JwtCallbackArgs = Parameters<NonNullable<Callbacks['jwt']>>[0]
type SessionCallbackArgs = Parameters<NonNullable<Callbacks['session']>>[0]

export async function jwtCallback({ token, user, account }: JwtCallbackArgs): Promise<JWT> {
  if (account?.provider === 'google' && user?.email) {
    const adminEmails = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean)
    token.role = adminEmails.includes(user.email) ? 'admin' : 'user'
  }
  return token
}

export async function sessionCallback({ session, token }: SessionCallbackArgs): Promise<Session> {
  if (session.user && token.role) {
    session.user.role = token.role
  }
  return session
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt' },
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback,
  },
})
