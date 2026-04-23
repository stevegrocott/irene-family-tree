import { test, expect } from '@playwright/test'

/**
 * E2E tests for the PersonDrawer "Your edits to this person" list in edit mode
 * (Task 13).
 *
 * Verifies:
 *   1. Section hidden when no updateChanges; shown with one row per change
 *      (keys + ISO timestamp + Revert button) otherwise.
 *   2. Revert → confirm → row disappears after refetch; POST observed.
 *   3. 409 surfaces conflictingChange.detail inline in the drawer.
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

const myChangesNoEdits = {
  createChange: null,
  relationshipChanges: [],
  updateChanges: [],
}

const myChangesTwoEdits = {
  createChange: null,
  relationshipChanges: [],
  updateChanges: [
    {
      id: 'change-upd-1',
      newValue: { birthPlace: 'Melbourne, Victoria', occupation: 'Farmer' },
      appliedAt: '2026-04-23T10:00:00.000Z',
    },
    {
      id: 'change-upd-2',
      newValue: { notes: 'Updated notes' },
      appliedAt: '2026-04-20T12:00:00.000Z',
    },
  ],
}

const myChangesOneEditAfterRevert = {
  createChange: null,
  relationshipChanges: [],
  updateChanges: [
    {
      id: 'change-upd-2',
      newValue: { notes: 'Updated notes' },
      appliedAt: '2026-04-20T12:00:00.000Z',
    },
  ],
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

async function mockPersonsAndTree(page: import('@playwright/test').Page) {
  await page.route(/\/api\/persons/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { gedcomId: '@IDONALD@', name: 'Donald Grocott', sex: 'M', birthYear: '1920', deathYear: null, birthPlace: 'Melbourne, Victoria' },
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
}

async function openEditMode(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('toolbar-viewing')).toContainText('Donald', { timeout: 15_000 })

  const personNode = page.locator('.react-flow__node-person').first()
  await expect(personNode).toBeVisible({ timeout: 10_000 })
  await personNode.click()

  await expect(page.getByTestId('person-drawer')).toBeVisible()
  await page.getByTestId('person-drawer-edit').click()
  await expect(page.getByTestId('person-drawer-edit-form')).toBeVisible()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Revert: "Your edits" list in edit mode', () => {
  test('section hidden when no updateChanges', async ({ page }) => {
    await mockSignedInSession(page)
    await mockPersonsAndTree(page)

    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(myChangesNoEdits),
      })
    )

    await page.route(/\/api\/person\/[^/]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockDonald),
      })
    )

    await openEditMode(page)
    await expect(page.getByTestId('person-drawer-your-edits')).toHaveCount(0)
  })

  test('section shown with row per updateChange: keys + ISO timestamp + Revert button', async ({ page }) => {
    await mockSignedInSession(page)
    await mockPersonsAndTree(page)

    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(myChangesTwoEdits),
      })
    )

    await page.route(/\/api\/person\/[^/]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockDonald),
      })
    )

    await openEditMode(page)

    const section = page.getByTestId('person-drawer-your-edits')
    await expect(section).toBeVisible({ timeout: 5_000 })

    const rows = section.locator('li[data-testid^="your-edit-"]')
    await expect(rows).toHaveCount(2)

    const row1 = page.getByTestId('your-edit-change-upd-1')
    await expect(row1).toContainText('birthPlace')
    await expect(row1).toContainText('occupation')
    await expect(row1).toContainText('2026-04-23T10:00:00.000Z')
    await expect(row1.getByRole('button', { name: /revert/i })).toBeVisible()

    const row2 = page.getByTestId('your-edit-change-upd-2')
    await expect(row2).toContainText('notes')
    await expect(row2).toContainText('2026-04-20T12:00:00.000Z')
  })

  test('revert click → confirm → row disappears; POST observed', async ({ page }) => {
    let revertPostCount = 0

    await mockSignedInSession(page)
    await mockPersonsAndTree(page)

    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          revertPostCount === 0 ? myChangesTwoEdits : myChangesOneEditAfterRevert
        ),
      })
    )

    await page.route(/\/api\/person\/[^/]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockDonald),
      })
    )

    await page.route(/\/api\/changes\/[^/]+\/revert/, (route) => {
      if (route.request().method() === 'POST') {
        revertPostCount += 1
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
        return
      }
      route.continue()
    })

    await openEditMode(page)

    const row1 = page.getByTestId('your-edit-change-upd-1')
    await expect(row1).toBeVisible({ timeout: 5_000 })

    page.once('dialog', d => d.accept())
    await page.getByTestId('your-edit-revert-change-upd-1').click()

    await expect(page.getByTestId('your-edit-change-upd-1')).toHaveCount(0, { timeout: 5_000 })
    await expect(page.getByTestId('your-edit-change-upd-2')).toBeVisible()

    expect(revertPostCount).toBe(1)
  })

  test('409 surfaces conflictingChange.detail inline', async ({ page }) => {
    await mockSignedInSession(page)
    await mockPersonsAndTree(page)

    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(myChangesTwoEdits),
      })
    )

    await page.route(/\/api\/person\/[^/]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockDonald),
      })
    )

    await page.route(/\/api\/changes\/[^/]+\/revert/, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Field updated later',
          conflictingChange: {
            kind: 'field-updated-later',
            detail: 'birthPlace was updated by a later change',
          },
        }),
      })
    )

    await openEditMode(page)

    page.once('dialog', d => d.accept())
    await page.getByTestId('your-edit-revert-change-upd-1').click()

    // The edit form stays visible; actionError renders below the inputs.
    await expect(page.getByTestId('person-drawer-edit-action-error'))
      .toContainText('birthPlace was updated by a later change', { timeout: 5_000 })
  })
})
