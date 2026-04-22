import { test, expect } from '@playwright/test'

/**
 * E2E tests for PersonDrawer CRUD operations (issue #54).
 *
 * Verifies:
 *   1. Edit flow: clicking the pencil icon opens an edit form pre-filled with
 *      the person's current values; changing birth place and clicking
 *      "Save change" returns the drawer to view mode with the updated value.
 *   2. Add-relative flow: clicking "+ Add child" opens a search panel; typing
 *      a name, selecting a result, and confirming causes the new relationship
 *      to appear in the drawer.
 *
 * All tests mock the NextAuth session to simulate a signed-in user, since
 * edit and relationship actions are gated behind authentication.
 */

// ─── Shared fixtures ────────────────────────────────────────────────────────

const signedInUser = {
  name: 'E2E Test User',
  email: 'e2e@example.com',
  image: null,
}

/** Known person whose drawer we open and edit. */
const mockPersonDetail = {
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

/** Candidate child person used in the add-relative test. */
const mockChildSummary = {
  gedcomId: '@ICHILD@',
  name: 'Bob Test',
  sex: 'M',
  birthYear: '1920',
  deathYear: null,
  birthPlace: null,
}

/** Minimal single-node tree response for Alice Test. */
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

// ─── Test suite ─────────────────────────────────────────────────────────────

test.describe('PersonDrawer CRUD', () => {
  // ── Edit flow ──────────────────────────────────────────────────────────────

  test('edit: pencil opens pre-filled form; saving updates view mode', async ({ page }) => {
    // Track birth place so the mock can reflect PATCH updates.
    let currentBirthPlace = 'London, England'

    // Register all route mocks before navigating so they are active from the
    // very first request. Routes registered later take precedence (LIFO), but
    // here each URL pattern is unique so order does not matter.

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

    // Handle GET and PATCH for any /api/person/[id] path.
    // Routes ending in /relationships are handled separately below.
    await page.route(/\/api\/person\//, async (route) => {
      const method = route.request().method()
      const url = route.request().url()

      if (url.includes('/relationships')) {
        // Not expected in this test — fall through to real handler.
        await route.continue()
        return
      }

      if (method === 'PATCH') {
        // Reflect the body's birthPlace back so the drawer can show it.
        try {
          const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, string>
          if (typeof body.birthPlace === 'string') currentBirthPlace = body.birthPlace
        } catch {
          // ignore parse errors
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...mockPersonDetail, birthPlace: currentBirthPlace }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...mockPersonDetail, birthPlace: currentBirthPlace }),
        })
      }
    })

    await page.goto('/')

    // Wait for the tree to render — toolbar visibility is a reliable signal.
    await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

    // Click the first person node to open the drawer.
    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()

    // The detail fetch completes and birth place appears in view mode.
    await expect(drawer).toContainText('London, England', { timeout: 5_000 })

    // Click the pencil / edit button.
    const editBtn = page.getByTestId('person-drawer-edit')
    await expect(editBtn).toBeVisible()
    await editBtn.click()

    // Edit form is visible.
    const editForm = page.getByTestId('person-drawer-edit-form')
    await expect(editForm).toBeVisible()

    // Birth place input is pre-filled with the current value.
    const birthPlaceInput = editForm.getByLabel(/birth place/i)
    await expect(birthPlaceInput).toHaveValue('London, England')

    // Change birth place.
    await birthPlaceInput.clear()
    await birthPlaceInput.fill('Paris, France')

    // Click "Save change".
    await page.getByRole('button', { name: /save change/i }).click()

    // Edit form disappears — drawer returns to view mode.
    await expect(editForm).not.toBeVisible({ timeout: 5_000 })

    // Updated birth place is shown.
    await expect(drawer).toContainText('Paris, France')
  })

  // ── Add-relative flow ──────────────────────────────────────────────────────

  test('add-relative: + Add child opens search; selecting adds relationship to drawer', async ({
    page,
  }) => {
    // Mutable flag so the GET mock can return different shapes before/after
    // the POST to /relationships.
    let childAdded = false

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

    // Persons list — used both for the initial tree root selection and for the
    // add-relative search (whether server- or client-side filtered).
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
          mockChildSummary,
        ]),
      })
    )

    // Single-node tree for Alice Test so we get a predictable node to click.
    await page.route(/\/api\/tree\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aliceTreeResponse),
      })
    )

    // Person detail and relationship creation share the /api/person/ namespace.
    await page.route(/\/api\/person\//, async (route) => {
      const method = route.request().method()
      const url = route.request().url()

      if (url.includes('/relationships') && method === 'POST') {
        childAdded = true
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ unionId: '@FUNION@' }),
        })
        return
      }

      // GET /api/person/[id] — after the relationship is created, include the
      // child in the marriages list so the drawer reflects the new state.
      const detail = childAdded
        ? {
            ...mockPersonDetail,
            marriages: [
              {
                unionId: '@FUNION@',
                marriageYear: null,
                marriagePlace: null,
                spouse: null,
                children: [mockChildSummary],
              },
            ],
          }
        : mockPersonDetail

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      })
    })

    await page.goto('/')

    // Toolbar confirms Alice Test is the root (from our mocked /api/persons).
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Alice', {
      timeout: 15_000,
    })

    // Click Alice's node to open the drawer.
    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()

    // Wait for the detail to load (parents section rendered, even if empty).
    await expect(page.getByTestId('person-drawer-parents')).toBeVisible({ timeout: 5_000 })

    // Click the "+ Add child" button.
    const addChildBtn = page.getByRole('button', { name: /\+\s*add child/i })
    await expect(addChildBtn).toBeVisible()
    await addChildBtn.click()

    // Search input appears inside the add-relative panel.
    const searchInput = page.getByTestId('add-relative-search')
    await expect(searchInput).toBeVisible()

    // Type to filter — "Bob Test" should appear in results.
    await searchInput.fill('Bob')

    const bobResult = page.getByText('Bob Test', { exact: false })
    await expect(bobResult).toBeVisible({ timeout: 5_000 })

    // Select Bob Test — triggers POST to /relationships then re-fetches detail.
    await bobResult.click()

    // The new child relationship is visible in the drawer.
    await expect(drawer).toContainText('Bob Test', { timeout: 5_000 })
  })
})
