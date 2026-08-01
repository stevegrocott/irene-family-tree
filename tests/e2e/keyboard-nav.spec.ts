import { test, expect, type Page } from '@playwright/test'
import { mockPersonsAndTree } from './helpers/revert-mocks'

/**
 * E2E tests for keyboard navigation of the family tree canvas (issue #201,
 * design system §7). Task 5 of the issue: "Tab reaches a node, arrows navigate
 * relatives, and focus stays visible and on-screen."
 *
 * These cover the acceptance criteria that only hold up in a real, laid-out
 * browser canvas — the pure resolution logic is unit-tested in
 * src/lib/keyboardNav.test.ts:
 *
 *   AC1 — Tab reaches a person node, which paints a visible focus ring, and
 *         each node is exactly one tab stop. ReactFlow makes its own
 *         `.react-flow__node` wrapper focusable by default, which would give
 *         every node two consecutive stops; `nodesFocusable={false}` on the
 *         canvas is what keeps it to one, and this spec is what catches a
 *         regression of that.
 *   AC2 — ArrowUp/ArrowDown move to a parent/child, ArrowLeft/ArrowRight move
 *         between siblings in on-screen order.
 *   AC3 — After an arrow move the newly focused node is scrolled fully into
 *         view, even when it started off-screen at a high zoom level.
 *   AC4 — Arrow keys pressed while focus is on the pane rather than a node are
 *         left untouched, so ReactFlow's own pane bindings keep working.
 *
 * The graph is mocked rather than read from Neo4j so the relationships under
 * test are exact: two parents joined by a union, three siblings below them, and
 * a grandchild below the middle sibling.
 */

const FATHER = 'node-@IFATHER@'
const MOTHER = 'node-@IMOTHER@'
const ALICE = 'node-@IALICE@'
const BOB = 'node-@IBOB@'
const CARA = 'node-@ICARA@'
const SPOUSE = 'node-@ISPOUSE@'
const DANA = 'node-@IDANA@'

const SIBLINGS = [ALICE, BOB, CARA]
const PARENTS = [FATHER, MOTHER]

function person(gedcomId: string, name: string, sex: string, birthYear: string) {
  return {
    gedcomId,
    name,
    sex,
    birthYear,
    deathYear: null,
    birthPlace: null,
    deathPlace: null,
    occupation: null,
    notes: null,
  }
}

/** Root is listed first so it becomes the default root (no `@I85@` in this fixture). */
const mockPersons = [
  person('@IBOB@', 'Bob Keyboard', 'M', '1950'),
  person('@IFATHER@', 'Frank Keyboard', 'M', '1920'),
  person('@IMOTHER@', 'Mary Keyboard', 'F', '1922'),
  person('@IALICE@', 'Alice Keyboard', 'F', '1948'),
  person('@ICARA@', 'Cara Keyboard', 'F', '1953'),
  person('@ISPOUSE@', 'Sam Keyboard', 'M', '1951'),
  person('@IDANA@', 'Dana Keyboard', 'F', '1975'),
]

function personNode(id: string, gedcomId: string, generation: number, x: number, y: number) {
  const record = mockPersons.find(p => p.gedcomId === gedcomId)!
  return {
    id,
    type: 'person',
    data: { ...record, isRoot: gedcomId === '@IBOB@', generation },
    position: { x, y },
  }
}

function unionNode(id: string, gedcomId: string, x: number, y: number) {
  return { id, type: 'union', data: { gedcomId, marriageYear: null }, position: { x, y } }
}

/**
 * Three generations with an unambiguous relative in every arrow direction:
 *
 *     Frank ─┬─ Mary            (union @F1@)
 *     Alice ─ Bob ─ Cara        (children of @F1@)
 *            Bob ─┬─ Sam        (union @F2@)
 *               Dana            (child of @F2@)
 */
const mockTreeResponse = {
  nodes: [
    personNode(FATHER, '@IFATHER@', -1, 0, 0),
    personNode(MOTHER, '@IMOTHER@', -1, 300, 0),
    unionNode('node-@F1@', '@F1@', 150, 100),
    personNode(ALICE, '@IALICE@', 0, 0, 200),
    personNode(BOB, '@IBOB@', 0, 300, 200),
    personNode(CARA, '@ICARA@', 0, 600, 200),
    personNode(SPOUSE, '@ISPOUSE@', 0, 900, 200),
    unionNode('node-@F2@', '@F2@', 450, 300),
    personNode(DANA, '@IDANA@', 1, 450, 400),
  ],
  edges: [
    { id: 'e1', source: FATHER, target: 'node-@F1@', label: 'UNION' },
    { id: 'e2', source: MOTHER, target: 'node-@F1@', label: 'UNION' },
    { id: 'e3', source: 'node-@F1@', target: ALICE, label: 'CHILD' },
    { id: 'e4', source: 'node-@F1@', target: BOB, label: 'CHILD' },
    { id: 'e5', source: 'node-@F1@', target: CARA, label: 'CHILD' },
    { id: 'e6', source: BOB, target: 'node-@F2@', label: 'UNION' },
    { id: 'e7', source: SPOUSE, target: 'node-@F2@', label: 'UNION' },
    { id: 'e8', source: 'node-@F2@', target: DANA, label: 'CHILD' },
  ],
}

