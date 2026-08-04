import { test, expect } from '@playwright/test'
import { encode } from '@auth/core/jwt'
import { isValidGedcomId } from '@/lib/treeUrlState'
import type { Change } from '@/app/admin/types'

/**
 * E2E tests for the admin Suggestions Review diff treatment and "View in
 * tree" re-root link (issue #217, restoring task 6 of #200 which was
 * dropped when PR #213 merged).
 *
 * Scope: unit coverage for the diff markup already exists in
 * `src/app/admin/SuggestionsReview.test.tsx` (struck-through/background
 * classes, link href/aria-label). This spec asserts only what unit tests
 * cannot: that the before/after diff renders visually distinct in a real
 * browser, and that clicking "View in tree" actually navigates and
 * re-roots the graph. It must not duplicate the unit test's assertions.
 *
 * Auth: follows tests/e2e/admin-review.spec.ts's pattern — sign a NextAuth
 * v5 JWT with @auth/core/jwt's `encode()` using AUTH_SECRET (falling back
 * to `e2e-test-auth-secret`, matching the dev server's default — see
 * playwright.config.ts), then inject it as the `authjs.session-token`
 * cookie so the middleware treats the request as an authenticated admin.
 *
 * Data: `/admin` is a server component that reads pending suggestions
 * directly from Neo4j (see `src/app/admin/page.tsx`); like every other spec
 * in this directory, the E2E dev server has no live Neo4j connection (see
 * e.g. tests/e2e/deep-links.spec.ts), so `initialSuggestions` is always
 * empty here. The fixture below uses a valid GEDCOM targetId —
 * `isValidGedcomId` gates whether SuggestionsReview renders the "View in
 * tree" link at all — so it is ready to exercise the diff and navigation
 * assertions the remaining tasks of this issue add.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

async function adminSessionToken(): Promise<string> {
  return encode({
    token: {
      name: 'E2E Admin',
      email: 'admin@test.com',
      picture: null,
      sub: 'e2e-admin-001',
      role: 'admin',
    },
    secret: process.env.AUTH_SECRET ?? 'e2e-test-auth-secret',
    salt: 'authjs.session-token',
  })
}

async function setAdminCookie(context: import('@playwright/test').BrowserContext) {
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

/**
 * Navigates to /admin and injects a fixture suggestion via SuggestionsReview's
 * test-only `__setSuggestions` seam (see the file docblock: the admin page
 * reads suggestions from Neo4j server-side, which this E2E environment has
 * no live connection to).
 */
async function seedSuggestion(page: import('@playwright/test').Page, suggestion: Change) {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="suggestions-review"]')
  await page.waitForFunction(() => typeof (window as unknown as { __setSuggestions?: unknown }).__setSuggestions === 'function')
  await page.evaluate((s) => {
    (window as unknown as { __setSuggestions: (s: unknown[]) => void }).__setSuggestions([s])
  }, suggestion)
}

// ── Fixture ──────────────────────────────────────────────────────────────────

/**
 * A pending suggestion changing `birthPlace`, with a valid GEDCOM
 * targetId so the "View in tree" link renders (see `isValidGedcomId`).
 */
const mockSuggestion: Change = {
  id: 'e2e-suggestion-001',
  changeType: 'UPDATE_PERSON',
  targetId: '@I042@',
  personName: 'Ada Lovelace',
  authorName: 'Charles Babbage',
  authorEmail: 'charles@example.com',
  previousValue: { birthPlace: 'London, England' },
  newValue: { birthPlace: 'Marylebone, London' },
  appliedAt: new Date(Date.now() - 3_600_000).toISOString(),
  status: 'pending',
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Admin Suggestions diff (/admin)', () => {
  test('fixture suggestion has a valid GEDCOM targetId', () => {
    // SuggestionsReview only renders "View in tree" when isValidGedcomId(targetId)
    // is true, so the diff/navigation tests added by this issue depend on this.
    expect(isValidGedcomId(mockSuggestion.targetId)).toBe(true)
  })

  test.describe('with admin session cookie', () => {
    test.beforeEach(async ({ context }) => {
      await setAdminCookie(context)
    })

    test('renders the Pending Suggestions panel for an authenticated admin', async ({ page }) => {
      await page.goto('/admin', { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('suggestions-review')).toBeVisible()
    })

    test('renders the before value struck through and the after value without a strikethrough', async ({ page }) => {
      // Inject the fixture suggestion client-side via SuggestionsReview's
      // test-only `__setSuggestions` seam so the diff markup actually
      // renders, then assert on the real computed styles the browser
      // applies — this is the one thing the jsdom-based unit tests in
      // SuggestionsReview.test.tsx cannot verify.
      await seedSuggestion(page, mockSuggestion)

      const beforeValue = mockSuggestion.previousValue?.birthPlace as string
      const afterValue = mockSuggestion.newValue.birthPlace as string

      const before = page.getByTestId('diff-before-birthPlace')
      const after = page.getByTestId('diff-after-birthPlace')

      await expect(before).toBeVisible()
      await expect(before).toHaveText(beforeValue)
      await expect(before).toHaveCSS('text-decoration-line', 'line-through')

      await expect(after).toBeVisible()
      await expect(after).toHaveText(afterValue)
      await expect(after).toHaveCSS('text-decoration-line', 'none')
    })

    test('renders the before and after values on differing background colours', async ({ page }) => {
      // The before/after values use the `--ft-declined-soft` / `--ft-approved-soft`
      // theme tokens (see tests/e2e/theme-tokens.spec.ts for precedent on
      // asserting against --ft-* custom properties rather than literal
      // colours). Assert the two rendered backgrounds are visually distinct
      // without pinning to a specific hex/rgb value, so a future theme
      // change can't silently make the diff unreadable.
      await seedSuggestion(page, mockSuggestion)

      const before = page.getByTestId('diff-before-birthPlace')
      const after = page.getByTestId('diff-after-birthPlace')

      await expect(before).toBeVisible()
      await expect(after).toBeVisible()

      const [beforeBackground, afterBackground] = await Promise.all([
        before.evaluate(el => getComputedStyle(el).backgroundColor),
        after.evaluate(el => getComputedStyle(el).backgroundColor),
      ])

      // Both must be actual, opaque colours (not "transparent" / rgba(0,0,0,0)),
      // otherwise a difference in value wouldn't imply a visible difference.
      expect(beforeBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(beforeBackground).not.toBe('transparent')
      expect(afterBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(afterBackground).not.toBe('transparent')

      expect(beforeBackground).not.toBe(afterBackground)
    })
  })
})
