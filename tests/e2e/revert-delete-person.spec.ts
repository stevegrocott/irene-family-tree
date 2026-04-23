import { test, expect } from '@playwright/test'
import { mockPersonsAndTree, mockSignedInSession } from './helpers/revert-mocks'

/**
 * E2E tests for the PersonDrawer "Delete this person" button (Task 11).
 *
 * Verifies the four scenarios from the plan:
 *   1. Button visible + enabled when my-changes returns a createChange AND
 *      person detail has no parents/siblings/marriages. Click → confirm →
 *      drawer closes and one POST is observed to /api/changes/<id>/revert.
 *   2. Button visible but disabled (with title tooltip) when person detail has
 *      relationships.
 *   3. Button absent entirely when createChange is null.
 *   4. 409 from the revert endpoint surfaces conflictingChange.detail inline.
 *
 * All routes are mocked; the suite runs entirely against the local dev server.
 */

// ─── Shared fixtures ────────────────────────────────────────────────────────

const mockAlice = {
  gedcomId: '@IALICE@',
  name: 'Alice NewPerson',
  sex: 'F',
  birthYear: '1990',
  deathYear: null,
  birthPlace: null,
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
      id: 'node-@IALICE@',
      type: 'person',
      data: {
        gedcomId: '@IALICE@',
        name: 'Alice NewPerson',
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

const myChangesWithCreate = {
  createChange: {
    id: 'change-create-1',
    changeType: 'CREATE_PERSON',
    targetId: '@IALICE@',
    newValue: { name: 'Alice NewPerson' },
    appliedAt: '2026-04-23T10:00:00.000Z',
  },
  relationshipChanges: [],
  updateChanges: [],
}

const myChangesEmpty = {
  createChange: null,
  relationshipChanges: [],
  updateChanges: [],
}

const alicePersonsList = [
  {
    gedcomId: '@IALICE@',
    name: 'Alice NewPerson',
    sex: 'F',
    birthYear: '1990',
    deathYear: null,
    birthPlace: null,
  },
]

const mockAliceCanvas = (page: import('@playwright/test').Page) =>
  mockPersonsAndTree(page, alicePersonsList, aliceTreeResponse)

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Revert: delete-person button', () => {
  test('button visible + enabled when createChange exists and no relationships; click reverts and closes drawer', async ({ page }) => {
    let revertPostCount = 0

    await mockSignedInSession(page)
    await mockAliceCanvas(page)

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

    await page.route(/\/api\/changes\/[^/]+\/revert/, async (route) => {
      if (route.request().method() === 'POST') {
        revertPostCount += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
        return
      }
      await route.continue()
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Alice', { timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()
    await expect(page.getByTestId('person-drawer-marriages')).toBeVisible({ timeout: 5_000 })

    const deleteBtn = page.getByTestId('person-drawer-delete')
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 })
    await expect(deleteBtn).toBeEnabled()

    page.once('dialog', d => d.accept())
    await deleteBtn.click()

    await expect(drawer).not.toBeVisible({ timeout: 5_000 })
    expect(revertPostCount).toBe(1)
  })

  test('button visible but disabled with tooltip when person has relationships', async ({ page }) => {
    await mockSignedInSession(page)
    await mockAliceCanvas(page)

    const aliceWithParent = {
      ...mockAlice,
      parents: [
        {
          gedcomId: '@IBOB@',
          name: 'Bob Parent',
          sex: 'M',
          birthYear: '1960',
          deathYear: null,
        },
      ],
    }

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
        body: JSON.stringify(aliceWithParent),
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
    await expect(deleteBtn).toHaveAttribute('title', /relationships/i)
  })

  test('button absent when createChange is null', async ({ page }) => {
    await mockSignedInSession(page)
    await mockAliceCanvas(page)

    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(myChangesEmpty),
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
    await expect(page.getByTestId('person-drawer-marriages')).toBeVisible({ timeout: 5_000 })

    await expect(page.getByTestId('person-drawer-delete')).toHaveCount(0)
  })

  test('409 from revert endpoint surfaces conflictingChange.detail inline in the drawer', async ({ page }) => {
    await mockSignedInSession(page)
    await mockAliceCanvas(page)

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

    await page.route(/\/api\/changes\/[^/]+\/revert/, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Has relationships',
          conflictingChange: {
            kind: 'has-relationships',
            detail: 'Cannot delete — person has 2 relationships',
          },
        }),
      })
    )

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Alice', { timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()
    await expect(page.getByTestId('person-drawer-marriages')).toBeVisible({ timeout: 5_000 })

    page.once('dialog', d => d.accept())
    await page.getByTestId('person-drawer-delete').click()

    await expect(drawer).toBeVisible()
    await expect(page.getByTestId('person-drawer-action-error'))
      .toContainText('Cannot delete — person has 2 relationships', { timeout: 5_000 })
  })
})
