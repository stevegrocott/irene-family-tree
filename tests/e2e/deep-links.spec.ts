import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * E2E tests for shareable deep links into the family tree viewer (issue #150).
 *
 * Verifies the four user-visible behaviours of the deep-link feature:
 *   1. Opening `/?root=<encoded id>` focuses the tree on that person.
 *   2. Re-rooting the tree updates the URL to reflect the new root.
 *   3. The copy-link button writes the current viewer URL to the clipboard.
 *   4. An unknown root id falls back to the default root (Irene @I85@).
 *
 * Data: like every other spec in this directory, the API is mocked. The E2E
 * dev server has no Neo4j connection, so hitting the real endpoints here would
 * only assert on a 500. The tree endpoint always returns BOTH people so a node
 * for the re-root target is present regardless of which person is the root.
 */

/** Default root person — matches DEFAULT_ROOT_GEDCOM_ID in src/constants/tree.ts. */
const IRENE = {
  gedcomId: '@I85@',
  name: 'Irene Tunnicliffe',
  sex: 'F',
  birthYear: '1930',
  deathYear: '2000',
  birthPlace: 'Sheffield',
  deathPlace: null,
  occupation: null,
  notes: null,
}

/** A second person used as the deep-link target and re-root destination. */
const SECOND = {
  gedcomId: '@I99@',
  name: 'Second Person',
  sex: 'M',
  birthYear: '1955',
  deathYear: null,
  birthPlace: 'Leeds',
  deathPlace: null,
  occupation: null,
  notes: null,
}

/** A GEDCOM id that is well-formed but matches no person in the list. */
const UNKNOWN_ROOT = '@INOTREAL@'

/** Percent-encoded forms as they appear in the URL query string. */
const IRENE_ENC = '%40I85%40'
const SECOND_ENC = '%40I99%40'

/**
 * Mocks `/api/persons`, `/api/tree/*` and `/api/person/*` so the canvas can
 * boot and re-root without a database. The tree response contains both people
 * with the requested root at generation 0 and the other as its descendant.
 */
async function mockCanvas(page: Page) {
  await page.route(/\/api\/persons/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([IRENE, SECOND]),
    })
  )

  await page.route(/\/api\/tree\//, (route: Route) => {
    const match = route.request().url().match(/\/api\/tree\/([^?]+)/)
    const requestedRoot = match ? decodeURIComponent(match[1]) : IRENE.gedcomId
    const rootPerson = requestedRoot === SECOND.gedcomId ? SECOND : IRENE
    const otherPerson = rootPerson === IRENE ? SECOND : IRENE

    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        nodes: [
          {
            id: `node-${rootPerson.gedcomId}`,
            type: 'person',
            data: { ...rootPerson, isRoot: true, generation: 0 },
            position: { x: 0, y: 0 },
          },
          {
            id: `node-${otherPerson.gedcomId}`,
            type: 'person',
            data: { ...otherPerson, isRoot: false, generation: 1 },
            position: { x: 0, y: 120 },
          },
        ],
        edges: [
          {
            id: 'edge-root-other',
            source: `node-${rootPerson.gedcomId}`,
            target: `node-${otherPerson.gedcomId}`,
            label: 'CHILD',
          },
        ],
      }),
    })
  })

  // The drawer fetches person detail + my-changes when opened. Serve minimal
  // shapes so re-rooting works without console noise; the reroot button in the
  // drawer footer renders from the node data regardless.
  await page.route(/\/api\/person\//, (route: Route) => {
    const url = route.request().url()
    if (url.includes('/my-changes')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ createChange: null, relationshipChanges: [], updateChanges: [] }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ parents: [], siblings: [], marriages: [] }),
    })
  })
}

/** Node on the canvas for a given person, addressed by its ReactFlow test id. */
const nodeFor = (page: Page, gedcomId: string) => page.getByTestId(`rf__node-node-${gedcomId}`)

/** The toolbar label showing which person the tree is currently rooted on. */
const viewing = (page: Page) => page.getByTestId('toolbar-viewing')

/**
 * Re-roots the tree onto SECOND via the real UI: click their node to open the
 * PersonDrawer, then click the "FOCUS TREE ON …" button. This is a genuine
 * user interaction which triggers the URL sync.
 */
async function rerootToSecond(page: Page) {
  const secondNode = nodeFor(page, SECOND.gedcomId)
  await expect(secondNode).toBeVisible({ timeout: 15_000 })
  await secondNode.click()

  const drawer = page.getByTestId('person-drawer')
  await expect(drawer).toBeVisible()

  const reroot = page.getByTestId('person-drawer-reroot')
  await expect(reroot).toBeVisible()
  await reroot.click()

  await expect(drawer).not.toBeVisible({ timeout: 5_000 })
}

test.describe('Tree deep links', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockCanvas(page)
  })

  test('opening /?root=<id> focuses the tree on that person', async ({ page }) => {
    await page.goto(`/?root=${SECOND.gedcomId}`)

    // The toolbar reflects the deep-linked root, not the default person.
    await expect(viewing(page)).toBeVisible({ timeout: 15_000 })
    await expect(viewing(page)).toContainText(SECOND.name, { timeout: 10_000 })
    await expect(viewing(page)).not.toContainText(IRENE.name)

    // The deep-linked person is present on the canvas.
    await expect(nodeFor(page, SECOND.gedcomId)).toContainText(SECOND.name)
  })

  test('re-rooting updates the URL to the new root', async ({ page }) => {
    await page.goto('/')

    // Boots on the default root (Irene) since there is no URL param.
    await expect(viewing(page)).toContainText(IRENE.name, { timeout: 15_000 })

    await rerootToSecond(page)

    // The URL now encodes the new root, and the toolbar follows.
    await expect(page).toHaveURL(new RegExp(`root=${SECOND_ENC}`), { timeout: 10_000 })
    await expect(page).not.toHaveURL(new RegExp(`root=${IRENE_ENC}`))
    await expect(viewing(page)).toContainText(SECOND.name)
  })

  test('copy-link button writes the current URL to the clipboard', async ({ page }) => {
    await page.goto('/')
    await expect(viewing(page)).toContainText(IRENE.name, { timeout: 15_000 })

    // Re-root so the URL syncs to a stable, shareable state before copying.
    await rerootToSecond(page)
    await expect(page).toHaveURL(new RegExp(`root=${SECOND_ENC}`), { timeout: 10_000 })

    const copyButton = page.getByTestId('toolbar-copy-link')
    await expect(copyButton).toBeVisible()
    await copyButton.click()

    // The button confirms the copy, and the clipboard holds the current URL.
    await expect(copyButton).toHaveText('Copied!')
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(page.url())
    expect(clipboard).toContain(`root=${SECOND_ENC}`)
  })

  test('unknown root falls back to the default root', async ({ page }) => {
    await page.goto(`/?root=${UNKNOWN_ROOT}`)

    // The unknown id matches no person, so the viewer falls back to the
    // default root (Irene) rather than erroring or showing a blank canvas.
    await expect(viewing(page)).toBeVisible({ timeout: 15_000 })
    await expect(viewing(page)).toContainText(IRENE.name, { timeout: 10_000 })
    await expect(nodeFor(page, IRENE.gedcomId)).toContainText(IRENE.name)
  })
})
