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

/** Measures document scroll/client width to detect horizontal overflow. */
function getHorizontalOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
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

    const overflow = await getHorizontalOverflow(page)

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
      getHorizontalOverflow(page),
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

  test('toolbar keeps the truncation notice on a single line at 1010px and 360px', async ({
    page,
  }) => {
    // Issue #187: once the truncation notice (#181) is present, its text
    // wraps inside its own span below ~1200px, stretching the whole toolbar
    // from a single row (66px on a 1440px baseline) to a wrapped 146px
    // column. Measure a wide-viewport baseline, then confirm the regression
    // doesn't reappear at narrower widths with the notice showing.
    const truncatedTreeResponse = {
      ...mockTreeResponse,
      truncated: true,
      totalNodes: 766,
    }
    await mockPersonsAndTree(page, [mockPerson], truncatedTreeResponse)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    const toolbar = page.getByTestId('toolbar')
    await expect(toolbar).toBeVisible({ timeout: 15_000 })
    const appName = page.getByTestId('toolbar-app-name')
    const notice = page.getByTestId('toolbar-truncation-notice')
    await expect(notice).toBeVisible()

    const baselineBox = await toolbar.boundingBox()
    expect(baselineBox).not.toBeNull()
    const baselineHeight = baselineBox!.height

    // At 1010px the toolbar sits above Tailwind's `sm` (640px) breakpoint,
    // where `sm:flex-nowrap` applies — the container itself cannot wrap
    // onto a second flex line, so it must stay a genuine single row.
    await page.setViewportSize({ width: 1010, height: 780 })
    const [toolbarBoxAt1010, appNameBoxAt1010, noticeBoxAt1010] = await Promise.all([
      toolbar.boundingBox(),
      appName.boundingBox(),
      notice.boundingBox(),
    ])
    expect(toolbarBoxAt1010).not.toBeNull()
    expect(appNameBoxAt1010).not.toBeNull()
    expect(noticeBoxAt1010).not.toBeNull()

    // AC1/AC5: no more than ~1.3x the wide-viewport row height — the
    // pre-fix regression doubled it (2.2x) by wrapping the notice.
    expect(toolbarBoxAt1010!.height).toBeLessThanOrEqual(baselineHeight * 1.3 + LAYOUT_TOLERANCE_PX)

    // AC2: the toolbar items share a single row — the notice sits at the
    // same top offset as the never-wrapping app name.
    expect(Math.abs(noticeBoxAt1010!.y - appNameBoxAt1010!.y)).toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX)
    await expect(notice).toBeVisible()

    // At 360px the toolbar is below the `sm` breakpoint, where the
    // container's own `flex-wrap` legitimately stacks items onto separate
    // rows regardless of this fix — that isn't the regression. What must
    // still hold is the actual #187 mechanism: the notice's own row stays a
    // single text line (matching a sibling item that never wraps) instead
    // of wrapping internally into a tall multi-line column.
    await page.setViewportSize({ width: 360, height: 780 })
    const [appNameBoxAt360, noticeBoxAt360] = await Promise.all([
      appName.boundingBox(),
      notice.boundingBox(),
    ])
    expect(appNameBoxAt360).not.toBeNull()
    expect(noticeBoxAt360).not.toBeNull()

    // AC2/AC3: the notice stays a single line — no taller than the app
    // name's own (single-line) row — rather than the tall wrapped column
    // the pre-fix mechanism produced.
    expect(noticeBoxAt360!.height).toBeLessThanOrEqual(appNameBoxAt360!.height + LAYOUT_TOLERANCE_PX)
    await expect(notice).toBeVisible()
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
