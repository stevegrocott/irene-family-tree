import { test, expect, devices, type Page } from '@playwright/test'
import { mockSignedInSession, mockPersonsAndTree } from './helpers/revert-mocks'

/**
 * Mobile responsiveness E2E tests (issue #144).
 *
 * Verifies, at an iPhone 14 viewport (390x844 via `devices['iPhone 14']`):
 *   1. The person drawer renders as a bottom sheet no taller than ~60vh, with
 *      the family tree canvas still visible above it — not the desktop
 *      320px right-side panel.
 *   2. The page never scrolls horizontally with the drawer open.
 *   3. Deleting a person surfaces an in-app themed confirmation modal instead
 *      of the native `window.confirm()` browser dialog.
 */
test.use({ ...devices['iPhone 14'] })

const LAYOUT_TOLERANCE_PX = 4

/** Single person used as the tree root across all tests in this file. */
const mockPerson = {
  gedcomId: '@IMOBILE@',
  name: 'Mobile Test',
  sex: 'F',
  birthYear: '1900',
  deathYear: null,
  birthPlace: 'London, England',
}

/** Full person detail payload for `GET /api/person/:id`. */
const mockPersonDetail = {
  ...mockPerson,
  deathPlace: null,
  occupation: null,
  notes: null,
  parents: [],
  siblings: [],
  marriages: [],
}

/** Minimal single-node tree response so the canvas renders one clickable node. */
const mockTreeResponse = {
  nodes: [
    {
      id: 'node-@IMOBILE@',
      type: 'person',
      data: {
        ...mockPerson,
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

/**
 * `GET /api/person/:id/my-changes` response with an author-owned
 * CREATE_PERSON change, so the "Delete this person" footer button renders.
 */
const mockMyChangesWithCreate = {
  createChange: {
    id: '@CHANGE1@',
    changeType: 'CREATE_PERSON',
    targetId: '@IMOBILE@',
    newValue: {},
    appliedAt: '2024-01-01T00:00:00.000Z',
  },
  relationshipChanges: [],
  updateChanges: [],
}

/**
 * Loads the tree, waits for it to render, taps the (only) person node, and
 * waits for the drawer to open.
 * @param page - Playwright page with tree/persons routes already mocked
 * @returns locator for the open person drawer
 */
async function openDrawer(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

  const personNode = page.locator('.react-flow__node-person').first()
  await expect(personNode).toBeVisible({ timeout: 10_000 })
  await personNode.tap()

  const drawer = page.getByTestId('person-drawer')
  await expect(drawer).toBeVisible()
  return drawer
}

test.describe('mobile responsive tree view', () => {
  test('person drawer renders as a bottom sheet with the tree visible above it', async ({
    page,
  }) => {
    await mockPersonsAndTree(page, [mockPerson], mockTreeResponse)
    const drawer = await openDrawer(page)

    const viewport = page.viewportSize()
    expect(viewport).not.toBeNull()
    const viewportHeight = viewport!.height

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible()

    const [drawerBox, nodeBox] = await Promise.all([
      drawer.boundingBox(),
      personNode.boundingBox(),
    ])
    expect(drawerBox).not.toBeNull()
    expect(nodeBox).not.toBeNull()

    // Bottom sheet: no taller than ~60vh (small tolerance for borders/rounding).
    expect(drawerBox!.height).toBeLessThanOrEqual(viewportHeight * 0.6 + LAYOUT_TOLERANCE_PX)

    // Anchored to the bottom of the viewport, like a sheet — not a full-height panel.
    expect(drawerBox!.y + drawerBox!.height).toBeGreaterThanOrEqual(viewportHeight - LAYOUT_TOLERANCE_PX)

    // Leaves space above it, unlike the desktop `top-0 h-full` panel.
    expect(drawerBox!.y).toBeGreaterThan(0)

    // The person node (and by extension the tree canvas) is still visible
    // above the sheet rather than hidden behind a full-height overlay.
    expect(nodeBox!.y).toBeLessThan(drawerBox!.y)

    // A close affordance is present on the sheet.
    await expect(page.getByTestId('person-drawer-close')).toBeVisible()
  })

  test('page has no horizontal overflow with the drawer open', async ({ page }) => {
    await mockPersonsAndTree(page, [mockPerson], mockTreeResponse)
    await openDrawer(page)

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  })

  test('deleting a person shows an in-app modal, not the native browser confirm', async ({
    page,
  }) => {
    // If the app still calls window.confirm(), Playwright auto-dismisses the
    // dialog (so the test doesn't hang) but we record that it fired — a
    // native dialog firing is itself the failure this test guards against.
    let nativeDialogShown = false
    page.on('dialog', (dialog) => {
      nativeDialogShown = true
      void dialog.dismiss()
    })

    await Promise.all([
      mockSignedInSession(page),
      mockPersonsAndTree(page, [mockPerson], mockTreeResponse),
    ])

    await Promise.all([
      page.route(/\/api\/person\//, async (route) => {
        const url = route.request().url()
        if (url.includes('/my-changes')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockMyChangesWithCreate),
          })
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockPersonDetail),
        })
      }),
      page.route(/\/api\/changes\/.*\/revert/, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        })
      ),
    ])

    const drawer = await openDrawer(page)

    const deleteBtn = page.getByTestId('person-drawer-delete')
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 })
    await deleteBtn.tap()

    // An in-app themed modal appears...
    const confirmModal = page.getByTestId('confirm-dialog')
    await expect(confirmModal).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('confirm-dialog-message')).toContainText(/delete/i)
    // ...and the native browser dialog never fired.
    expect(nativeDialogShown).toBe(false)

    // Confirming inside the modal proceeds with the delete and closes the drawer.
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(drawer).not.toBeVisible({ timeout: 5_000 })
  })
})

