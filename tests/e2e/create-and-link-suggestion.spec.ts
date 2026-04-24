import { test, expect } from '@playwright/test'

/**
 * E2E tests for issue #115 — `handleCreateAndLink` must mirror the role-aware
 * branching of `handleSelectRelative` when adding a new person as a parent.
 *
 * Covers:
 *   1. Non-admin creates a new person as parent
 *        → POST /api/suggestions called with the correct ADD_RELATIONSHIP payload
 *        → POST /api/person/{id}/relationships is NEVER called
 *        → the suggestion-submitted confirmation UI is shown
 *   2. Admin creates a new person as parent
 *        → POST /api/person/{id}/relationships is called (direct link)
 *        → POST /api/suggestions is NEVER called
 *   3. Non-admin: /api/persons succeeds but POST /api/suggestions fails
 *        → the newly-created person was written (orphan in the graph)
 *        → a user-visible error message is surfaced in the drawer
 *        → the suggestion-submitted UI is NOT shown
 *
 * All API endpoints (tree, persons, person detail, suggestions, relationships,
 * my-changes) are mocked so the tests run without Neo4j.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

const nonAdminUser = {
  name: 'E2E Author',
  email: 'author@example.com',
  image: null,
  // no role → treated as regular (non-admin) user
}

const adminUser = {
  name: 'E2E Admin',
  email: 'admin@example.com',
  image: null,
  role: 'admin',
}

const childFixture = {
  gedcomId: '@ICHILD@',
  name: 'Child Doe',
  sex: 'F',
  birthYear: '1990',
  deathYear: null,
  birthPlace: null,
}

const NEW_PARENT_ID = '@INEWPARENT@'
const NEW_PARENT_GIVEN = 'New'
const NEW_PARENT_FAMILY = 'Parent'
const NEW_PARENT_NAME = `${NEW_PARENT_GIVEN} ${NEW_PARENT_FAMILY}`

const childTreeResponse = {
  nodes: [
    {
      id: `node-${childFixture.gedcomId}`,
      type: 'person',
      data: {
        ...childFixture,
        occupation: null,
        notes: null,
        deathPlace: null,
        isRoot: true,
        generation: 0,
      },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type MockSession = { user: Record<string, unknown>; expires: string }

async function mockSession(
  page: import('@playwright/test').Page,
  user: Record<string, unknown>
) {
  await page.route(/\/api\/auth\/session\b/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user, expires: '2099-01-01T00:00:00.000Z' } satisfies MockSession),
    })
  )
}

async function mockTreeAndDetail(page: import('@playwright/test').Page) {
  await page.route(/\/api\/persons(\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([childFixture]),
    })
  )

  await page.route(/\/api\/tree\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(childTreeResponse),
    })
  )

  // Person detail — always no relationships so the drawer stays in the
  // empty state regardless of whether the link is direct or via suggestion.
  await page.route(/\/api\/person\/[^/]+$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...childFixture,
        occupation: null,
        notes: null,
        deathPlace: null,
        parents: [],
        siblings: [],
        marriages: [],
      }),
    })
  )

  await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ createChange: null, relationshipChanges: [], updateChanges: [] }),
    })
  )
}

async function openAddParentCreateForm(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

  const childNode = page.locator('.react-flow__node-person').first()
  await expect(childNode).toBeVisible({ timeout: 10_000 })
  await childNode.click()

  const drawer = page.getByTestId('person-drawer')
  await expect(drawer).toBeVisible()

  await drawer.getByRole('button', { name: /\+\s*add parent/i }).click()
  await expect(page.getByTestId('add-relative-search')).toBeVisible()

  await page.getByLabel(/given name/i).fill(NEW_PARENT_GIVEN)
  await page.getByLabel(/family name/i).fill(NEW_PARENT_FAMILY)

  return drawer
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('handleCreateAndLink — role-aware create-and-link for parent adds', () => {
  test('non-admin: creating a new person as parent routes through /api/suggestions and never calls /relationships', async ({ page }) => {
    await mockSession(page, nonAdminUser)
    await mockTreeAndDetail(page)

    let suggestionPostCount = 0
    let relationshipsPostCount = 0
    let capturedSuggestionPayload: Record<string, unknown> | null = null
    let capturedPersonPayload: Record<string, unknown> | null = null

    // POST /api/persons — returns the newly created person.
    await page.route(/\/api\/persons(\?|$)/, async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        capturedPersonPayload = (await req.postDataJSON()) as Record<string, unknown>
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            gedcomId: NEW_PARENT_ID,
            name: NEW_PARENT_NAME,
            sex: 'U',
            birthYear: null,
            birthPlace: null,
          }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([childFixture]),
      })
    })

    // POST /api/suggestions — capture payload, return 201.
    await page.route(/\/api\/suggestions$/, async (route) => {
      if (route.request().method() === 'POST') {
        capturedSuggestionPayload = (await route.request().postDataJSON()) as Record<string, unknown>
        suggestionPostCount += 1
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'e2e-suggestion-115' }),
        })
      }
      return route.continue()
    })

    // POST /api/person/{id}/relationships — must NOT be called in this flow.
    await page.route(/\/api\/person\/[^/]+\/relationships/, (route) => {
      if (route.request().method() === 'POST') {
        relationshipsPostCount += 1
        return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
      }
      return route.continue()
    })

    const drawer = await openAddParentCreateForm(page)

    await page.getByRole('button', { name: /^\s*save change\s*$/i }).click()

    // Confirmation UI appears — suggestion-submitted subview, not the tree update.
    await expect(page.getByTestId('suggestion-submitted')).toBeVisible({ timeout: 5_000 })

    // POST /api/persons was called with the composed full name.
    expect(capturedPersonPayload).toMatchObject({ name: NEW_PARENT_NAME })

    // POST /api/suggestions was called exactly once with the expected payload.
    expect(suggestionPostCount).toBe(1)
    expect(capturedSuggestionPayload).toMatchObject({
      changeType: 'ADD_RELATIONSHIP',
      payload: {
        type: 'parent',
        targetId: NEW_PARENT_ID,
        childId: childFixture.gedcomId,
      },
    })

    // POST /api/person/{id}/relationships was NEVER called.
    expect(relationshipsPostCount).toBe(0)

    // The parent does NOT appear in the drawer's parents list.
    await page.getByRole('button', { name: /^\s*Done\s*$/i }).click()
    await expect(drawer.getByTestId('person-drawer-parents')).toContainText('None recorded')
    await expect(drawer.getByTestId('person-drawer-parents')).not.toContainText(NEW_PARENT_NAME)
  })

  test('admin: creating a new person as parent links directly via /relationships and does not hit /api/suggestions', async ({ page }) => {
    await mockSession(page, adminUser)
    await mockTreeAndDetail(page)

    let suggestionPostCount = 0
    let relationshipsPostCount = 0
    let capturedRelationshipsPayload: Record<string, unknown> | null = null

    await page.route(/\/api\/persons(\?|$)/, async (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            gedcomId: NEW_PARENT_ID,
            name: NEW_PARENT_NAME,
            sex: 'U',
            birthYear: null,
            birthPlace: null,
          }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([childFixture]),
      })
    })

    await page.route(/\/api\/suggestions$/, (route) => {
      if (route.request().method() === 'POST') {
        suggestionPostCount += 1
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'should-not-be-called' }),
        })
      }
      return route.continue()
    })

    await page.route(/\/api\/person\/[^/]+\/relationships/, async (route) => {
      if (route.request().method() === 'POST') {
        capturedRelationshipsPayload = (await route.request().postDataJSON()) as Record<string, unknown>
        relationshipsPostCount += 1
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
      }
      return route.continue()
    })

    await openAddParentCreateForm(page)
    await page.getByRole('button', { name: /^\s*save change\s*$/i }).click()

    // Admin path: the relationships POST fires exactly once with the new person
    // as the target and parent type, while the suggestions endpoint is never hit.
    await expect
      .poll(() => relationshipsPostCount, { timeout: 5_000 })
      .toBe(1)

    expect(capturedRelationshipsPayload).toMatchObject({
      targetId: NEW_PARENT_ID,
      type: 'parent',
    })

    expect(suggestionPostCount).toBe(0)

    // No suggestion-submitted UI should appear for admin — the drawer returns
    // to view mode after a direct link.
    await expect(page.getByTestId('suggestion-submitted')).not.toBeVisible()
  })

  test('non-admin: if POST /api/suggestions fails after person creation, a clear error is surfaced and the suggestion-submitted UI is NOT shown', async ({ page }) => {
    await mockSession(page, nonAdminUser)
    await mockTreeAndDetail(page)

    let personPostCount = 0
    let suggestionPostCount = 0
    let relationshipsPostCount = 0

    await page.route(/\/api\/persons(\?|$)/, (route) => {
      if (route.request().method() === 'POST') {
        personPostCount += 1
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            gedcomId: NEW_PARENT_ID,
            name: NEW_PARENT_NAME,
            sex: 'U',
            birthYear: null,
            birthPlace: null,
          }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([childFixture]),
      })
    })

    // Suggestions POST returns 500 — simulating the failure-after-create case.
    await page.route(/\/api\/suggestions$/, (route) => {
      if (route.request().method() === 'POST') {
        suggestionPostCount += 1
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        })
      }
      return route.continue()
    })

    await page.route(/\/api\/person\/[^/]+\/relationships/, (route) => {
      if (route.request().method() === 'POST') {
        relationshipsPostCount += 1
        return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
      }
      return route.continue()
    })

    const drawer = await openAddParentCreateForm(page)
    await page.getByRole('button', { name: /^\s*save change\s*$/i }).click()

    // Both the person create and the suggestion attempt were observed.
    await expect.poll(() => personPostCount, { timeout: 5_000 }).toBe(1)
    await expect.poll(() => suggestionPostCount, { timeout: 5_000 }).toBe(1)

    // The fallback direct-link path must NOT run — that is the whole point of
    // the fix: a failed suggestion must not silently write a direct relationship.
    expect(relationshipsPostCount).toBe(0)

    // The confirmation UI is NOT shown because the suggestion did not succeed.
    await expect(page.getByTestId('suggestion-submitted')).not.toBeVisible()

    // A user-visible error message appears in the drawer. The exact copy is
    // allowed to evolve — we only require a red error referencing failure,
    // which matches the `setActionError(...)` pattern used elsewhere in
    // this component (handleSelectRelative uses "Failed to submit suggestion.
    // Please try again." / handleCreateAndLink uses "Failed to ...").
    await expect(drawer.getByText(/fail|error|try again/i)).toBeVisible({ timeout: 5_000 })
  })
})
