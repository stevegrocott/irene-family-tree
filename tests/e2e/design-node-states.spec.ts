import { test, expect, type Page } from '@playwright/test'
import { mockPersonsAndTree } from './helpers/revert-mocks'
import { resolved } from './helpers/design-tokens'
import { gotoViewer } from './helpers/viewer'

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
 * These fixtures hold one or two nodes, so `FamilyTree`'s fit-to-bounds pass
 * clamps at its max zoom of 2 — comfortably past §3.2's 0.85 `full` threshold.
 * No zoom gesture is needed or wanted here; zoom-driven LOD switching is
 * `node-lod.spec.ts`'s subject.
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

/** The node rendered at the `full` level of detail. */
const fullNode = (page: Page) => page.getByTestId('person-node-full').first()

/** Serves a single-person tree and opens the viewer on it. */
async function mockCanvas(page: Page, overrides: Record<string, unknown> = {}) {
  const person = { ...BASE, ...overrides }

  await mockPersonsAndTree(page, [person], {
    nodes: [
      {
        id: 'node-@I1@',
        type: 'person',
        data: { isRoot: true, ...person },
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    totalNodes: 1,
    truncated: false,
  })

  await gotoViewer(page, BASE.gedcomId)
}

/**
 * Serves a root person plus a parent one rank above, so the layout pass derives
 * a real non-zero generation for the parent.
 */
async function mockTwoGenerations(page: Page) {
  const child = { ...BASE }
  const parent = { ...BASE, gedcomId: '@I2@', name: 'Albert Gullett', sex: 'M', birthYear: '1870', deathYear: '1940' }

  await mockPersonsAndTree(page, [child, parent], {
    nodes: [
      { id: 'node-@I1@', type: 'person', data: { ...child, isRoot: true }, position: { x: 0, y: 200 } },
      { id: 'node-@I2@', type: 'person', data: { ...parent, isRoot: false }, position: { x: 0, y: 0 } },
    ],
    edges: [{ id: 'e-parent', source: 'node-@I2@', target: 'node-@I1@', label: 'CHILD' }],
    totalNodes: 2,
    truncated: false,
  })

  await gotoViewer(page, BASE.gedcomId)
}

test.describe('person node states — design system §3.2', () => {
  test('the root person carries a 2px brass border', async ({ page }) => {
    await mockCanvas(page)

    await expect(fullNode(page)).toHaveCSS('border-top-width', '2px')
    await expect(fullNode(page)).toHaveCSS('border-top-color', await resolved(page, 'var(--ft-brass)'))
  })

  test('the root person carries a brass home marker in the top-right corner', async ({ page }) => {
    await mockCanvas(page)

    // §3.2 Root: "2 px `--ft-brass` border + brass `⌂` marker top-right".
    // The border alone is not the whole treatment — the marker is what makes
    // "you are here" readable once the border colour is one of several.
    const markerColor = await fullNode(page).evaluate((el) => {
      const nodeBox = el.getBoundingClientRect()
      const marker = [...el.querySelectorAll('*')].find((child) => {
        if (!child.textContent?.includes('⌂')) return false
        const box = child.getBoundingClientRect()
        // Top-right quadrant of the node.
        return box.left > nodeBox.left + nodeBox.width / 2 && box.top < nodeBox.top + nodeBox.height / 2
      })
      return marker ? getComputedStyle(marker).color : null
    })

    expect(markerColor, 'no brass ⌂ marker in the root node’s top-right quadrant')
      .toBe(await resolved(page, 'var(--ft-brass)'))
  })

  test('a living person node uses the private-soft background', async ({ page }) => {
    await mockCanvas(page, { living: true, birthYear: null, deathYear: null })

    // §3.2 Living/private: "`--ft-private-soft` background, dates replaced by
    // `Living`". The dates half is covered by living-privacy.spec.ts; this
    // asserts the background half, which is what makes a redacted person
    // distinguishable at a glance rather than only on close reading.
    await expect(fullNode(page).getByText('Living', { exact: true })).toBeVisible()
    await expect(fullNode(page)).toHaveCSS(
      'background-color',
      await resolved(page, 'var(--ft-private-soft)')
    )
  })

  test('an unknown name renders as italic serif in the muted text token', async ({ page }) => {
    await mockCanvas(page, { name: '' })

    const unknown = fullNode(page).getByText('Unknown', { exact: true })
    await expect(unknown).toBeVisible()
    await expect(unknown).toHaveCSS('font-style', 'italic')
    await expect(unknown).toHaveCSS('color', await resolved(page, 'var(--ft-text-3)'))
    await expect(unknown).toHaveCSS('font-family', /serif/i)
  })

  test('hover changes border and elevation but never the node size', async ({ page }) => {
    await mockCanvas(page)
    const node = fullNode(page)

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

    // §3.2: "Has pending edit | 6 px violet dot, top-right,
    // `title="1 suggested edit awaiting review"`".
    const pending = await resolved(page, 'var(--ft-pending)')
    const dot = await fullNode(page).evaluate((el, expected) => {
      const match = [...el.querySelectorAll('*')].find(
        (child) => getComputedStyle(child).backgroundColor === expected
      )
      if (!match) return null
      const box = match.getBoundingClientRect()
      return {
        size: Math.round(Math.max(box.width, box.height)),
        title: match.getAttribute('title') ?? match.closest('[title]')?.getAttribute('title') ?? null,
      }
    }, pending)

    expect(dot, 'no element painted with the pending token').not.toBeNull()
    expect(dot!.size).toBe(6)
    expect(dot!.title).toMatch(/awaiting review/i)
  })

  test('a selected node renders a 2px accent border and accent-soft background', async ({ page }) => {
    // isRoot: false so this pins the Selected treatment in isolation, without
    // the Root row's brass border competing for the same edge (that
    // precedence is covered separately below).
    await mockCanvas(page, { isRoot: false })
    const node = fullNode(page)

    await node.click()

    // §3.2 Selected: "2 px `--ft-accent` border, `--ft-accent-soft` background".
    await expect(node).toHaveCSS('border-top-width', '2px')
    await expect(node).toHaveCSS('border-top-color', await resolved(page, 'var(--ft-accent)'))
    await expect(node).toHaveCSS('background-color', await resolved(page, 'var(--ft-accent-soft)'))
  })

  test('selecting a different node clears the previous node’s selected treatment', async ({ page }) => {
    const personA = { ...BASE }
    const personB = { ...BASE, gedcomId: '@I2@', name: 'Albert Gullett', sex: 'M', birthYear: '1870', deathYear: '1940' }

    await mockPersonsAndTree(page, [personA, personB], {
      nodes: [
        { id: 'node-@I1@', type: 'person', data: { ...personA, isRoot: false }, position: { x: 0, y: 0 } },
        { id: 'node-@I2@', type: 'person', data: { ...personB, isRoot: false }, position: { x: 300, y: 0 } },
      ],
      edges: [],
      totalNodes: 2,
      truncated: false,
    })
    await gotoViewer(page, BASE.gedcomId)

    const nodeA = page.getByTestId('rf__node-node-@I1@').getByTestId('person-node-full')
    const nodeB = page.getByTestId('rf__node-node-@I2@').getByTestId('person-node-full')
    const accent = await resolved(page, 'var(--ft-accent)')

    await nodeA.click()
    await expect(nodeA).toHaveCSS('border-top-color', accent)

    // AC3: selecting a second node must clear the first node's treatment —
    // the app derives selection from a single `selectedNodeId`, so only one
    // node should ever carry the accent border at a time.
    await nodeB.click()
    await expect(nodeB).toHaveCSS('border-top-color', accent)
    await expect(nodeA).not.toHaveCSS('border-top-color', accent)
  })

  test('a node that is both root and selected keeps its ⌂ marker visible', async ({ page }) => {
    // §3.2 Root and Selected both claim a border treatment; AC4 only requires
    // that the root marker — the "you are here" signal — survives the clash,
    // not which colour wins the border. `mockCanvas`'s default node isRoot: true.
    await mockCanvas(page)
    const node = fullNode(page)

    await node.click()
    await expect(node).toHaveCSS('background-color', await resolved(page, 'var(--ft-accent-soft)'))

    const marker = node.getByText('⌂')
    await expect(marker).toBeVisible()
    await expect(marker).toHaveCSS('color', await resolved(page, 'var(--ft-brass)'))
  })

  test('the avatar tint does not encode generation with off-palette colours', async ({ page }) => {
    // Two ranks, because `applyDagreLayout` derives the signed generation from
    // laid-out y-positions and overwrites whatever the payload claimed
    // (src/lib/layout.ts). A single-node fixture is always generation 0, which
    // would exercise the neutral branch and prove nothing.
    await mockTwoGenerations(page)

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
