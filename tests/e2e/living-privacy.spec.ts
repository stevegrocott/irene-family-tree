import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the privacy redaction UI marker (issue #142).
 *
 * Verifies:
 *   1. A person node whose payload is redacted (`living: true`) renders the
 *      "Living" marker instead of birth/death years.
 *   2. The redacted payload leaks no birth year, death year, or birth place
 *      anywhere on the canvas.
 *   3. An unredacted person (deceased) still renders their birth/death years,
 *      so the marker is not shown unconditionally.
 *
 * Scope: these specs cover the *client* half of issue #142 — that a redacted
 * payload renders as "Living". The server half (deciding what to redact for
 * anonymous requests, including nested parents/siblings/marriages) is covered
 * by the route unit tests, which mock `auth()` and Neo4j directly:
 *   - src/app/api/tree/[rootId]/route.test.ts
 *   - src/app/api/persons/route.test.ts
 *   - src/app/api/person/[id]/route.test.ts
 *
 * Data: like every other spec in this directory, the API is mocked. The E2E
 * dev server has no Neo4j connection, so hitting the real endpoints here would
 * only assert on a 500.
 */

interface NodeOverrides {
  birthYear?: string | null
  deathYear?: string | null
  birthPlace?: string | null
  living?: boolean
}

/** Serves a single-person tree plus the person list the canvas boots from. */
async function mockCanvas(page: Page, overrides: NodeOverrides) {
  const person = {
    gedcomId: '@ILIVING@',
    name: 'Alice Living',
    sex: 'F',
    birthYear: null,
    deathYear: null,
    birthPlace: null,
    deathPlace: null,
    occupation: null,
    notes: null,
    ...overrides,
  }

  await page.route(/\/api\/persons/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([person]),
    })
  )

  await page.route(/\/api\/tree\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        nodes: [
          {
            id: 'node-@ILIVING@',
            type: 'person',
            data: { ...person, isRoot: true, generation: 0 },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      }),
    })
  )
}

/** The person's name also appears in the toolbar, so assertions are scoped to the node. */
const personNode = (page: Page) => page.getByTestId('rf__node-node-@ILIVING@')

test.describe('Redacted (living) person on the canvas', () => {
  test('renders the "Living" marker instead of birth and death years', async ({ page }) => {
    await mockCanvas(page, { living: true })

    await page.goto('/')

    const node = personNode(page)
    await expect(node).toContainText('Alice Living')
    await expect(node.getByText('Living', { exact: true })).toBeVisible()
  })

  test('leaks no birth year, death year, or birth place for a redacted person', async ({ page }) => {
    await mockCanvas(page, { living: true })

    await page.goto('/')

    // The redacted payload carries no years at all, so no "b. YYYY" / "d. YYYY"
    // string may appear on the node.
    const node = personNode(page)
    await expect(node).toContainText('Alice Living')
    await expect(node.getByText(/b\.\s*\d{4}/)).toHaveCount(0)
    await expect(node.getByText(/d\.\s*\d{4}/)).toHaveCount(0)
    await expect(node).not.toContainText('Sheffield')
  })
})

test.describe('Unredacted (deceased) person on the canvas', () => {
  test('renders birth and death years and no "Living" marker', async ({ page }) => {
    await mockCanvas(page, { birthYear: '1900', deathYear: '1980', birthPlace: 'Sheffield' })

    await page.goto('/')

    const node = personNode(page)
    await expect(node).toContainText('Alice Living')
    await expect(node.getByText(/b\.\s*1900/)).toBeVisible()
    await expect(node.getByText(/d\.\s*1980/)).toBeVisible()
    await expect(node.getByText('Living', { exact: true })).toHaveCount(0)
  })
})