type NodeBox = { id: string; x: number; y: number; width: number; height: number }

/** Bounding boxes of every rendered person node, in viewport coordinates. */
async function readPersonNodes(page: Page): Promise<Map<string, NodeBox>> {
  const nodes = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node-person'))
      .map(el => {
        const r = el.getBoundingClientRect()
        return {
          id: el.getAttribute('data-id') ?? '',
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        }
      })
      .filter(n => n.id !== '')
  )
  return new Map(nodes.map(n => [n.id, n]))
}

/** The `data-id` of the person node containing the active element, if any. */
async function focusedNodeId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
  })
}

/** Moves focus onto a node's inner focusable element without clicking it. */
async function focusNode(page: Page, id: string): Promise<void> {
  await page.evaluate(nodeId => {
    document
      .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"] [role="button"]`)
      ?.focus()
  }, id)
  expect(await focusedNodeId(page)).toBe(id)
}

test.describe('keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('family-tree-root-id')
    })
    await mockPersonsAndTree(page, mockPersons, mockTreeResponse)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.react-flow__node-person')).toHaveCount(7, { timeout: 15_000 })
  })

  test('AC1: Tab reaches a person node with a visible focus ring, one stop per node', async ({
    page,
  }) => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

    // Walk the tab order until focus lands inside a person node. The bound is
    // generous enough for the toolbar/search controls that precede the canvas,
    // but finite so a broken tab order fails rather than hangs.
    let firstNodeId: string | null = null
    for (let i = 0; i < 60 && firstNodeId === null; i++) {
      await page.keyboard.press('Tab')
      firstNodeId = await focusedNodeId(page)
    }
    expect(firstNodeId, 'Tab should eventually reach a person node').not.toBeNull()

    // The focus target must be the node's own ringed element, not the wrapper
    // ReactFlow puts around every custom node — if the wrapper is focusable too,
    // each node becomes two consecutive tab stops with no ring on the first.
    const activeRole = await page.evaluate(() =>
      (document.activeElement as HTMLElement).getAttribute('role')
    )
    expect(activeRole, 'Tab should land on the node itself, not its wrapper').toBe('button')

    // AC1: the focused node paints the `--ft-focus` ring. Measured against an
    // unfocused node of the same LOD variant, so the assertion fails if the ring
    // is dropped even though that variant's resting shadow remains. Reaching the
    // node with a real Tab press means `:focus-visible` applies.
    const peerShadow = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement
      const testId = active.getAttribute('data-testid')
      const peer = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)
      ).find(el => el !== active)
      return peer ? getComputedStyle(peer).boxShadow : null
    })
    expect(peerShadow, 'need an unfocused peer node as the baseline').not.toBeNull()

    // Nodes carry `transition-[box-shadow] duration-150`, so the computed value
    // is still the resting shadow for a frame or two after focus lands — poll
    // until the ring has actually been painted rather than sampling mid-fade.
    const focusedShadow = () =>
      page.evaluate(() => getComputedStyle(document.activeElement as HTMLElement).boxShadow)
    await expect.poll(focusedShadow, { timeout: 5_000 }).not.toBe(peerShadow)
    expect(await focusedShadow()).not.toBe('none')

    // AC1: exactly one tab stop per node. ReactFlow makes `.react-flow__node`
    // focusable by default, which would produce a second consecutive stop on
    // the same `data-id`; the next Tab must therefore leave this node.
    await page.keyboard.press('Tab')
    expect(await focusedNodeId(page), 'a node must not expose two consecutive tab stops').not.toBe(
      firstNodeId
    )
  })

  test('AC2: ArrowUp moves to a parent and ArrowDown moves to a child', async ({ page }) => {
    await focusNode(page, BOB)

    // ArrowUp — Bob's birth union has two parents; focus goes to whichever sits
    // nearest his x-position, and either is a generation above him.
    await page.keyboard.press('ArrowUp')
    const parentId = await focusedNodeId(page)
    expect(PARENTS).toContain(parentId)

    const afterUp = await readPersonNodes(page)
    expect(afterUp.get(parentId!)!.y).toBeLessThan(afterUp.get(BOB)!.y)

    // ArrowDown from a parent moves back down to one of that union's children.
    await page.keyboard.press('ArrowDown')
    const childId = await focusedNodeId(page)
    expect(SIBLINGS).toContain(childId)

    const afterDown = await readPersonNodes(page)
    expect(afterDown.get(childId!)!.y).toBeGreaterThan(afterDown.get(parentId!)!.y)

    // ArrowDown from Bob resolves through his own union to his only child.
    await focusNode(page, BOB)
    await page.keyboard.press('ArrowDown')
    expect(await focusedNodeId(page)).toBe(DANA)

    // Dana is the deepest node — ArrowDown has nowhere to go and focus stays put.
    await page.keyboard.press('ArrowDown')
    expect(await focusedNodeId(page)).toBe(DANA)
  })

  test('AC2: ArrowRight/ArrowLeft move between siblings in on-screen order', async ({ page }) => {
    // Siblings are ordered by rendered x-position, which the dagre layout owns —
    // read it rather than assuming the fixture's declaration order survives.
    const boxes = await readPersonNodes(page)
    const ordered = [...SIBLINGS].sort((a, b) => boxes.get(a)!.x - boxes.get(b)!.x)
    const [left, middle, right] = ordered

    await focusNode(page, left)
    await page.keyboard.press('ArrowRight')
    expect(await focusedNodeId(page)).toBe(middle)

    await page.keyboard.press('ArrowRight')
    expect(await focusedNodeId(page)).toBe(right)

    // The rightmost sibling has no next sibling — focus stays put rather than wrapping.
    await page.keyboard.press('ArrowRight')
    expect(await focusedNodeId(page)).toBe(right)

    // Siblings share a generation row.
    const afterRight = await readPersonNodes(page)
    expect(Math.abs(afterRight.get(right)!.y - afterRight.get(left)!.y)).toBeLessThanOrEqual(10)

    // ArrowLeft is the inverse, walking back to where we started.
    await page.keyboard.press('ArrowLeft')
    expect(await focusedNodeId(page)).toBe(middle)
    await page.keyboard.press('ArrowLeft')
    expect(await focusedNodeId(page)).toBe(left)
    await page.keyboard.press('ArrowLeft')
    expect(await focusedNodeId(page)).toBe(left)
  })

  test('AC3: arrow navigation keeps the focused node fully on-screen', async ({ page }) => {
    // Zoom in so the visible slice of the canvas is small and arrow targets
    // start outside it — that is what makes the assertion bite.
    const canvas = page.locator('.react-flow')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2)
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -240)
    }

    await focusNode(page, DANA)

    const keys = ['ArrowUp', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'] as const
    let moves = 0
    for (const key of keys) {
      const before = await focusedNodeId(page)
      await page.keyboard.press(key)
      const after = await focusedNodeId(page)
      if (after === null || after === before) continue
      moves++

      // AC3: the viewport must be nudged so the new node ends up fully inside
      // the canvas — not clipped at an edge or left scrolled past entirely.
      // `setViewport` animates over 200ms, so retry until the pan settles.
      await expect(async () => {
        const box = await page.locator(`.react-flow__node[data-id="${after}"]`).boundingBox()
        const viewport = await canvas.boundingBox()
        expect(box, `focused node ${after} should be rendered`).not.toBeNull()
        expect(viewport).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(viewport!.x - 1)
        expect(box!.y).toBeGreaterThanOrEqual(viewport!.y - 1)
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.x + viewport!.width + 1)
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height + 1)
      }).toPass({ timeout: 5_000 })
    }

    expect(moves, 'arrow presses should have moved focus while zoomed in').toBeGreaterThan(0)
  })

  test('AC4: arrow keys on the pane do not steal focus into a node', async ({ page }) => {
    const pane = page.locator('.react-flow__pane')
    const paneBox = await pane.boundingBox()
    expect(paneBox).not.toBeNull()

    // Click a bottom corner of the pane, away from the laid-out nodes, so focus
    // sits on the canvas rather than on a person node.
    await page.mouse.click(paneBox!.x + 8, paneBox!.y + paneBox!.height - 8)
    expect(await focusedNodeId(page)).toBeNull()

    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      await page.keyboard.press(key)
      // The node-navigation handler must stay out of the way: no node grabs
      // focus, leaving ReactFlow's own pane bindings intact.
      expect(await focusedNodeId(page)).toBeNull()
    }
  })
})
