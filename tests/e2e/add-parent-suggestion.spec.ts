import { test, expect } from '@playwright/test'

/**
 * E2E test for issue #113 — add-parent suggestion flow with revert support.
 *
 * Flow covered:
 *   1. Non-admin signed-in user opens the child's drawer, clicks "+ Add parent",
 *      selects an existing person, and sees a "Suggestion submitted" confirmation.
 *      The tree/drawer is NOT immediately updated — the parent does not appear.
 *   2. Admin approves the pending suggestion via POST /api/admin/suggestions/{id}
 *      (the same call the admin review UI makes). After approval the backend
 *      records a `Change` node with the original author's identity so the change
 *      appears in that author's "my-changes" feed.
 *   3. Reopening the child's drawer as the original (non-admin) author shows the
 *      parent in the Parents list alongside a × Revert button (visible because
 *      the relationship change appears in `myChanges.relationshipChanges`).
 *      Clicking Revert POSTs to `/api/changes/{id}/revert`, which the backend
 *      wires to removal of the Union node and its UNION/CHILD edges — the
 *      parent disappears from the drawer.
 *
 * All backend endpoints (tree, persons, person detail, my-changes, suggestions,
 * admin approval, change revert) are mocked so the test exercises the real UI
 * without touching Neo4j.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

const SUGGESTION_ID = 'e2e-add-parent-suggestion'
const CHANGE_ID = 'e2e-add-parent-change'
const UNION_ID = '@FUNION_PC@'

const signedInUser = {
  name: 'E2E Author',
  email: 'author@example.com',
  image: null,
}

const childFixture = {
  gedcomId: '@ICHILD@',
  name: 'Child Doe',
  sex: 'F',
  birthYear: '1990',
  deathYear: null,
  birthPlace: null,
}

const parentFixture = {
  gedcomId: '@IPARENT@',
  name: 'Parent Doe',
  sex: 'M',
  birthYear: '1960',
  deathYear: null,
  birthPlace: null,
}

const childTreeResponse = {
  nodes: [
    {
      id: 'node-@ICHILD@',
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

// ── Test ────────────────────────────────────────────────────────────────────

test.describe('Add-parent suggestion → admin approval → revert', () => {
  test('non-admin submits suggestion; admin approves; child drawer shows parent with a working × revert', async ({ page }) => {
    // Mutable state driving the API mocks across the three phases of the flow.
    let approved = false
    let reverted = false
    let suggestionPostCount = 0
    let approvePostCount = 0
    let revertPostCount = 0
    let capturedSuggestionPayload: Record<string, unknown> | null = null

    // ── Session: non-admin throughout ───────────────────────────────────────
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

    // ── Persons search + tree (static) ──────────────────────────────────────
    await page.route(/\/api\/persons(\?|$)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([childFixture, parentFixture]),
      })
    )

    await page.route(/\/api\/tree\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(childTreeResponse),
      })
    )

    // ── Child detail — parent present only between approve and revert ───────
    await page.route(/\/api\/person\/[^/]+$/, (route) => {
      const parentLinked = approved && !reverted
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...childFixture,
          occupation: null,
          notes: null,
          deathPlace: null,
          parents: parentLinked ? [parentFixture] : [],
          siblings: [],
          marriages: [],
        }),
      })
    })

    // ── my-changes — returns the relationship change after approval ─────────
    await page.route(/\/api\/person\/[^/]+\/my-changes/, (route) => {
      const hasRelChange = approved && !reverted
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          createChange: null,
          relationshipChanges: hasRelChange
            ? [
                {
                  id: CHANGE_ID,
                  newValue: { type: 'parent', targetId: parentFixture.gedcomId, unionId: UNION_ID },
                  appliedAt: '2026-04-24T10:00:00.000Z',
                },
              ]
            : [],
          updateChanges: [],
        }),
      })
    })

    // ── POST /api/suggestions — capture payload ─────────────────────────────
    await page.route(/\/api\/suggestions$/, async (route) => {
      if (route.request().method() === 'POST') {
        capturedSuggestionPayload = (await route.request().postDataJSON()) as Record<string, unknown>
        suggestionPostCount += 1
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: SUGGESTION_ID }),
        })
      }
      return route.continue()
    })

    // ── POST /api/admin/suggestions/{id} — admin approval ───────────────────
    await page.route(/\/api\/admin\/suggestions\/[^/]+$/, async (route) => {
      if (route.request().method() === 'POST') {
        const body = (await route.request().postDataJSON()) as { action?: string }
        if (body?.action === 'approve') {
          approvePostCount += 1
          approved = true
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true }),
          })
        }
      }
      return route.continue()
    })

    // ── POST /api/changes/{id}/revert — removes UNION/CHILD edges ───────────
    await page.route(/\/api\/changes\/[^/]+\/revert/, (route) => {
      if (route.request().method() === 'POST') {
        revertPostCount += 1
        reverted = true
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
      }
      return route.continue()
    })

    // ───── Phase 1: non-admin adds a parent → suggestion submitted ─────────

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

    const childNode = page.locator('.react-flow__node-person').first()
    await expect(childNode).toBeVisible({ timeout: 10_000 })
    await childNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByTestId('person-drawer-parents')).toContainText('None recorded', { timeout: 5_000 })

    // Open the Add-parent sub-view and pick the candidate parent from search.
    await drawer.getByRole('button', { name: /\+\s*add parent/i }).click()
    const searchInput = page.getByTestId('add-relative-search')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('Parent')

    const parentResult = page.getByText('Parent Doe', { exact: false })
    await expect(parentResult).toBeVisible({ timeout: 5_000 })
    await parentResult.click()

    // Confirmation UI appears — the tree is NOT updated (no immediate link).
    await expect(page.getByTestId('suggestion-submitted')).toBeVisible({ timeout: 5_000 })
    expect(suggestionPostCount).toBe(1)
    expect(capturedSuggestionPayload).toMatchObject({
      changeType: 'ADD_RELATIONSHIP',
      payload: {
        type: 'parent',
        targetId: parentFixture.gedcomId,
        childId: childFixture.gedcomId,
      },
    })

    // Return to view mode — parents list is still empty (no live change).
    await page.getByRole('button', { name: /^\s*Done\s*$/i }).click()
    await expect(drawer.getByTestId('person-drawer-parents')).toContainText('None recorded')
    await expect(drawer.getByTestId('person-drawer-parents')).not.toContainText('Parent Doe')

    // ───── Phase 2: admin approves the pending suggestion ───────────────────
    // This is the same request the admin review UI sends on Approve click.
    const approveResult = await page.evaluate(async (id) => {
      const res = await fetch(`/api/admin/suggestions/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    }, SUGGESTION_ID)
    expect(approveResult.status).toBe(200)
    expect(approveResult.body).toMatchObject({ success: true })
    expect(approvePostCount).toBe(1)

    // ───── Phase 3: child drawer shows parent in "Your Changes" + Revert ────
    // Reload so the drawer refetches detail and my-changes under the new state.
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

    const childNodeAfter = page.locator('.react-flow__node-person').first()
    await expect(childNodeAfter).toBeVisible({ timeout: 10_000 })
    await childNodeAfter.click()

    const drawerAfter = page.getByTestId('person-drawer')
    await expect(drawerAfter).toBeVisible()
    await expect(drawerAfter.getByTestId('person-drawer-parents'))
      .toContainText('Parent Doe', { timeout: 5_000 })

    // The × Revert button is rendered because the parent matches a relationshipChange.
    const revertBtn = page.getByTestId(`parent-remove-${parentFixture.gedcomId}`)
    await expect(revertBtn).toBeVisible()

    // Clicking the × triggers a confirm dialog; accept and observe the revert POST.
    page.once('dialog', (d) => d.accept())
    await revertBtn.click()

    // After revert the drawer refetches — parent is gone, list is empty again.
    await expect(drawerAfter.getByTestId('person-drawer-parents'))
      .toContainText('None recorded', { timeout: 5_000 })
    await expect(drawerAfter.getByTestId('person-drawer-parents'))
      .not.toContainText('Parent Doe')
    await expect(page.getByTestId(`parent-remove-${parentFixture.gedcomId}`)).toHaveCount(0)

    expect(revertPostCount).toBe(1)
  })
})
