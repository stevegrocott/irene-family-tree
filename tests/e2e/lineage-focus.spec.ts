import { test, expect, type Page } from '@playwright/test'
import { mockPersonsAndTree } from './helpers/revert-mocks'

/**
 * E2E coverage for issue #210, task 1 — the Playwright spec that #195 (PR #208)
 * shipped dimming for but never delivered a browser-level test for.
 *
 * #195 wired `computeLineage` (unit-tested in src/lib/lineage.test.ts, which
 * covers *which ids* belong to a lineage) into `FamilyTree.tsx`'s node/edge
 * rendering, so hovering a person visually dims everyone off that person's
 * line. Nothing previously failed if that wiring broke — only the pure
 * traversal was guarded. This spec exercises the real rendered opacity/stroke
 * so a regression in the wiring itself (not the traversal) fails a test.
 *
 * AC1: hovering a person sets off-lineage node opacity to `--ft-node-dim`,
 *      while ancestors, descendants, and spouses-at-unions stay fully lit.
 * AC2: in-lineage edges are visually promoted (`--ft-edge-strong` stroke)
 *      relative to off-lineage edges, which dim the same as off-lineage nodes.
 * AC5: the fixture spans at least three generations and includes a node (in
 *      fact, a whole branch) that is genuinely off-lineage from the focus
 *      person and demonstrably lit *before* any hover — a single-person
 *      fixture would pass this vacuously.
 *
 * Selection stickiness and clear-on-mouse-out (AC3/AC4) are covered by task 2
 * of #210, not here.
 */

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

const FOCUS = 'node-@IFOCUS@'
const DAD = 'node-@IDAD@'
const MOM = 'node-@IMOM@'
const GRANDPA = 'node-@IGRANDPA@'
const GRANDMA = 'node-@IGRANDMA@'
const SPOUSE = 'node-@ISPOUSE@'
const CHILD = 'node-@ICHILD@'
const UNCLE = 'node-@IUNCLE@'
const AUNT = 'node-@IAUNT@'
const COUSIN = 'node-@ICOUSIN@'

const U_GRANDPARENTS = 'node-@UGRANDPARENTS@' // Grandpa + Grandma -> Dad, Uncle
const U_PARENTS = 'node-@UPARENTS@' // Dad + Mom -> Focus
const U_UNCLE = 'node-@UUNCLE@' // Uncle + Aunt -> Cousin (entirely off-lineage)
const U_FOCUS = 'node-@UFOCUS@' // Focus + Spouse -> Child

/** Root is listed first so it becomes the default root (no `@I85@` in this fixture). */
const mockPersons = [
  person('@IFOCUS@', 'Faith Lineage', 'F', '1975'),
  person('@IDAD@', 'Daniel Lineage', 'M', '1948'),
  person('@IMOM@', 'Marge Lineage', 'F', '1950'),
  person('@IGRANDPA@', 'Gus Lineage', 'M', '1920'),
  person('@IGRANDMA@', 'Greta Lineage', 'F', '1922'),
  person('@ISPOUSE@', 'Sam Lineage', 'M', '1974'),
  person('@ICHILD@', 'Cora Lineage', 'F', '2000'),
  person('@IUNCLE@', 'Ulysses Lineage', 'M', '1946'),
  person('@IAUNT@', 'Agnes Lineage', 'F', '1949'),
  person('@ICOUSIN@', 'Cody Lineage', 'M', '1972'),
]

function personNode(id: string, gedcomId: string, generation: number, x: number, y: number) {
  const record = mockPersons.find(p => p.gedcomId === gedcomId)!
  return {
    id,
    type: 'person',
    data: { ...record, isRoot: gedcomId === '@IFOCUS@', generation },
    position: { x, y },
  }
}

function unionNode(id: string, gedcomId: string, x: number, y: number) {
  return { id, type: 'union', data: { gedcomId, marriageYear: null }, position: { x, y } }
}

