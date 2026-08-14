import { chromium, type FullConfig } from '@playwright/test'

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
 * Bounds how long globalSetup waits for the overlay to (not) appear, so a
 * passing run — the common case — adds negligible time to suite startup.
 */
const OVERLAY_CHECK_TIMEOUT_MS = 2_000

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
  } finally {
    await browser.close()
  }
}
