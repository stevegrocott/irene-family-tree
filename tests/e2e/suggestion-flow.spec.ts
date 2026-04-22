import { test, expect } from '@playwright/test'
import { encode } from '@auth/core/jwt'

/**
 * E2E tests for the suggestion submission flow (issue #47).
 *
 * Verifies:
 *   1. A signed-in (non-admin) user can open the PersonDrawer, click the
 *      pencil icon, edit the birth place field, and click "Suggest this change".
 *   2. The UI POSTs to /api/suggestions with the correct changeType and payload.
 *   3. The suggestion is accessible via GET /api/admin/suggestions (admin-only
 *      endpoint), verified by fetching from within the browser context using the
 *      mocked route.
 *
 * Auth: the session endpoint is stubbed to return a signed-in user without an
 * admin role, so the edit form renders "Suggest this change" instead of
 * "Save change".
 *
 * Data: all API endpoints (tree, person detail, suggestions) are mocked so
 * the tests run without a live Neo4j instance.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────

const signedInUser = {
  name: 'E2E Test User',
  email: 'e2e@example.com',
  image: null,
  // no role → treated as regular user
}

const mockPerson = {
  gedcomId: '@ITEST@',
  name: 'Alice Test',
  sex: 'F',
  birthYear: '1900',
  deathYear: null,
  birthPlace: 'London, England',
  deathPlace: null,
  occupation: null,
  notes: null,
  parents: [],
  siblings: [],
  marriages: [],
}

const aliceTreeResponse = {
  nodes: [
    {
      id: 'node-@ITEST@',
      type: 'person',
      data: {
        gedcomId: '@ITEST@',
        name: 'Alice Test',
        sex: 'F',
        birthYear: '1900',
        deathYear: null,
        birthPlace: 'London, England',
        deathPlace: null,
        occupation: null,
        notes: null,
        isRoot: true,
        generation: 0,
      },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function mockSignedInSession(page: import('@playwright/test').Page) {
  await page.route(/\/api\/auth\/session\b/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: signedInUser,
        expires: '2099-01-01T00:00:00.000Z',
      }),
    })
  )
}

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

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Suggestion flow', () => {
  test('non-admin user can submit a suggestion; POST succeeds and appears in admin GET', async ({ page, context }) => {
    // ── Setup route mocks ────────────────────────────────────────────────────

    await mockSignedInSession(page)

    await page.route(/\/api\/persons/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            gedcomId: '@ITEST@',
            name: 'Alice Test',
            sex: 'F',
            birthYear: '1900',
            deathYear: null,
            birthPlace: 'London, England',
          },
        ]),
      })
    )

    await page.route(/\/api\/tree\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aliceTreeResponse),
      })
    )

    await page.route(/\/api\/person\//, async (route) => {
      if (route.request().url().includes('/relationships')) {
        return route.continue()
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockPerson),
      })
    })

    // Intercept POST /api/suggestions and capture the request body.
    let capturedPayload: Record<string, unknown> | null = null
    let suggestionPostStatus = 0
    const SUGGESTION_ID = 'e2e-suggestion-001'

    await page.route(/\/api\/suggestions$/, async (route) => {
      if (route.request().method() === 'POST') {
        capturedPayload = await route.request().postDataJSON() as Record<string, unknown>
        suggestionPostStatus = 201
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: SUGGESTION_ID }),
        })
      }
      return route.continue()
    })

    // Mock GET /api/admin/suggestions so it returns our suggestion after submission.
    await page.route(/\/api\/admin\/suggestions$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            suggestions: [
              {
                id: SUGGESTION_ID,
                changeType: 'UPDATE_PERSON',
                targetId: '@ITEST@',
                personName: 'Alice Test',
                authorName: signedInUser.name,
                authorEmail: signedInUser.email,
                previousValue: null,
                newValue: { birthPlace: 'Paris, France' },
                appliedAt: new Date().toISOString(),
                status: 'pending',
              },
            ],
          }),
        })
      }
      return route.continue()
    })

    // ── Navigate and open drawer ─────────────────────────────────────────────

    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText('London, England', { timeout: 5_000 })

    // ── Open edit form via pencil icon ───────────────────────────────────────

    const editBtn = page.getByTestId('person-drawer-edit')
    await expect(editBtn).toBeVisible()
    await editBtn.click()

    const editForm = page.getByTestId('person-drawer-edit-form')
    await expect(editForm).toBeVisible()

    // ── Edit birth place ─────────────────────────────────────────────────────

    const birthPlaceInput = editForm.getByLabel(/birth place/i)
    await expect(birthPlaceInput).toHaveValue('London, England')

    await birthPlaceInput.clear()
    await birthPlaceInput.fill('Paris, France')

    // ── Click "Suggest this change" ──────────────────────────────────────────

    const suggestBtn = page.getByTestId('suggest-change')
    await expect(suggestBtn).toBeVisible()
    await suggestBtn.click()

    // Edit form closes — drawer returns to view mode.
    await expect(editForm).not.toBeVisible({ timeout: 5_000 })

    // ── Verify POST to /api/suggestions succeeded ────────────────────────────

    expect(suggestionPostStatus).toBe(201)
    expect(capturedPayload).toMatchObject({
      changeType: 'UPDATE_PERSON',
      payload: expect.objectContaining({
        targetId: '@ITEST@',
        birthPlace: 'Paris, France',
      }),
    })

    // ── Verify suggestion appears in GET /api/admin/suggestions ──────────────
    // Fetch from within the browser context so page.route() mocks apply.

    await setAdminCookie(context)

    const adminResult = await page.evaluate(async () => {
      const res = await fetch('/api/admin/suggestions')
      return res.json() as Promise<{ suggestions: Array<{ id: string; changeType: string; targetId: string }> }>
    })

    expect(adminResult.suggestions).toHaveLength(1)
    expect(adminResult.suggestions[0].id).toBe(SUGGESTION_ID)
    expect(adminResult.suggestions[0].changeType).toBe('UPDATE_PERSON')
    expect(adminResult.suggestions[0].targetId).toBe('@ITEST@')
  })

  test('non-admin edit form shows "Suggest this change" not "Save change"', async ({ page }) => {
    await mockSignedInSession(page)

    await page.route(/\/api\/persons/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { gedcomId: '@ITEST@', name: 'Alice Test', sex: 'F', birthYear: '1900', deathYear: null, birthPlace: 'London, England' },
        ]),
      })
    )

    await page.route(/\/api\/tree\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aliceTreeResponse),
      })
    )

    await page.route(/\/api\/person\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockPerson),
      })
    )

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    await expect(page.getByTestId('person-drawer')).toBeVisible()
    await expect(page.getByTestId('person-drawer-edit')).toBeVisible()
    await page.getByTestId('person-drawer-edit').click()

    const editForm = page.getByTestId('person-drawer-edit-form')
    await expect(editForm).toBeVisible()

    // Non-admin sees "Suggest this change", not "Save change".
    await expect(page.getByTestId('suggest-change')).toBeVisible()
    await expect(page.getByRole('button', { name: /save change/i })).not.toBeVisible()
  })
})
