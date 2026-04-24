import { test, expect, type BrowserContext } from '@playwright/test'
import { encode } from '@auth/core/jwt'
import { mockPersonsAndTree, mockSignedInSession } from './helpers/revert-mocks'

/**
 * E2E tests for the cascade-revert flow (issue #127).
 *
 * Scenarios:
 *   1. Admin deletes a person they created (with connections they also created) →
 *      cascade-revert is called, drawer closes, person removed from tree.
 *   2. Non-admin deletes a person they created with no connections →
 *      simple /api/changes/[id]/revert is called, drawer closes (success).
 *   3. Non-admin attempt where another user added a connection →
 *      delete button is pre-disabled and error message is shown inline.
 */

// ── Admin auth helper ────────────────────────────────────────────────────────

async function setAdminCookie(context: BrowserContext): Promise<void> {
  const token = await encode({
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

// ── Shared mock data ─────────────────────────────────────────────────────────

// Alice with one parent — used in admin test (scenario 1) and foreign-connection test (scenario 3)
const mockAliceWithParent = {
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

// Alice with no connections — used in non-admin simple-revert test (scenario 2)
const mockAliceNoConnections = {
  gedcomId: '@IALICE@',
  name: 'Alice Simple',
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

const aliceWithParentTreeResponse = {
  nodes: [{
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
  }],
  edges: [],
}

const aliceSimpleTreeResponse = {
  nodes: [{
    id: 'node-@IALICE@',
    type: 'person',
    data: {
      gedcomId: '@IALICE@',
      name: 'Alice Simple',
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
  }],
  edges: [],
}

// Admin's my-changes: created Alice and added the parent relationship themselves
const adminChangesWithRelationship = {
  createChange: {
    id: 'change-create-1',
    changeType: 'CREATE_PERSON',
    targetId: '@IALICE@',
    newValue: { name: 'Alice Connected' },
    appliedAt: '2026-04-01T10:00:00.000Z',
  },
  relationshipChanges: [
    { id: 'change-rel-1', newValue: { unionId: '@UBOB@' }, appliedAt: '2026-04-01T10:01:00.000Z' },
  ],
  updateChanges: [],
}

// Non-admin's my-changes: created Alice, owns no relationship changes
// Used for both scenario 2 (Alice has no connections) and scenario 3 (another user added them)
const userChangesCreateOnly = {
  createChange: {
    id: 'change-create-2',
    changeType: 'CREATE_PERSON',
    targetId: '@IALICE@',
    newValue: { name: 'Alice Simple' },
    appliedAt: '2026-04-01T10:00:00.000Z',
  },
  relationshipChanges: [],
  updateChanges: [],
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('cascade-revert: delete person', () => {
  test('admin deletes a person they created with connections they also created — person removed from tree, success shown', async ({ page, context }) => {
    let cascadePostCount = 0

    await setAdminCookie(context)
    await mockPersonsAndTree(page,
      [{ gedcomId: '@IALICE@', name: 'Alice Connected', sex: 'F', birthYear: '1990', deathYear: null, birthPlace: null }],
      aliceWithParentTreeResponse,
    )

    await page.route(/\/api\/person\/[^/]+\/my-changes/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(adminChangesWithRelationship),
      })
    )

    await page.route(/\/api\/person\/[^/]+\/cascade-revert/, async route => {
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

    await page.route(/\/api\/person\/[^/]+$/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAliceWithParent),
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

    page.once('dialog', d => {
      expect(d.message()).toMatch(/1.*connections?/i)
      d.accept()
    })
    await deleteBtn.click()

    await expect(drawer).not.toBeVisible({ timeout: 5_000 })
    expect(cascadePostCount).toBe(1)
  })

  test('non-admin deletes a person they created with no connections — success', async ({ page }) => {
    let revertPostCount = 0

    await mockSignedInSession(page)
    await mockPersonsAndTree(page,
      [{ gedcomId: '@IALICE@', name: 'Alice Simple', sex: 'F', birthYear: '1990', deathYear: null, birthPlace: null }],
      aliceSimpleTreeResponse,
    )

    await page.route(/\/api\/person\/[^/]+\/my-changes/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(userChangesCreateOnly),
      })
    )

    await page.route(/\/api\/person\/[^/]+$/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAliceNoConnections),
      })
    )

    await page.route(/\/api\/changes\/[^/]+\/revert/, async route => {
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
    await expect(deleteBtn).toBeVisible()
    await expect(deleteBtn).toBeEnabled()

    page.once('dialog', d => d.accept())
    await deleteBtn.click()

    await expect(drawer).not.toBeVisible({ timeout: 5_000 })
    expect(revertPostCount).toBe(1)
  })

  test('non-admin attempt where another user added a connection — error message shown', async ({ page }) => {
    await mockSignedInSession(page)
    await mockPersonsAndTree(page,
      [{ gedcomId: '@IALICE@', name: 'Alice Connected', sex: 'F', birthYear: '1990', deathYear: null, birthPlace: null }],
      aliceWithParentTreeResponse,
    )

    await page.route(/\/api\/person\/[^/]+\/my-changes/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(userChangesCreateOnly),
      })
    )

    await page.route(/\/api\/person\/[^/]+$/, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAliceWithParent),
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

    await expect(page.getByTestId('person-drawer-action-error')).toContainText(/admin/i, { timeout: 5_000 })
    await expect(drawer).toBeVisible()
  })
})