/**
 * Four generations, with a whole off-lineage branch (Uncle + Aunt + Cousin)
 * hanging off the focus person's own grandparents — a sibling of Dad's, not
 * an ancestor or descendant of Focus, so `computeLineage` must exclude the
 * entire branch (mirrors the "excludes siblings" case in lineage.test.ts).
 *
 *     Gus ─┬─ Greta                              (union @UGRANDPARENTS@)
 *     Daniel ─────── Ulysses                     (children, generation -1)
 *       │                │
 *       ├─ Marge         ├─ Agnes                (unions)
 *       │                │
 *     Faith ★           Cody                     (children, generation 0)
 *       │
 *       ├─ Sam                                   (union @UFOCUS@)
 *       │
 *     Cora                                       (child, generation 1)
 *
 * Faith (★, the hover/focus target) is on the line through Daniel/Marge/Gus/
 * Greta (ancestors) and Sam/Cora (spouse-at-union + descendant). Ulysses,
 * Agnes, Cody and their connecting union are off-lineage from Faith.
 */
const mockTreeResponse = {
  nodes: [
    personNode(GRANDPA, '@IGRANDPA@', -2, 0, 0),
    personNode(GRANDMA, '@IGRANDMA@', -2, 300, 0),
    unionNode(U_GRANDPARENTS, '@UGRANDPARENTS@', 150, 100),
    personNode(DAD, '@IDAD@', -1, 0, 200),
    personNode(UNCLE, '@IUNCLE@', -1, 600, 200),
    personNode(MOM, '@IMOM@', -1, 300, 200),
    personNode(AUNT, '@IAUNT@', -1, 900, 200),
    unionNode(U_PARENTS, '@UPARENTS@', 150, 300),
    unionNode(U_UNCLE, '@UUNCLE@', 750, 300),
    personNode(FOCUS, '@IFOCUS@', 0, 150, 400),
    personNode(COUSIN, '@ICOUSIN@', 0, 750, 400),
    personNode(SPOUSE, '@ISPOUSE@', 0, 450, 400),
    unionNode(U_FOCUS, '@UFOCUS@', 300, 500),
    personNode(CHILD, '@ICHILD@', 1, 300, 600),
  ],
  edges: [
    { id: 'e-gp-union', source: GRANDPA, target: U_GRANDPARENTS, label: 'UNION' },
    { id: 'e-gm-union', source: GRANDMA, target: U_GRANDPARENTS, label: 'UNION' },
    { id: 'e-dad-child', source: U_GRANDPARENTS, target: DAD, label: 'CHILD' },
    { id: 'e-uncle-child', source: U_GRANDPARENTS, target: UNCLE, label: 'CHILD' },
    { id: 'e-dad-union', source: DAD, target: U_PARENTS, label: 'UNION' },
    { id: 'e-mom-union', source: MOM, target: U_PARENTS, label: 'UNION' },
    { id: 'e-focus-child', source: U_PARENTS, target: FOCUS, label: 'CHILD' },
    { id: 'e-uncle-union', source: UNCLE, target: U_UNCLE, label: 'UNION' },
    { id: 'e-aunt-union', source: AUNT, target: U_UNCLE, label: 'UNION' },
    { id: 'e-cousin-child', source: U_UNCLE, target: COUSIN, label: 'CHILD' },
    { id: 'e-focus-union', source: FOCUS, target: U_FOCUS, label: 'UNION' },
    { id: 'e-spouse-union', source: SPOUSE, target: U_FOCUS, label: 'UNION' },
    { id: 'e-child-child', source: U_FOCUS, target: CHILD, label: 'CHILD' },
  ],
}

/** Every node id in the focus person's lineage: ancestors, descendants, and spouses-at-unions. */
const IN_LINEAGE_IDS = [FOCUS, DAD, MOM, GRANDPA, GRANDMA, SPOUSE, CHILD, U_GRANDPARENTS, U_PARENTS, U_FOCUS]
/** The deliberately off-lineage branch: Dad's sibling, that sibling's spouse and child, and their union. */
const OFF_LINEAGE_IDS = [UNCLE, AUNT, COUSIN, U_UNCLE]

/** Computed `opacity` of a rendered ReactFlow node, by its `data-id`. */
async function readNodeOpacities(page: Page, ids: string[]): Promise<Record<string, number>> {
  return page.evaluate(nodeIds => {
    const out: Record<string, number> = {}
    for (const id of nodeIds) {
      const el = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
      out[id] = el ? parseFloat(getComputedStyle(el).opacity) : NaN
    }
    return out
  }, ids)
}

