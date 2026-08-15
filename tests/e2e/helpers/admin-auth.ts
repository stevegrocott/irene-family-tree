import type { BrowserContext } from '@playwright/test'
import { encode } from '@auth/core/jwt'

/**
 * Admin session auth for specs that need `/admin` access.
 *
 * Signs a NextAuth v5 JWT with the same `AUTH_SECRET` the dev server uses
 * (`e2e-test-auth-secret` when `AUTH_SECRET` is not set in the environment),
 * so it can be injected as the `authjs.session-token` cookie and the
 * middleware treats the request as an authenticated admin.
 */

/**
 * Fallback `AUTH_SECRET` used to sign the E2E admin session cookie when
 * `process.env.AUTH_SECRET` is not set — the single source of truth for this
 * literal (issue #287 AC6). `playwright.config.ts`'s `webServer.env.AUTH_SECRET`
 * must match this value for the admin specs' cookie to verify server-side.
 */
export const AUTH_SECRET_FALLBACK = 'e2e-test-auth-secret'

/** Signs an admin `authjs.session-token` JWT. */
export async function adminSessionToken(): Promise<string> {
  return encode({
    token: {
      name: 'E2E Admin',
      email: 'admin@test.com',
      picture: null,
      sub: 'e2e-admin-001',
      role: 'admin',
    },
    secret: process.env.AUTH_SECRET ?? AUTH_SECRET_FALLBACK,
    salt: 'authjs.session-token',
  })
}

/** Injects a signed admin `authjs.session-token` cookie into the context. */
export async function setAdminCookie(context: BrowserContext): Promise<void> {
  const token = await adminSessionToken()
  await context.addCookies([{
    name: 'authjs.session-token',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }])
}
