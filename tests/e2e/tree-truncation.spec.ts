import { test, expect } from '@playwright/test'
import { mockPersonsAndTree } from './helpers/revert-mocks'

/**
 * E2E tests for the tree-truncation notice (issue #181).
 *
 * `GET /api/tree/[rootId]` caps its result at `MAX_NODES` and reports whether
 * the traversal was cut short via `truncated` (and, when cheap to compute,
 * `totalNodes`). Previously this cap was invisible to the user — the toolbar
 * would report a partial person count as though it were the whole tree.
 *
 * These specs mock the tree API directly (no Neo4j in the E2E dev server, so
 * seeding >500 real nodes isn't necessary here — the route unit tests own
 * that; see `src/app/api/tree/[rootId]/route.test.ts`) and assert that:
 *   1. A `truncated: true` response surfaces a visible notice in the toolbar.
 *   2. A `truncated: false` (or absent) response shows no such notice, so the
 *      notice isn't rendered unconditionally.
 */

/** Root person used across all tests in this file. */
const rootPerson = {
  gedcomId: '@ITRUNC@',
  name: 'Truncated Root',
  sex: 'F',
  birthYear: '1900',
  deathYear: null,
  birthPlace: null,
}

/** A couple of extra person nodes so the tree isn't a single-node edge case. */
function treeNodes() {
  return [
    {
      id: 'node-@ITRUNC@',
      type: 'person',
      data: { ...rootPerson, deathPlace: null, occupation: null, notes: null, isRoot: true, generation: 0 },
      position: { x: 0, y: 0 },
    },
    {
      id: 'node-@ICHILD1@',
      type: 'person',
      data: {
        gedcomId: '@ICHILD1@',
        name: 'Child One',
        sex: 'M',
        birthYear: '1925',
        deathYear: null,
        birthPlace: null,
        deathPlace: null,
        occupation: null,
        notes: null,
        isRoot: false,
        generation: 1,
      },
      position: { x: 100, y: 100 },
    },
  ]
}

test.describe('Tree truncation notice', () => {
  test('shows a visible notice in the toolbar when the response reports truncated: true', async ({ page }) => {
    await mockPersonsAndTree(page, [rootPerson], {
      nodes: treeNodes(),
      edges: [],
      truncated: true,
      totalNodes: 588,
    })

    await page.goto('/')

    // Wait for the canvas to finish loading before asserting on the notice.
    await expect(page.getByTestId('toolbar-person-count')).toBeVisible({ timeout: 15_000 })

    const notice = page.getByTestId('toolbar-truncation-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/truncat/i)
  })

  test('shows no truncation notice when the response reports truncated: false', async ({ page }) => {
    await mockPersonsAndTree(page, [rootPerson], {
      nodes: treeNodes(),
      edges: [],
      truncated: false,
      totalNodes: 2,
    })

    await page.goto('/')

    await expect(page.getByTestId('toolbar-person-count')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('toolbar-truncation-notice')).toHaveCount(0)
  })

  test('shows no truncation notice when the response omits the field entirely', async ({ page }) => {
    // Guards against a regression where the notice renders on `undefined`
    // truthiness rather than a strict `truncated === true` check — i.e. that
    // existing clients/fixtures without the new fields at all still work.
    await mockPersonsAndTree(page, [rootPerson], {
      nodes: treeNodes(),
      edges: [],
    })

    await page.goto('/')

    await expect(page.getByTestId('toolbar-person-count')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('toolbar-truncation-notice')).toHaveCount(0)
  })
})
