import { chromium, type FullConfig, type Page } from '@playwright/test'
import { adminSessionToken, AUTH_SECRET_FALLBACK } from './admin-auth'

/**
 * Selector for the Next.js dev overlay's bottom-left toggle button — the
 * element that actually intercepts taps on the mobile toolbar toggle (issue
 * #202). It renders inside `<nextjs-portal>`'s open shadow root (which
 * Playwright's CSS engine pierces automatically), carrying
 * `data-nextjs-dev-tools-button="true"`.
 *
 * `<nextjs-portal>` itself is NOT a safe signal: it's the shared mount point
 * for every dev-mode overlay, including runtime/build error dialogs that
 * render even when `devIndicators` is `false` ("Next.js will continue to
 * surface any build or runtime errors" — devIndicators docs). Matching on
 * the portal alone produces false positives whenever an unrelated error
 * dialog is open (confirmed against this app's AuthJS `ClientFetchError` on
 * a misconfigured dev server), so the check must target the toggle button
 * specifically.
 *
 * It is never present in the server-rendered HTML, and `PLAYWRIGHT_E2E` is a
 * server-only env var, so neither a raw HTTP fetch nor a `process.env` read
 * in the browser can detect it. Only an actual rendered page can.
 */
const DEV_OVERLAY_SELECTOR = '[data-nextjs-dev-tools-button]'

/**
 * Bounds how long globalSetup waits for the overlay to (not) appear.
 * `waitFor({ state: 'attached' })` blocks for the full timeout before
 * resolving false when the overlay never mounts, so *every* passing run —
 * the common case — pays this fixed cost. Kept short so it stays well
 * within AC4's <5s startup budget while still giving a slow dev server a
 * fair chance to mount the overlay if it's going to.
 */
const OVERLAY_CHECK_TIMEOUT_MS = 2_000

/** NextAuth's default JWT session cookie name (`session: { strategy: 'jwt' }` in `src/auth.ts`). */
const ADMIN_SESSION_COOKIE_NAME = 'authjs.session-token'

/**
 * Bounds how long globalSetup waits for the `/admin` navigation to settle
 * before deciding whether the admin cookie was accepted. Unlike
 * `OVERLAY_CHECK_TIMEOUT_MS`, this is a ceiling rather than a typical
 * duration: `page.goto` resolves as soon as the redirect (rejected) or the
 * admin page (accepted) reaches `domcontentloaded`, so a warm dev server
 * settles in ~1s. It's set well above that because `/admin` — unlike `/`,
 * which the `webServer.url` readiness probe already compiled — may still be
 * an uncompiled Turbopack route on a cold-cache run, and a slow compile must
 * not be misreported as a rejected cookie.
 */
const ADMIN_COOKIE_CHECK_TIMEOUT_MS = 30_000

/**
 * Fails the suite fast, naming `AUTH_SECRET`, if the server under test does
 * not accept the admin session cookie the admin specs present.
 *
 * `/admin` (`src/app/admin/page.tsx`) calls `auth()` and redirects to
 * `/api/auth/signin` before it ever touches Neo4j, so this is a pure auth
 * probe: a Neo4j outage cannot masquerade as a secret mismatch, and a
 * mismatch cannot masquerade as a Neo4j/UI problem.
 *
 * On the common **spawn** path this always passes: `playwright.config.ts`
 * gives the server the same `AUTH_SECRET` fallback `adminSessionToken()`
 * uses. It only fails on the **reuse** path (issue #284's `webServer.env`
 * caveat) when the reused server loaded a *different* `AUTH_SECRET` from
 * `.env.local` — the exact scenario that cost a wrong root-cause diagnosis
 * and a reverted, out-of-scope production change during #284's own
 * verification (issue #287).
 */
