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
    await page.route(/\/api\/admin\/duplicates$/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [] }),
      })
    )

    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading')).toBeVisible()

    const duplicatesTab = page.getByRole('tab', { name: /duplicates/i })
    await expect(duplicatesTab).toBeVisible()
  })

  test('switching to the Duplicates tab renders a candidate pair side by side', async ({ page }) => {
    await page.route(/\/api\/admin\/duplicates$/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [mockCandidate] }),
      })
    )

    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: /duplicates/i }).click()

    await expect(page.getByTestId('duplicates-review')).toBeVisible()

    // Both candidates in the pair are rendered (name appears twice: once per side).
    await expect(page.getByText(survivorPerson.name).first()).toBeVisible()

    // Distinguishing per-side fields prove the side-by-side layout is populated
    // from both person records, not just one.
    await expect(page.getByText(survivorPerson.birthPlace!)).toBeVisible()
    await expect(page.getByText(duplicatePerson.deathPlace!)).toBeVisible()
    await expect(page.getByText(duplicatePerson.notes!)).toBeVisible()
  })

  test('shows empty state when no duplicate candidates are found', async ({ page }) => {
    await page.route(/\/api\/admin\/duplicates$/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [] }),
      })
    )

    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: /duplicates/i }).click()

    await expect(page.getByTestId('duplicates-review')).toBeVisible()
    await expect(page.getByText(/no (duplicate|potential duplicate) candidates/i)).toBeVisible()
  })

  test('picking a survivor and confirming POSTs the merge with correct body; card is removed on success', async ({ page }) => {
    let mergePostBody: { survivorId?: string; duplicateId?: string } | null = null

    await page.route(/\/api\/admin\/duplicates\/merge$/, async route => {
      mergePostBody = await route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    })

    await page.route(/\/api\/admin\/duplicates$/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [mockCandidate] }),
      })
    )

    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: /duplicates/i }).click()

    await expect(page.getByTestId('duplicates-review')).toBeVisible()
    await expect(page.getByText(duplicatePerson.notes!)).toBeVisible({ timeout: 3_000 })

    // Select the second person (@I002@) as the survivor via the radio picker.
    const survivorRadios = page.getByRole('radio')
    await expect(survivorRadios).toHaveCount(2)
    await survivorRadios.nth(1).check()

    // Confirm the merge; the UI warns this is irreversible.
    const confirmBtn = page.getByRole('button', { name: /confirm|merge/i })
    await expect(confirmBtn).toBeVisible()
    await confirmBtn.click()

    await expect.poll(() => mergePostBody).not.toBeNull()
    expect(mergePostBody).toMatchObject({
      survivorId: duplicatePerson.gedcomId,
      duplicateId: survivorPerson.gedcomId,
    })

    // The candidate card disappears from the list after a successful merge.
    await expect(page.getByText(duplicatePerson.notes!)).not.toBeVisible({ timeout: 5_000 })
  })

  test('Merge API blocks requests that lack an admin session', async ({ request }) => {
    const res = await request.post('/api/admin/duplicates/merge', {
      data: { survivorId: '@I001@', duplicateId: '@I002@' },
    })
    expect([401, 403]).toContain(res.status())
  })
})
