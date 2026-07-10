import { test, expect } from '@playwright/test'
import { encode } from '@auth/core/jwt'

/**
 * E2E tests for the Admin Duplicates workflow (issue #149).
 *
 * Covers:
 *   1. Admin session cookie auth grants access to /admin.
 *   2. The "Duplicates" tab is visible alongside the existing tabs.
 *   3. Switching to the Duplicates tab fetches candidate pairs and renders
 *      them side by side with per-field comparison.
 *   4. Picking a survivor and confirming POSTs to
 *      /api/admin/duplicates/merge with { survivorId, duplicateId }.
 *   5. On a successful merge the candidate card is removed from the list.
 *
 * Auth: uses the same signed NextAuth v5 JWT + `authjs.session-token`
 * cookie pattern as tests/e2e/admin-review.spec.ts and
 * tests/e2e/admin-change-history.spec.ts.
 *
 * Data: DuplicatesReview fetches `/api/admin/duplicates` client-side (same
 * pattern as ChangeHistory's `/api/admin/changes` fetch), so candidate
 * pairs are supplied entirely via page.route stubs — no live Neo4j needed.
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

let cachedAdminToken: string

async function setAdminCookie(context: import('@playwright/test').BrowserContext) {
  cachedAdminToken ??= await adminSessionToken()
  await context.addCookies([{
    name: 'authjs.session-token',
    value: cachedAdminToken,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }])
}

async function mockDuplicatesRoute(page: import('@playwright/test').Page, candidates: any[] = []) {
  await page.route(/\/api\/admin\/duplicates$/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ candidates }),
    })
  )
}

async function navigateToDuplicatesTab(page: import('@playwright/test').Page) {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  const tab = page.getByRole('tab', { name: /duplicates/i })
  await expect(tab).toBeVisible()
  // Retry the click until React has hydrated and the tab actually becomes
  // selected — `domcontentloaded` fires before hydration completes, so a
  // single click can land before any listener is attached.
  await expect(async () => {
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  }).toPass({ timeout: 10_000 })
}

// ── Mock data ────────────────────────────────────────────────────────────────

const survivorPerson = {
  gedcomId: '@I001@',
  name: 'John Smith',
  sex: 'M',
  birthYear: '1900',
  deathYear: '1970',
  birthPlace: 'Boston, Massachusetts',
  deathPlace: null,
  occupation: 'Carpenter',
  notes: null,
}

const duplicatePerson = {
  gedcomId: '@I002@',
  name: 'John Smith',
  sex: 'M',
  birthYear: '1901',
  deathYear: null,
  birthPlace: null,
  deathPlace: 'Cambridge, Massachusetts',
  occupation: null,
  notes: 'Possible duplicate entry',
}

const mockCandidate = {
  person1: survivorPerson,
  person2: duplicatePerson,
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Admin Duplicates (/admin)', () => {
  test.beforeEach(async ({ context }) => {
    await setAdminCookie(context)
  })

  test('Duplicates tab is visible on the admin page', async ({ page }) => {
    await mockDuplicatesRoute(page)
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('tab', { name: /duplicates/i })).toBeVisible()
  })

  test('switching to the Duplicates tab renders a candidate pair side by side', async ({ page }) => {
    await mockDuplicatesRoute(page, [mockCandidate])
    await navigateToDuplicatesTab(page)

    await expect(page.getByTestId('duplicates-review')).toBeVisible()
    await expect(page.getByText(survivorPerson.name)).toHaveCount(2)
    await expect(page.getByText(survivorPerson.birthPlace!)).toBeVisible()
    await expect(page.getByText(duplicatePerson.deathPlace!)).toBeVisible()
    await expect(page.getByText(duplicatePerson.notes!)).toBeVisible()
  })

  test('shows empty state when no duplicate candidates are found', async ({ page }) => {
    await mockDuplicatesRoute(page)
    await navigateToDuplicatesTab(page)

    await expect(page.getByTestId('duplicates-review')).toBeVisible()
    await expect(page.getByTestId('empty-state')).toBeVisible()
  })

  test('picking a survivor and confirming POSTs the merge with correct body; card is removed on success', async ({ page }) => {
    const mergePromise = page.waitForResponse(res =>
      res.url().includes('/api/admin/duplicates/merge')
    )

    await page.route(/\/api\/admin\/duplicates\/merge$/, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    })

    await mockDuplicatesRoute(page, [mockCandidate])
    await navigateToDuplicatesTab(page)

    await expect(page.getByTestId('duplicates-review')).toBeVisible()
    await expect(page.getByText(duplicatePerson.notes!)).toBeVisible()

    await page.getByTestId('survivor-radio-duplicate').check()

    const confirmBtn = page.getByRole('button', { name: /confirm merge/i })
    await expect(confirmBtn).toBeVisible()
    await confirmBtn.click()

    const mergeResponse = await mergePromise
    const mergePostBody = await mergeResponse.request().postDataJSON()
    expect(mergePostBody).toMatchObject({
      survivorId: duplicatePerson.gedcomId,
      duplicateId: survivorPerson.gedcomId,
    })

    await expect(page.getByText(duplicatePerson.notes!)).not.toBeVisible()
  })

  test('Merge API blocks requests that lack an admin session', async ({ request }) => {
    const res = await request.post('/api/admin/duplicates/merge', {
      data: { survivorId: '@I001@', duplicateId: '@I002@' },
    })
    expect([401, 403]).toContain(res.status())
  })
})
