import { test, expect, type Page } from '@playwright/test'
import { resolved, restPointer, zoomUntilVariantVisible } from './helpers/design-tokens'

/**
 * Design-conformance E2E for the person-node state treatments.
 *
 * Source of truth: `docs/DESIGN_SYSTEM.md` §3.2 (the States table), read with
 * §0 ("generation is encoded as a faint avatar tint … neither survives a
 * 400-person tree") and §1 ("colour carries meaning, never decoration";
 * "no glow shadows"; "no scale transforms on hover").
 *
 * The §3.2 States table specifies: Hover, Selected, Root, Off-lineage,
 * Has-pending-edit, Living/private, Unknown person, and keyboard Focus.
 * Hover, Off-lineage and Focus are already covered elsewhere
 * (`lineage-focus.spec.ts`, `keyboard-nav.spec.ts`); this file covers the
 * remaining rows plus the two palette rules above.
 *
 * Every assertion reads computed style rather than class names, so a move
 * between Tailwind utilities and plain CSS does not break the spec.
 *
 * Data: the API is mocked, as in every other spec here — the E2E dev server
 * has no Neo4j connection.
 */

/** Baseline person; each test overrides only the fields its state needs. */
const BASE = {
  gedcomId: '@I1@',
  name: 'Frances Gullett',
  sex: 'F',
  birthYear: '1901',
  deathYear: '1974',
  birthPlace: 'Ballarat, VIC',
  deathPlace: null,
  occupation: null,
  notes: null,
}

/**
 * Serves a single-person tree so fit-zoom stays high and one wheel gesture
 * reaches the `full` variant, where every §3.2 state treatment is visible.
 */
async function mockCanvas(page: Page, overrides: Record<string, unknown> = {}) {
  const person = { ...BASE, ...overrides }

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
            id: 'node-@I1@',
            type: 'person',
            data: { isRoot: true, generation: 0, ...person },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        totalNodes: 1,
        truncated: false,
      }),
    })
  )

  // The entry-vs-viewer branch takes `?root=` ahead of localStorage
  // (FamilyTree.tsx), and the storageState default seeds a root id that is not
  // in this fixture — so address the fixture person directly.
  await page.goto(`/?root=${encodeURIComponent(BASE.gedcomId)}`)
}

/**
 * Serves a root person plus a parent one rank above, so the layout pass derives
 * a real non-zero generation for the parent.
 */
async function mockTwoGenerations(page: Page) {
  const child = { ...BASE }
  const parent = { ...BASE, gedcomId: '@I2@', name: 'Albert Gullett', sex: 'M', birthYear: '1870', deathYear: '1940' }

  await page.route(/\/api\/persons/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([child, parent]),
    })
  )

  await page.route(/\/api\/tree\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        nodes: [
          { id: 'node-@I1@', type: 'person', data: { ...child, isRoot: true }, position: { x: 0, y: 200 } },
          { id: 'node-@I2@', type: 'person', data: { ...parent, isRoot: false }, position: { x: 0, y: 0 } },
        ],
        edges: [{ id: 'e-parent', source: 'node-@I2@', target: 'node-@I1@', label: 'CHILD' }],
        totalNodes: 2,
        truncated: false,
      }),
    })
  )

  await page.goto(`/?root=${encodeURIComponent(BASE.gedcomId)}`)
}

