import { test, expect, type Page } from '@playwright/test'
import { mockSignedInSession, mockPersonsAndTree } from './helpers/revert-mocks'
import { gotoViewer } from './helpers/viewer'

/**
 * E2E tests for the docked person drawer structure (issue #199).
 *
 * Verifies:
 *   1. AC1: at >=640px the drawer is docked at 360px wide, with a 1px left
 *      border and no shadow or blur — not the floating glass panel it
 *      replaced.
 *   2. AC5: relationship rows are >=44px tall and re-root the tree when
 *      tapped in view mode.
 *   3. AC6: the toolbar stays fully within the viewport at 1010px with the
 *      drawer open — the #190 regression this task's research named as its
 *      top risk from widening the drawer 320->360px.
 */

const LAYOUT_TOLERANCE_PX = 4

/**
 * Splits a computed `box-shadow` value into its comma-separated shadow
 * layers, splitting only on commas outside of parentheses so a layer's
 * `rgba(r, g, b, a)` color isn't mistaken for a layer boundary.
 */
function splitShadowLayers(boxShadow: string): string[] {
  const layers: string[] = []
  let depth = 0
  let current = ''
  for (const char of boxShadow) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) {
      layers.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) layers.push(current.trim())
  return layers
}

/**
 * Extracts a shadow layer's alpha channel. Layers whose color has no alpha
 * component (e.g. `rgb(...)`, a named color, or no parseable color at all)
 * are treated as fully opaque/non-transparent.
 */
function shadowLayerAlpha(layer: string): number {
  const match = layer.match(/rgba?\(([^)]+)\)/)
  if (!match) return 1
  const parts = match[1].split(',').map((part) => parseFloat(part.trim()))
  return parts.length === 4 ? parts[3] : 1
}

/**
 * True when a computed `box-shadow` value renders nothing visible — either
 * the literal `none`, or every layer's color is fully transparent (alpha 0).
 * Some browsers/CSS resets compute an explicit `rgba(0, 0, 0, 0) 0px 0px
 * 0px 0px` instead of `none`, so asserting the literal string is fragile.
 */
function isBoxShadowFullyTransparent(boxShadow: string): boolean {
  if (boxShadow.trim() === '' || boxShadow.trim() === 'none') return true
  return splitShadowLayers(boxShadow).every((layer) => shadowLayerAlpha(layer) === 0)
}

/** Root person with a parent so the Parents section renders a relative-row. */
const mockPerson = {
  gedcomId: '@IROOT@',
  name: 'Root Test',
  sex: 'F',
  birthYear: '1900',
  deathYear: null,
  birthPlace: 'London, England',
}

const mockParent = {
  gedcomId: '@IPARENT@',
  name: 'Parent Test',
  sex: 'M',
  birthYear: '1870',
  deathYear: null,
  birthPlace: null,
}

const mockPersonDetail = {
  ...mockPerson,
  deathPlace: null,
  occupation: null,
  notes: null,
  parents: [mockParent],
  siblings: [],
  marriages: [],
}