test.describe('mobile responsive toolbar and search', () => {
  test('toolbar and search bar stay within the viewport with no horizontal overflow', async ({
    page,
  }) => {
    await mockPersonsAndTree(page, [mockPerson], mockTreeResponse)
    await page.goto('/')

    const toolbar = page.getByTestId('toolbar')
    await expect(toolbar).toBeVisible({ timeout: 15_000 })
    const searchInput = page.getByTestId('search-input')
    await expect(searchInput).toBeVisible()

    const viewport = page.viewportSize()
    expect(viewport).not.toBeNull()
    const viewportWidth = viewport!.width

    const [toolbarBox, searchBox, overflow] = await Promise.all([
      toolbar.boundingBox(),
      searchInput.boundingBox(),
      page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      })),
    ])
    expect(toolbarBox).not.toBeNull()
    expect(searchBox).not.toBeNull()

    // Both floating panels stay fully inside the viewport width.
    expect(toolbarBox!.x).toBeGreaterThanOrEqual(0)
    expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(viewportWidth + LAYOUT_TOLERANCE_PX)
    expect(searchBox!.x).toBeGreaterThanOrEqual(0)
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(viewportWidth + LAYOUT_TOLERANCE_PX)

    // The search bar spans most of the available width rather than a fixed
    // desktop-sized panel (w-64 = 256px would be much narrower than this).
    expect(searchBox!.width).toBeGreaterThan(300)

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  })

  test('toolbar slider and search result rows meet the 44px touch target minimum', async ({
    page,
  }) => {
    await mockPersonsAndTree(page, [mockPerson], mockTreeResponse)
    await page.goto('/')

    const slider = page.getByTestId('toolbar-depth-slider')
    await expect(slider).toBeVisible({ timeout: 15_000 })
    const sliderBox = await slider.boundingBox()
    expect(sliderBox).not.toBeNull()
    expect(sliderBox!.height).toBeGreaterThanOrEqual(44)

    const searchInput = page.getByTestId('search-input')
    await searchInput.fill('Mobile')
    const resultItem = page.getByTestId('search-result-item').first()
    await expect(resultItem).toBeVisible()
    const resultBox = await resultItem.boundingBox()
    expect(resultBox).not.toBeNull()
    expect(resultBox!.height).toBeGreaterThanOrEqual(44)
  })
})
