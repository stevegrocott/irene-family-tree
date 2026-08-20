import { test, expect } from '@playwright/test'

/**
 * E2E tests for the "database unavailable" viewer state (issue #321, AC4).
 *
 * Previously a failed `/api/persons` or `/api/tree/[rootId]` fetch (as happens
 * when the underlying database is unreachable) either rendered nothing but a
 * few words of red text over an otherwise-empty canvas, or — for the
 * persons-list case — a slightly different card. Both looked close enough to
 * "this person/tree legitimately has no data" that a real outage wasn't
 * obviously distinguishable from a quiet, empty result. Both failure paths
 * now render a shared `database-unavailable` card instead, and neither is
 * shown when a request merely succeeds with no data.
 *
 * These specs stub the API directly (no live database in the E2E dev
 * server), per the pattern used throughout `tests/e2e/`.
 */

const rootPerson = {
  gedcomId: '@IDBUNAVAIL@',
  name: 'Outage Root',
  sex: 'F',
  birthYear: '1900',
  deathYear: null,
  birthPlace: null,
}

test.describe('Database-unavailable viewer state', () => {
  test('shows the database-unavailable card when /api/persons fails, not the empty canvas', async ({ page }) => {
    await page.route(/\/api\/persons/, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) })
    )

    await page.goto('/')

    const banner = page.getByTestId('database-unavailable')
    await expect(banner).toBeVisible({ timeout: 15_000 })
    await expect(banner).toContainText(/database unavailable/i)
    await expect(page.getByTestId('empty-state')).toHaveCount(0)
  })

  test('shows the database-unavailable card when the tree fetch fails, not an empty canvas', async ({ page }) => {
    await page.route(/\/api\/persons/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([rootPerson]) })
    )
    await page.route(/\/api\/tree\//, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) })
    )

    await page.goto(`/?root=${encodeURIComponent(rootPerson.gedcomId)}`)

    const banner = page.getByTestId('database-unavailable')
    await expect(banner).toBeVisible({ timeout: 15_000 })
    await expect(banner).toContainText(/database unavailable/i)
    // The failure must not leave a person node rendered as though the fetch
    // had simply returned an (empty) success.
    await expect(page.locator('.react-flow__node-person')).toHaveCount(0)

    // Retry re-issues the tree fetch; once it succeeds the canvas replaces the card.
    await page.route(/\/api\/tree\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nodes: [
            {
              id: `node-${rootPerson.gedcomId}`,
              type: 'person',
              data: { ...rootPerson, deathPlace: null, occupation: null, notes: null, isRoot: true, generation: 0 },
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        }),
      })
    )
    await page.getByTestId('database-unavailable-retry').click()
    await expect(banner).toHaveCount(0)
    await expect(page.locator('.react-flow__node-person').first()).toBeVisible({ timeout: 15_000 })
  })

  test('a genuinely empty persons list shows the normal entry state, not the database-unavailable card', async ({ page }) => {
    await page.route(/\/api\/persons/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    )

    await page.goto('/')

    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('database-unavailable')).toHaveCount(0)
  })
})
