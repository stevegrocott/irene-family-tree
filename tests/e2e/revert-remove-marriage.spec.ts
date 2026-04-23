import { test, expect } from '@playwright/test'
import { mockPersonsAndTree, mockSignedInSession } from './helpers/revert-mocks'

/**
 * E2E tests for the PersonDrawer per-marriage × remove button (Task 12).
 *
 * Verifies the three scenarios from the plan:
 *   1. × visible only on marriages whose unionId appears in
 *      myChanges.relationshipChanges.
 *   2. Click × → confirm → marriage disappears from the list; POST observed
 *      to /api/changes/<id>/revert.
 *   3. Mocked 409 surfaces conflictingChange.detail inline.
 */

// ─── Shared fixtures ────────────────────────────────────────────────────────

const mockDonald = {
  gedcomId: '@IDONALD@',
  name: 'Donald Grocott',
  sex: 'M',
  birthYear: '1920',
  deathYear: null,
  birthPlace: null,
  deathPlace: null,
  occupation: null,
  notes: null,
  parents: [],
  siblings: [],
  marriages: [],
}

const mockSpouseA = {
  gedcomId: '@ISPOUSE_A@',
  name: 'Jane SpouseA',
  sex: 'F',
  birthYear: '1923',
  deathYear: null,
}

const mockSpouseB = {
  gedcomId: '@ISPOUSE_B@',
  name: 'Mary SpouseB',
  sex: 'F',
  birthYear: '1930',
  deathYear: null,
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
        birthPlace: null,
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

const donaldDetailTwoMarriages = {
  ...mockDonald,
  marriages: [
    { unionId: '@FUNION_A@', marriageYear: null, marriagePlace: null, spouse: mockSpouseA, children: [] },
    { unionId: '@FUNION_B@', marriageYear: null, marriagePlace: null, spouse: mockSpouseB, children: [] },
  ],
}

const donaldDetailOneMarriage = {
  ...mockDonald,
  marriages: [
    { unionId: '@FUNION_B@', marriageYear: null, marriagePlace: null, spouse: mockSpouseB, children: [] },
  ],
}

// Only FUNION_A appears in relationshipChanges — FUNION_B was added by someone else.
const myChangesOneRelationship = {
  createChange: null,
  relationshipChanges: [
    {
      id: 'change-rel-A',
      newValue: { unionId: '@FUNION_A@', type: 'spouse' },
      appliedAt: '2026-04-23T10:00:00.000Z',
    },
  ],
  updateChanges: [],
}

const myChangesEmptyAfterRevert = {
  createChange: null,
  relationshipChanges: [],
  updateChanges: [],
}

const donaldPersonsList = [
  { gedcomId: '@IDONALD@', name: 'Donald Grocott', sex: 'M', birthYear: '1920', deathYear: null, birthPlace: null },
]

const mockDonaldCanvas = (page: import('@playwright/test').Page) =>
  mockPersonsAndTree(page, donaldPersonsList, donaldTreeResponse)

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Revert: per-marriage remove (×) button', () => {
  test('× visible only on marriages whose unionId appears in relationshipChanges', async ({ page }) => {
    await mockSignedInSession(page)
    await mockDonaldCanvas(page)

    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(myChangesOneRelationship),
      })
    )

    await page.route(/\/api\/person\/[^/]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(donaldDetailTwoMarriages),
      })
    )

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Donald', { timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    await expect(page.getByTestId('person-drawer')).toBeVisible()
    await expect(page.getByTestId('person-drawer-marriages')).toContainText('Jane SpouseA', { timeout: 5_000 })
    await expect(page.getByTestId('person-drawer-marriages')).toContainText('Mary SpouseB')

    await expect(page.getByTestId('marriage-remove-@FUNION_A@')).toBeVisible()
    await expect(page.getByTestId('marriage-remove-@FUNION_B@')).toHaveCount(0)
  })

  test('click × → confirm → marriage disappears; POST observed', async ({ page }) => {
    let revertPostCount = 0
    let detailCallCount = 0
    let myChangesCallCount = 0

    await mockSignedInSession(page)
    await mockDonaldCanvas(page)

    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) => {
      myChangesCallCount += 1
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          revertPostCount === 0 ? myChangesOneRelationship : myChangesEmptyAfterRevert
        ),
      })
    })

    await page.route(/\/api\/person\/[^/]+$/, (route) => {
      detailCallCount += 1
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          revertPostCount === 0 ? donaldDetailTwoMarriages : donaldDetailOneMarriage
        ),
      })
    })

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

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Donald', { timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    await expect(page.getByTestId('person-drawer-marriages')).toContainText('Jane SpouseA', { timeout: 5_000 })

    page.once('dialog', d => d.accept())
    await page.getByTestId('marriage-remove-@FUNION_A@').click()

    // After the revert, the drawer refetches — Jane's marriage disappears,
    // Mary remains, and the × is no longer present.
    await expect(page.getByTestId('person-drawer-marriages')).not.toContainText('Jane SpouseA', { timeout: 5_000 })
    await expect(page.getByTestId('person-drawer-marriages')).toContainText('Mary SpouseB')

    expect(revertPostCount).toBe(1)
    // Ensure the drawer triggered a re-fetch after success.
    expect(detailCallCount).toBeGreaterThan(1)
    expect(myChangesCallCount).toBeGreaterThan(1)
  })

  test('mocked 409 surfaces conflictingChange.detail inline', async ({ page }) => {
    await mockSignedInSession(page)
    await mockDonaldCanvas(page)

    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(myChangesOneRelationship),
      })
    )

    await page.route(/\/api\/person\/[^/]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(donaldDetailTwoMarriages),
      })
    )

    await page.route(/\/api\/changes\/[^/]+\/revert/, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Union touched',
          conflictingChange: {
            kind: 'union-touched',
            detail: 'Union has a CHILD edge — cannot remove',
          },
        }),
      })
    )

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Donald', { timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    await expect(page.getByTestId('person-drawer-marriages')).toContainText('Jane SpouseA', { timeout: 5_000 })

    page.once('dialog', d => d.accept())
    await page.getByTestId('marriage-remove-@FUNION_A@').click()

    await expect(page.getByTestId('person-drawer-action-error'))
      .toContainText('Union has a CHILD edge — cannot remove', { timeout: 5_000 })
  })
})