test.describe('person node states — design system §3.2', () => {
  // Each test loads the canvas and then steps zoom up to the `full` variant one
  // control click at a time, which costs ~8s on its own; the first test also
  // pays the dev server's cold compile of `/`. The default 30s leaves no
  // headroom for both.
  test.beforeEach(({}, testInfo) => {
    testInfo.setTimeout(90_000)
  })

  test('the root person carries a 2px brass border', async ({ page }) => {
    await mockCanvas(page)
    const node = await zoomUntilVariantVisible(page, 'person-node-full')

    await expect(node).toHaveCSS('border-top-width', '2px')
    await expect(node).toHaveCSS('border-top-color', await resolved(page, 'var(--ft-brass)'))
  })

  test('the root person carries a brass home marker in the top-right corner', async ({ page }) => {
    await mockCanvas(page)
    const node = await zoomUntilVariantVisible(page, 'person-node-full')

    // §3.2 Root: "2 px `--ft-brass` border + brass `⌂` marker top-right".
    // The border alone is not the whole treatment — the marker is what makes
    // "you are here" readable once the border colour is one of several.
    const brass = await resolved(page, 'var(--ft-brass)')
    const marker = await node.evaluate(
      (el, expected) => {
        const nodeBox = el.getBoundingClientRect()
        const found = [...el.querySelectorAll('*')].find((child) => {
          const text = child.textContent?.trim() ?? ''
          if (!text.includes('⌂')) return false
          const box = child.getBoundingClientRect()
          // Top-right quadrant of the node.
          return box.left > nodeBox.left + nodeBox.width / 2 && box.top < nodeBox.top + nodeBox.height / 2
        })
        if (!found) return { found: false as const }
        return { found: true as const, color: getComputedStyle(found).color, isBrass: getComputedStyle(found).color === expected }
      },
      brass
    )

    expect(marker.found, 'no ⌂ marker rendered on the root node').toBe(true)
    expect(marker.found && marker.isBrass, `marker colour was ${marker.found ? marker.color : 'n/a'}`).toBe(true)
  })

  test('a living person node uses the private-soft background', async ({ page }) => {
    await mockCanvas(page, { living: true, birthYear: null, deathYear: null })
    const node = await zoomUntilVariantVisible(page, 'person-node-full')

    // §3.2 Living/private: "`--ft-private-soft` background, dates replaced by
    // `Living`". The dates half is covered by living-privacy.spec.ts; this
    // asserts the background half, which is what makes a redacted person
    // distinguishable at a glance rather than only on close reading.
    await expect(node.getByText('Living', { exact: true })).toBeVisible()
    await expect(node).toHaveCSS('background-color', await resolved(page, 'var(--ft-private-soft)'))
  })

  test('an unknown name renders as italic serif in the muted text token', async ({ page }) => {
    await mockCanvas(page, { name: '' })
    const node = await zoomUntilVariantVisible(page, 'person-node-full')

    const unknown = node.getByText('Unknown', { exact: true })
    await expect(unknown).toBeVisible()
    await expect(unknown).toHaveCSS('font-style', 'italic')
    await expect(unknown).toHaveCSS('color', await resolved(page, 'var(--ft-text-3)'))
    await expect(unknown).toHaveCSS('font-family', /serif/i)
  })

  test('hover changes border and elevation but never the node size', async ({ page }) => {
    await mockCanvas(page)
    const node = await zoomUntilVariantVisible(page, 'person-node-full')

    // The zoom helper leaves the pointer on the node, so step away before
    // sampling the resting treatment.
    await restPointer(page)
    const before = await node.boundingBox()
    const restingShadow = await node.evaluate((el) => getComputedStyle(el).boxShadow)

    await node.hover()
    await expect(node).toHaveCSS('border-top-color', await resolved(page, 'var(--ft-border-strong)'))

    const after = await node.boundingBox()
    const hoverShadow = await node.evaluate((el) => getComputedStyle(el).boxShadow)

    // §1: "No scale transforms on hover. Nodes shift their border colour, not
    // their size — a graph where nodes grow under the cursor is unusable when
    // they are 30 px apart."
    expect(after!.width).toBeCloseTo(before!.width, 1)
    expect(after!.height).toBeCloseTo(before!.height, 1)
    expect(hoverShadow).not.toBe(restingShadow)
  })

  test('a person with a pending edit shows a pending-token dot with an explanatory title', async ({ page }) => {
    // Note: `PersonData` (src/types/tree.ts) carries no pending-edit field
    // today, so this drives the payload the design implies. The absence of the
    // channel is itself the gap §3.2 describes.
    await mockCanvas(page, { pendingEdits: 1 })
    const node = await zoomUntilVariantVisible(page, 'person-node-full')

    // §3.2: "Has pending edit | 6 px violet dot, top-right,
    // `title="1 suggested edit awaiting review"`".
    const pending = await resolved(page, 'var(--ft-pending)')
    const dot = await node.evaluate(
      (el, expected) => {
        const match = [...el.querySelectorAll('*')].find(
          (child) => getComputedStyle(child).backgroundColor === expected
        )
        if (!match) return { found: false as const }
        const box = match.getBoundingClientRect()
        return {
          found: true as const,
          width: box.width,
          height: box.height,
          title: match.getAttribute('title') ?? match.closest('[title]')?.getAttribute('title') ?? null,
        }
      },
      pending
    )

    expect(dot.found, 'no element painted with the pending token').toBe(true)
    expect(dot.found && dot.title).toMatch(/awaiting review/i)
  })

  test('the avatar tint does not encode generation with off-palette colours', async ({ page }) => {
    // Two ranks, because `applyDagreLayout` derives the signed generation from
    // laid-out y-positions and overwrites whatever the payload claimed
    // (src/lib/layout.ts). A single-node fixture is always generation 0, which
    // would exercise the neutral branch and prove nothing.
    await mockTwoGenerations(page)
    await zoomUntilVariantVisible(page, 'person-node-full')

    // §0 lists "generation is encoded as a faint avatar tint" as a defect being
    // fixed, and §1 restricts colour to the semantic set plus the two sex
    // tints. The initials avatar should therefore sit on a surface token
    // regardless of which generation the person belongs to.
    const parentAvatar = page
      .getByTestId('rf__node-node-@I2@')
      .getByText('AG', { exact: true })
    await expect(parentAvatar).toBeVisible()
    await expect(parentAvatar).toHaveCSS(
      'background-color',
      await resolved(page, 'var(--ft-surface-2)')
    )
  })
})
