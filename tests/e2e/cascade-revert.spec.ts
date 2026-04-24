import { test, expect } from '@playwright/test'
import { mockPersonsAndTree, mockSignedInSession } from './helpers/revert-mocks'

/**
 * E2E tests for the cascade-revert flow (issue #119).
 *
 * Scenarios:
 *   1. Happy path — person with relationships; user is the author of all connections.
 *      Click delete → confirm cascade dialog → POST /api/person/[id]/cascade-revert →
 *      drawer closes and tree refreshes.
 *   2. Blocked path — some connections were added by another user.
 *      POST returns 403 with blockedBy; "Contact an admin" message is shown inline.
 */

const mockAlice = {
  gedcomId: '@IALICE@',
  name: 'Alice Connected',
  sex: 'F',
  birthYear: '1990',
  deathYear: null,
  birthPlace: null,
  deathPlace: null,
  occupation: null,
  notes: null,
  parents: [{ gedcomId: '@IBOB@', name: 'Bob Parent', sex: 'M', birthYear: '1960', deathYear: null }],
  siblings: [],
  marriages: [],
}

const aliceTreeResponse = {
  nodes: [
    {
      id: 'node-@IALICE@',
      type: 'person',
      data: {
        gedcomId: '@IALICE@',
        name: 'Alice Connected',
        sex: 'F',
        birthYear: '1990',
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

// Happy path: user authored all connections (1 relationship change matches 1 parent)
const myChangesWithRelationship = {
  createChange: {
    id: 'change-create-1',
    changeType: 'CREATE_PERSON',
    targetId: '@IALICE@',
    newValue: { name: 'Alice Connected' },
    appliedAt: '2026-04-01T10:00:00.000Z',
  },
  relationshipChanges: [
    { id: 'change-rel-1', newValue: { unionId: '@UBOB@' }, appliedAt: '2026-04-01T10:00:00.000Z' },
  ],
  updateChanges: [],
}

// Blocked path: user authored no relationship changes, but Alice has 1 parent
// → hasForeignConnections = true → button pre-disabled without a server round-trip
const myChangesWithCreate = {
  createChange: {
    id: 'change-create-1',
    changeType: 'CREATE_PERSON',
    targetId: '@IALICE@',
    newValue: { name: 'Alice Connected' },
    appliedAt: '2026-04-01T10:00:00.000Z',
  },
  relationshipChanges: [],
  updateChanges: [],
}

const alicePersonsList = [
  { gedcomId: '@IALICE@', name: 'Alice Connected', sex: 'F', birthYear: '1990', deathYear: null, birthPlace: null },
]

test.describe('cascade-revert: delete person with connections', () => {
  test('happy path — cascade-revert called, drawer closes on success', async ({ page }) => {
    let cascadePostCount = 0

    await mockSignedInSession(page)
    await mockPersonsAndTree(page, alicePersonsList, aliceTreeResponse)

    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(myChangesWithRelationship),
      })
    )

    await page.route(/\/api\/person\/[^/]+\/cascade-revert/, async (route) => {
      if (route.request().method() === 'POST') {
        cascadePostCount += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, unionsReverted: 1 }),
        })
        return
      }
      await route.continue()
    })

    await page.route(/\/api\/person\/[^/]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAlice),
      })
    )

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Alice', { timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()
    await expect(page.getByTestId('person-drawer-parents')).toContainText('Bob Parent', { timeout: 5_000 })

    const deleteBtn = page.getByTestId('person-drawer-delete')
    await expect(deleteBtn).toBeVisible()
    await expect(deleteBtn).toBeEnabled()

    page.once('dialog', (d) => {
      expect(d.message()).toMatch(/1.*connections?/i)
      d.accept()
    })
    await deleteBtn.click()

    await expect(drawer).not.toBeVisible({ timeout: 5_000 })
    expect(cascadePostCount).toBe(1)
  })

  test('blocked path — button pre-disabled when foreign connections exist', async ({ page }) => {
    // myChangesWithCreate has 0 relationship changes but Alice has 1 parent connection.
    // The client-side count comparison detects this and disables the button immediately,
    // showing the "contact an admin" message without a server round-trip.
    await mockSignedInSession(page)
    await mockPersonsAndTree(page, alicePersonsList, aliceTreeResponse)

    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(myChangesWithCreate),
      })
    )

    await page.route(/\/api\/person\/[^/]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAlice),
      })
    )

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Alice', { timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()
    await expect(page.getByTestId('person-drawer-parents')).toContainText('Bob Parent', { timeout: 5_000 })

    const deleteBtn = page.getByTestId('person-drawer-delete')
    await expect(deleteBtn).toBeVisible()
    await expect(deleteBtn).toBeDisabled()

    const errorMsg = page.getByTestId('person-drawer-action-error')
    await expect(errorMsg).toContainText(/admin/i, { timeout: 5_000 })
    await expect(drawer).toBeVisible()
  })
})
