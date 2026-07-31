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
 * Realistic-scale root person for the toolbar width test (issue #190).
 * The one-person "Mobile Test" fixture used elsewhere in this file made the
 * pre-fix toolbar spec pass even while the real toolbar was a fixed 1067px
 * row clipped off both viewport edges below ~1130px — intrinsic width is
 * driven by the rendered root name and the person count, neither of which a
 * short single-person fixture reproduces.
 */
const mockRealisticRootPerson = {
  gedcomId: '@IREALISTIC@',
  name: 'Margaret Elizabeth Whitfield-Harrington',
  sex: 'F',
  birthYear: '1900',
  deathYear: null,
  birthPlace: 'London, England',
}

/**
 * Builds a real-data-scale tree response: hundreds of person nodes spread
 * across several generations, plus a large `totalNodes` behind `truncated:
 * true` — matching the shape of the real dataset (issue #190's research) that
 * the one-node fixtures elsewhere in this file don't reproduce.
 */
function buildRealisticTreeResponse() {
  const PERSON_COUNT = 342
  const nodes = [
    {
      id: `node-${mockRealisticRootPerson.gedcomId}`,
      type: 'person',
      data: {
        ...mockRealisticRootPerson,
        deathPlace: null,
        occupation: null,
        notes: null,
        isRoot: true,
        generation: 0,
      },
      position: { x: 0, y: 0 },
    },
    ...Array.from({ length: PERSON_COUNT - 1 }, (_, i) => {
      const generation = (i % 5) - 2
      return {
        id: `node-@IREL${i}@`,
        type: 'person',
        data: {
          gedcomId: `@IREL${i}@`,
          name: `Relative Surname${i} Family${i}`,
          sex: i % 2 === 0 ? 'M' : 'F',
          birthYear: `${1810 + (i % 180)}`,
          deathYear: null,
          birthPlace: null,
          deathPlace: null,
          occupation: null,
          notes: null,
          isRoot: false,
          generation,
        },
        position: { x: i * 10, y: generation * 100 },
      }
    }),
  ]
  return {
    nodes,
    edges: [],
    truncated: true,
    totalNodes: 812,
  }
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

  test('toolbar stays within the viewport at 1010px and 800px with realistic content', async ({
    page,
  }) => {
    // Issue #190: with real data the toolbar is a fixed ~1067px row, clipped
    // off *both* edges of the viewport below ~1130px — a regression from
    // #187's fix, which only ever ran against a one-person fixture that's a
    // fraction of real intrinsic width and so always fit. This test uses a
    // realistic-scale fixture (a long root name, a 342-person tree, a large
    // `totalNodes`) so the toolbar's true content width is exercised, then
    // asserts it never overhangs either edge at the two widths (1010px,
    // 800px) the issue's research measured as clipped on `main`.
    await mockPersonsAndTree(page, [mockRealisticRootPerson], buildRealisticTreeResponse())

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    const toolbar = page.getByTestId('toolbar')
    await expect(toolbar).toBeVisible({ timeout: 15_000 })
    const notice = page.getByTestId('toolbar-truncation-notice')
    await expect(notice).toBeVisible()

    const baselineBox = await toolbar.boundingBox()
    expect(baselineBox).not.toBeNull()
    const baselineHeight = baselineBox!.height

    // AC1: at 1010×780 — above Tailwind's `sm` (640px) breakpoint, where
    // `sm:flex-nowrap` applies, so the row cannot escape by wrapping — the
    // toolbar must stay fully inside the viewport on both edges.
    await page.setViewportSize({ width: 1010, height: 780 })
    const toolbarBoxAt1010 = await toolbar.boundingBox()
    expect(toolbarBoxAt1010).not.toBeNull()
    expect(toolbarBoxAt1010!.x).toBeGreaterThanOrEqual(0)
    expect(toolbarBoxAt1010!.x + toolbarBoxAt1010!.width).toBeLessThanOrEqual(1010 + LAYOUT_TOLERANCE_PX)

    // AC3: height stays within ~1.3x the wide-viewport baseline — #187's
    // single-row fix must not regress while the width bound is added.
    expect(toolbarBoxAt1010!.height).toBeLessThanOrEqual(baselineHeight * 1.3 + LAYOUT_TOLERANCE_PX)

    // AC4: the truncation warning stays visible once the width is bounded.
    await expect(notice).toBeVisible()

    // AC2: the same bound holds at 800×700 — the narrowest width the
    // issue's research table measured as clipped on both edges.
    await page.setViewportSize({ width: 800, height: 700 })
    const toolbarBoxAt800 = await toolbar.boundingBox()
    expect(toolbarBoxAt800).not.toBeNull()
    expect(toolbarBoxAt800!.x).toBeGreaterThanOrEqual(0)
    expect(toolbarBoxAt800!.x + toolbarBoxAt800!.width).toBeLessThanOrEqual(800 + LAYOUT_TOLERANCE_PX)

    // AC4: the truncation warning (or its node count) remains available at
    // the narrowest width too.
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
