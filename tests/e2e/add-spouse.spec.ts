import { test, expect } from '@playwright/test'

/**
 * E2E tests for add-spouse flow (issue #84).
 *
 * Verifies:
 *   1. Opening Donald Grocott's drawer and clicking "+ Add spouse" opens the
 *      search panel; selecting an existing person causes exactly one marriage
 *      entry to appear in the drawer.
 *   2. A second attempt to add the same spouse (server returns 409) is treated
 *      as success: the drawer returns to view mode, still shows exactly one
 *      marriage entry, and shows no error message.
 *
 * All tests mock the NextAuth session and all API endpoints so the suite runs
 * entirely against the local dev server with no external dependencies.
 */

// ─── Shared fixtures ────────────────────────────────────────────────────────

const signedInUser = {
  name: 'E2E Test User',
  email: 'e2e@example.com',
  image: null,
}

const mockDonald = {
  gedcomId: '@IDONALD@',
  name: 'Donald Grocott',
  sex: 'M',
  birthYear: '1920',
  deathYear: null,
  birthPlace: 'Melbourne, Victoria',
  deathPlace: null,
  occupation: null,
  notes: null,
  parents: [],
  siblings: [],
  marriages: [],
}

const mockSpouse = {
  gedcomId: '@ISPOUSE@',
  name: 'Jane Grocott',
  sex: 'F',
  birthYear: '1923',
  deathYear: null,
  birthPlace: null,
}

const donaldTreeResponse = {
  nodes: [
    {
      id: 'node-@IDONALD@',
      type: 'person',
      data: {
        gedcomId: '@IDONALD@',
        name: 'Donald Grocott',
        sex: 'M',
        birthYear: '1920',
        deathYear: null,
        birthPlace: 'Melbourne, Victoria',
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

/** One marriage entry linking Donald to Jane, used after the spouse is linked. */
const donaldWithSpouseDetail = {
  ...mockDonald,
  marriages: [
    {
      unionId: '@FUNION1@',
      marriageYear: null,
      marriagePlace: null,
      spouse: mockSpouse,
      children: [],
    },
  ],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Add-spouse flow', () => {
  test('selecting a spouse produces exactly one marriage entry in the drawer', async ({ page }) => {
    let spouseAdded = false

    await mockSignedInSession(page)

    await page.route(/\/api\/persons/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            gedcomId: '@IDONALD@',
            name: 'Donald Grocott',
            sex: 'M',
            birthYear: '1920',
            deathYear: null,
            birthPlace: 'Melbourne, Victoria',
          },
          mockSpouse,
        ]),
      })
    )

    await page.route(/\/api\/tree\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(donaldTreeResponse),
      })
    )

    await page.route(/\/api\/person\//, async (route) => {
      const method = route.request().method()
      const url = route.request().url()

      if (url.includes('/relationships') && method === 'POST') {
        spouseAdded = true
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ unionId: '@FUNION1@' }),
        })
        return
      }

      const detail = spouseAdded ? donaldWithSpouseDetail : mockDonald
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      })
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Donald', { timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()

    await expect(page.getByTestId('person-drawer-marriages')).toBeVisible({ timeout: 5_000 })

    const addSpouseBtn = page.getByRole('button', { name: /\+\s*add spouse/i })
    await expect(addSpouseBtn).toBeVisible()
    await addSpouseBtn.click()

    const searchInput = page.getByTestId('add-relative-search')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('Jane')

    const janeResult = page.getByText('Jane Grocott', { exact: false })
    await expect(janeResult).toBeVisible({ timeout: 5_000 })
    await janeResult.click()

    // Drawer returns to view mode and shows exactly one marriage entry.
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('person-drawer-marriages')).toContainText('Jane Grocott', { timeout: 5_000 })

    const marriageItems = page.getByTestId('person-drawer-marriages').locator('li')
    await expect(marriageItems).toHaveCount(1)
  })

  test('second add-spouse attempt (409 already linked) shows person linked, not an error', async ({ page }) => {
    let postCount = 0

    await mockSignedInSession(page)

    await page.route(/\/api\/persons/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            gedcomId: '@IDONALD@',
            name: 'Donald Grocott',
            sex: 'M',
            birthYear: '1920',
            deathYear: null,
            birthPlace: 'Melbourne, Victoria',
          },
          mockSpouse,
        ]),
      })
    )

    await page.route(/\/api\/tree\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(donaldTreeResponse),
      })
    )

    await page.route(/\/api\/person\//, async (route) => {
      const method = route.request().method()
      const url = route.request().url()

      if (url.includes('/relationships') && method === 'POST') {
        postCount += 1
        // Second attempt returns 409 — already linked.
        const status = postCount >= 2 ? 409 : 200
        await route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ unionId: '@FUNION1@' }),
        })
        return
      }

      // After first POST, always return Donald with the spouse linked.
      const detail = postCount >= 1 ? donaldWithSpouseDetail : mockDonald
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      })
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Donald', { timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()
    await expect(page.getByTestId('person-drawer-marriages')).toBeVisible({ timeout: 5_000 })

    // ── First attempt ────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /\+\s*add spouse/i }).click()
    await expect(page.getByTestId('add-relative-search')).toBeVisible()
    await page.getByTestId('add-relative-search').fill('Jane')
    await expect(page.getByText('Jane Grocott', { exact: false })).toBeVisible({ timeout: 5_000 })
    await page.getByText('Jane Grocott', { exact: false }).click()

    // Drawer returns to view mode with one marriage entry.
    await expect(page.getByTestId('person-drawer-marriages')).toContainText('Jane Grocott', { timeout: 5_000 })

    // ── Second attempt (server returns 409) ──────────────────────────────────
    await page.getByRole('button', { name: /\+\s*add spouse/i }).click()
    await expect(page.getByTestId('add-relative-search')).toBeVisible()
    await page.getByTestId('add-relative-search').fill('Jane')
    await expect(page.getByText('Jane Grocott', { exact: false })).toBeVisible({ timeout: 5_000 })
    await page.getByText('Jane Grocott', { exact: false }).click()

    // 409 is treated as success — drawer returns to view mode, no error shown.
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('person-drawer-marriages')).toContainText('Jane Grocott', { timeout: 5_000 })

    // Still exactly one marriage entry — no duplicate created.
    const marriageItems = page.getByTestId('person-drawer-marriages').locator('li')
    await expect(marriageItems).toHaveCount(1)

    // No error message visible.
    await expect(page.getByText(/failed to add/i)).not.toBeVisible()
  })
})
