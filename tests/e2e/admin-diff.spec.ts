import { test, expect, type Page } from '@playwright/test'
import { encode } from '@auth/core/jwt'

/**
 * E2E coverage for the admin review-card diff treatment (issue #214, task 1
 * — the Playwright spec `#200`/PR #213 shipped the treatment without).
 *
 * Verifies, against a mocked change with a real before/after diff:
 *   AC1 — a changed field's "before" value renders struck through and is
 *         visually distinct from the "after" value (not colour alone: the
 *         before side also loses its underline/strike when empty, so a
 *         genuinely struck-through cell proves it holds real content).
 *   AC2 — a field with no prior value renders "(none)", italic, rather than
 *         a blank cell or a dash.
 *   AC4 — the fixture driving these assertions carries at least one field
 *         with both a before AND an after value, so the test cannot pass
 *         against a fixture too thin to express a real diff.
 *
 * Target surface: the "Change History" tab (`ChangeHistory.tsx`), not
 * "Pending Suggestions" (`SuggestionsReview.tsx`). Per #214's own "Files
 * affected" list, both components render the diff with byte-identical
 * `FieldDiff` markup/classes — but only Change History's data arrives via a
 * client-side fetch to `/api/admin/changes` that Playwright can mock.
 * Pending Suggestions' data is a server component prop computed directly
 * from Neo4j (`src/app/admin/page.tsx`), which hardcodes
 * `previousValue: null` for every suggestion; nothing in the suggestion
 * creation path (`POST /api/suggestions`) ever stores a previous value
 * either, so no live-Neo4j fixture could express AC4 on that surface
 * without a production code change, which is out of scope for this test
 * task. Change History's diff treatment — verified here — is the same
 * treatment in practice.
 */

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

// birthPlace exercises AC1/AC4: a field with both a before and an after
// value. occupation exercises AC2: an empty "before" side paired with a
// real "after" value.
const mockChange = {
  id: 'e2e-diff-001',
  changeType: 'UPDATE_PERSON',
  targetId: '@I900@',
  personName: 'Rosalind Franklin',
  authorName: 'Francis Crick',
  authorEmail: 'francis@example.com',
  previousValue: { birthPlace: 'London, England', occupation: '' },
  newValue: { birthPlace: 'Paris, France', occupation: 'Chemist' },
  appliedAt: new Date(Date.now() - 3_600_000).toISOString(),
  status: 'live',
}

async function mockChangesRoute(page: Page) {
  await page.route(/\/api\/admin\/changes/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ changes: [mockChange] }),
    })
  )
}

/** Navigates to /admin and switches to the Change History tab. */
async function openChangeHistoryTab(page: Page) {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' })

  const historyTab = page.getByRole('tab', { name: /change history/i })
  await expect(historyTab).toBeVisible()

  // The tab button exists in the server-rendered markup before React
  // hydration attaches its click handler, so a click that lands during that
  // window is a no-op. Retry the click until the panel is actually visible
  // instead of guessing at a fixed hydration delay.
  const panel = page.getByTestId('change-history')
  await expect(async () => {
    await historyTab.click()
    await expect(panel).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  return panel
}

test.describe('Admin diff treatment (/admin, Change History)', () => {
  test.beforeEach(async ({ context }) => {
    await setAdminCookie(context)
  })

  test('a changed field shows the before value struck through and a visually distinct after value', async ({ page }) => {
    await mockChangesRoute(page)
    const panel = await openChangeHistoryTab(page)

    const before = panel.getByText('London, England', { exact: true })
    const after = panel.getByText('Paris, France', { exact: true })
    await expect(before).toBeVisible()
    await expect(after).toBeVisible()

    // AC1 — the before value is struck through; the after value is not.
    await expect(before).toHaveCSS('text-decoration-line', 'line-through')
    await expect(after).not.toHaveCSS('text-decoration-line', 'line-through')

    // AC1 — before/after sit on visually distinct backgrounds (declined-soft
    // vs approved-soft), so the distinction isn't carried by strikethrough
    // alone.
    const [beforeBg, afterBg] = await Promise.all([
      before.evaluate(el => getComputedStyle(el).backgroundColor),
      after.evaluate(el => getComputedStyle(el).backgroundColor),
    ])
    expect(beforeBg).not.toBe(afterBg)
  })

  test('an empty before value renders "(none)" in italics rather than a blank or dash', async ({ page }) => {
    await mockChangesRoute(page)
    const panel = await openChangeHistoryTab(page)

    // AC2 — the empty "occupation before" cell renders the literal text
    // "(none)", italicised, instead of a blank cell or a dash.
    const emptyBefore = panel.getByText('(none)', { exact: true })
    await expect(emptyBefore).toBeVisible()
    await expect(emptyBefore).toHaveCSS('font-style', 'italic')

    // The paired "after" value for that same field is real and rendered
    // distinctly — the empty-state treatment applies only to the empty side.
    await expect(panel.getByText('Chemist', { exact: true })).toBeVisible()
  })
})