const mockTreeResponse = {
  nodes: [
    {
      id: 'node-@IROOT@',
      type: 'person',
      data: { ...mockPerson, deathPlace: null, occupation: null, notes: null, isRoot: true, generation: 0 },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
}

/**
 * Realistic-scale root person and tree, matching the fixture
 * `tests/e2e/mobile-responsive.spec.ts` uses for its #190 toolbar-width
 * regression test — a short single-person fixture doesn't reproduce the
 * intrinsic toolbar width that clips at 1010px.
 */
const mockRealisticRootPerson = {
  gedcomId: '@IREALISTIC@',
  name: 'Margaret Elizabeth Whitfield-Harrington',
  sex: 'F',
  birthYear: '1900',
  deathYear: null,
  birthPlace: 'London, England',
}

function buildRealisticTreeResponse() {
  const PERSON_COUNT = 342
  const nodes = [
    {
      id: `node-${mockRealisticRootPerson.gedcomId}`,
      type: 'person',
      data: { ...mockRealisticRootPerson, deathPlace: null, occupation: null, notes: null, isRoot: true, generation: 0 },
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
  return { nodes, edges: [], truncated: true, totalNodes: 812 }
}

/** Mocks the person detail endpoint and opens the drawer for the root node. */
async function openDrawer(page: Page, detail: unknown) {
  await page.route(/\/api\/person\//, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) })
  )

  await gotoViewer(page, mockPerson.gedcomId)
  await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

  const personNode = page.locator('.react-flow__node-person').first()
  await expect(personNode).toBeVisible({ timeout: 10_000 })
  await personNode.click()

  const drawer = page.getByTestId('person-drawer')
  await expect(drawer).toBeVisible()
  return drawer
}

test.describe('desktop drawer structure', () => {
  test('docks the drawer at 360px with a 1px left border and no shadow or blur', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await mockSignedInSession(page)
    await mockPersonsAndTree(page, [mockPerson], mockTreeResponse)
    const drawer = await openDrawer(page, mockPersonDetail)

    const box = await drawer.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeCloseTo(360, 0)

    const style = await drawer.evaluate((el) => {
      const computed = window.getComputedStyle(el)
      return {
        borderLeftWidth: computed.borderLeftWidth,
        borderTopWidth: computed.borderTopWidth,
        boxShadow: computed.boxShadow,
        backdropFilter: computed.backdropFilter || computed.getPropertyValue('-webkit-backdrop-filter'),
      }
    })
    expect(style.borderLeftWidth).toBe('1px')
    expect(style.borderTopWidth).toBe('0px')
    expect(isBoxShadowFullyTransparent(style.boxShadow)).toBe(true)
    expect(style.backdropFilter === 'none' || style.backdropFilter === '').toBe(true)
  })

  test('relationship rows are at least 44px tall and re-root the tree on tap', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await mockSignedInSession(page)
    await mockPersonsAndTree(page, [mockPerson], mockTreeResponse)
    const drawer = await openDrawer(page, mockPersonDetail)

    const relativeRow = drawer.getByTestId('relative-row').first()
    await expect(relativeRow).toBeVisible()
    await expect(relativeRow).toContainText('Parent Test')

    const rowBox = await relativeRow.boundingBox()
    expect(rowBox).not.toBeNull()
    expect(rowBox!.height).toBeGreaterThanOrEqual(44)

    const toolbarViewing = page.getByTestId('toolbar-viewing')
    await expect(toolbarViewing).toContainText('Root Test')

    await relativeRow.click()

    // Tapping a relationship row re-roots the tree and closes the drawer,
    // same as the dedicated "FOCUS TREE ON ..." button.
    await expect(drawer).not.toBeVisible({ timeout: 5_000 })
    await expect(toolbarViewing).not.toContainText('Root Test', { timeout: 10_000 })
  })
})

test.describe('desktop toolbar with drawer open', () => {
  test('toolbar stays fully within the viewport at 1010px with the drawer open (#190)', async ({ page }) => {
    await mockPersonsAndTree(page, [mockRealisticRootPerson], buildRealisticTreeResponse())
    await page.route(/\/api\/person\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...mockRealisticRootPerson,
          deathPlace: null,
          occupation: null,
          notes: null,
          parents: [],
          siblings: [],
          marriages: [],
        }),
      })
    )

    await page.setViewportSize({ width: 1010, height: 780 })
    await gotoViewer(page, mockRealisticRootPerson.gedcomId)

    const toolbar = page.getByTestId('toolbar')
    await expect(toolbar).toBeVisible({ timeout: 15_000 })

    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()

    const toolbarBox = await toolbar.boundingBox()
    expect(toolbarBox).not.toBeNull()
    expect(toolbarBox!.x).toBeGreaterThanOrEqual(0)
    expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(1010 + LAYOUT_TOLERANCE_PX)
  })
})