/** Computed `opacity`/`stroke` of a rendered ReactFlow edge's path, found via its React-Flow-stamped aria-label. */
async function readEdgeStyle(page: Page, source: string, target: string): Promise<{ opacity: number; stroke: string }> {
  return page.evaluate(({ source, target }) => {
    const edge = Array.from(document.querySelectorAll<SVGGElement>('.react-flow__edge')).find(
      el => el.getAttribute('aria-label') === `Edge from ${source} to ${target}`
    )
    const path = edge?.querySelector<SVGPathElement>('.react-flow__edge-path')
    if (!path) return { opacity: NaN, stroke: '' }
    const computed = getComputedStyle(path)
    return { opacity: parseFloat(computed.opacity), stroke: computed.stroke }
  }, { source, target })
}

/** Resolved colour of a CSS custom property, normalised to whatever format the browser reports for `color`. */
async function resolveColorVar(page: Page, varName: string): Promise<string> {
  return page.evaluate(name => {
    const probe = document.createElement('div')
    probe.style.color = `var(${name})`
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, varName)
}

test.describe('lineage focus on hover (issue #210)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('family-tree-root-id')
    })
    await mockPersonsAndTree(page, mockPersons, mockTreeResponse)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('toolbar-viewing')).toContainText('Faith', { timeout: 15_000 })
    await expect(page.locator('.react-flow__node-person')).toHaveCount(mockPersons.length, { timeout: 15_000 })
  })

  test('AC5: off-lineage branch renders fully lit before any hover', async ({ page }) => {
    const opacities = await readNodeOpacities(page, [...IN_LINEAGE_IDS, ...OFF_LINEAGE_IDS])
    for (const id of [...IN_LINEAGE_IDS, ...OFF_LINEAGE_IDS]) {
      expect(opacities[id], `${id} should render fully lit before any focus is active`).toBeCloseTo(1, 2)
    }
  })

  test('AC1/AC2: hovering the focus person dims the off-lineage branch while ancestors, descendants, spouse and in-lineage edges stay lit and promoted', async ({ page }) => {
    const dimValue = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ft-node-dim'))
    )
    expect(dimValue).toBeGreaterThan(0)
    expect(dimValue).toBeLessThan(1)

    const strongStroke = await resolveColorVar(page, '--ft-edge-strong')
    const restingStroke = await resolveColorVar(page, '--ft-edge')
    expect(strongStroke).not.toBe(restingStroke)

    // Hover the focus person's own card — a real pointer move, exactly like a
    // visitor scanning the tree.
    await page.locator(`.react-flow__node[data-id="${FOCUS}"]`).hover()

    // The dim/undim transition is LINEAGE_DIM_TRANSITION_MS (180ms) —
    // poll for the settled value instead of racing a single read.
    await expect(async () => {
      const opacities = await readNodeOpacities(page, [...IN_LINEAGE_IDS, ...OFF_LINEAGE_IDS])
      for (const id of OFF_LINEAGE_IDS) {
        expect(opacities[id], `${id} should dim to --ft-node-dim once Faith is focused`).toBeCloseTo(dimValue, 2)
      }
      for (const id of IN_LINEAGE_IDS) {
        expect(opacities[id], `${id} is on Faith's line and must stay fully lit`).toBeCloseTo(1, 2)
      }
    }).toPass({ timeout: 5_000 })

    // AC2: an edge fully inside the lineage (Faith's own birth union -> Faith)
    // promotes to the strong stroke and is not dimmed...
    const litEdge = await readEdgeStyle(page, U_PARENTS, FOCUS)
    expect(litEdge.opacity).toBeCloseTo(1, 2)
    expect(litEdge.stroke).toBe(strongStroke)

    // ...an edge entirely off the line (Uncle+Aunt's union -> Cousin) dims...
    const offEdge = await readEdgeStyle(page, U_UNCLE, COUSIN)
    expect(offEdge.opacity).toBeCloseTo(dimValue, 2)
    expect(offEdge.stroke).not.toBe(strongStroke)

    // ...and even an edge whose union *is* on the line (the grandparents')
    // dims when it leads to the off-lineage sibling (Uncle) rather than the
    // ancestor (Dad) — the wiring must dim per-edge, not per-node.
    const branchOffshoot = await readEdgeStyle(page, U_GRANDPARENTS, UNCLE)
    expect(branchOffshoot.opacity).toBeCloseTo(dimValue, 2)

    const ancestorEdge = await readEdgeStyle(page, U_GRANDPARENTS, DAD)
    expect(ancestorEdge.opacity).toBeCloseTo(1, 2)
    expect(ancestorEdge.stroke).toBe(strongStroke)
  })
})