async function assertAdminCookieAccepted(page: Page, baseURL: string): Promise<void> {
  const token = await adminSessionToken()
  await page.context().addCookies([
    {
      name: ADMIN_SESSION_COOKIE_NAME,
      value: token,
      domain: new URL(baseURL).hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ])

  await page.goto(`${baseURL}/admin`, {
    waitUntil: 'domcontentloaded',
    timeout: ADMIN_COOKIE_CHECK_TIMEOUT_MS,
  })

  const landedUrl = page.url()
  const cookieRejected = /\/api\/auth\/signin/.test(landedUrl)

  if (cookieRejected) {
    throw new Error(
      `Admin session cookie rejected at ${baseURL}/admin — landed on ${landedUrl} instead of the admin ` +
        `page. The E2E suite is reusing a dev server whose AUTH_SECRET does not match the secret this ` +
        `suite signs its test admin cookie with (\`process.env.AUTH_SECRET ?? '${AUTH_SECRET_FALLBACK}'\`). ` +
        `playwright.config.ts's "reuseExistingServer" reuses whatever is already listening on ${baseURL} ` +
        `and silently discards webServer.env.AUTH_SECRET when it does, so a pre-existing server keeps ` +
        `whatever AUTH_SECRET it originally booted with (often the real value from .env.local) while this ` +
        `test process still signs with the fallback. The resulting JWT fails to verify, every admin spec's ` +
        `session cookie is rejected, and \`/admin\` redirects to sign-in — which then surfaces as 9+ unrelated ` +
        `"Sign in with Google" timeouts instead of this message (issue #287).\n\n` +
        `Fix: stop whatever is listening on ${baseURL} (e.g. \`lsof -ti:3000 | xargs kill\`) and let ` +
        `Playwright spawn its own dev server, or restart your dev server with ` +
        `AUTH_SECRET=${AUTH_SECRET_FALLBACK} exported first (matching playwright.config.ts's fallback).`,
    )
  }
}

/**
 * Fails the suite fast, with an actionable message, if the Next.js dev
 * overlay indicator is active on the server under test.
 *
 * `playwright.config.ts` sets `reuseExistingServer: !process.env.CI` and
 * passes `PLAYWRIGHT_E2E=1` (plus `NEXT_PUBLIC_E2E`, `AUTH_SECRET`,
 * `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`) via `webServer.env`. That `env`
 * block only applies when Playwright *spawns* the dev server itself — when a
 * pre-existing server on `baseURL` is reused instead (a developer's `npm run
 * dev`, a leftover process, a prior run), the block is silently discarded.
 * `next.config.ts` only disables `devIndicators` when `PLAYWRIGHT_E2E=1`, so
 * a reused, unflagged server renders the dev overlay indicator, which then
 * intercepts taps on the mobile toolbar toggle (issue #202) and fails specs
 * for reasons that have nothing to do with the code under test — 5 spurious
 * `mobile-responsive.spec.ts` failures during the verification of PR #282
 * (issue #284).
 *
 * Runs before any spec so the failure names the actual cause up front,
 * instead of surfacing as unrelated `tap()` timeouts deep in the suite.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000'

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' })

    const overlayMounted = await page
      .locator(DEV_OVERLAY_SELECTOR)
      .first()
      .waitFor({ state: 'attached', timeout: OVERLAY_CHECK_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false)

    if (overlayMounted) {
      throw new Error(
        `Next.js dev overlay detected at ${baseURL} — the E2E suite is reusing a dev server that was ` +
          `started without PLAYWRIGHT_E2E=1. playwright.config.ts's "reuseExistingServer" reuses ` +
          `whatever is already listening on ${baseURL} and silently discards webServer.env when it ` +
          `does, so a pre-existing server never receives PLAYWRIGHT_E2E, NEXT_PUBLIC_E2E, AUTH_SECRET, ` +
          `AUTH_GOOGLE_ID, or AUTH_GOOGLE_SECRET. Without PLAYWRIGHT_E2E=1, next.config.ts leaves the dev ` +
          `overlay indicator on, and it intercepts taps on the mobile toolbar toggle (issue #202), ` +
          `producing spec failures that look like UI regressions instead of a missing env var (issue #284).\n\n` +
          `Fix: stop whatever is listening on ${baseURL} (e.g. \`lsof -ti:3000 | xargs kill\`) and let ` +
          `Playwright spawn its own dev server, or restart your dev server with PLAYWRIGHT_E2E=1 ` +
          `NEXT_PUBLIC_E2E=1 exported first.`,
      )
    }

    await assertAdminCookieAccepted(page, baseURL)
  } finally {
    await browser.close()
  }
}
