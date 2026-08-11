import { Node, Edge } from 'reactflow'
import { applyDagreLayout, resolveRankXs, PERSON_W, UNION_W } from './layout'

/** Mirrors `NODE_GAP` in src/lib/layout.ts (and dagre's configured `nodesep`). */
const NODE_GAP = 30

/** Builds a minimal person node; only `gedcomId` is read by the layout code. */
function personNode(id: string, gedcomId: string): Node {
  return { id, type: 'person', data: { gedcomId }, position: { x: 0, y: 0 } }
}

function unionNode(id: string): Node {
  return { id, type: 'union', data: {}, position: { x: 0, y: 0 } }
}

/** CHILD edge in the API/contract orientation: union (source) → person (target). */
function childEdge(id: string, unionId: string, personId: string): Edge {
  return { id, source: unionId, target: personId, label: 'CHILD' }
}

/** UNION edge: person (source) → union (target). */
function unionEdge(id: string, personId: string, unionId: string): Edge {
  return { id, source: personId, target: unionId, label: 'UNION' }
}

/** Distinct rounded y-positions among person nodes in a layout result. */
function personYLevels(nodes: ReturnType<typeof applyDagreLayout>['nodes']) {
  return new Set(
    nodes.filter(n => n.type === 'person').map(n => Math.round(n.position.y / 10) * 10),
  )
}

/** Horizontal centre of a positioned node (position.x is its top-left corner). */
function centerX(node: { type?: string; position: { x: number } }) {
  const w = node.type === 'union' ? UNION_W : PERSON_W
  return node.position.x + w / 2
}

describe('applyDagreLayout — CHILD edge orientation contract', () => {
  it('ranks a child below its parents\' union when CHILD is union→person', () => {
    // Arrange: grandparent generation unions, one child born of that union.
    const nodes: Node[] = [
      personNode('p1', '@I1@'),
      personNode('p2', '@I2@'),
      unionNode('u1'),
      personNode('c1', '@I3@'),
    ]
    const edges: Edge[] = [
      unionEdge('e1', 'p1', 'u1'),
      unionEdge('e2', 'p2', 'u1'),
      childEdge('e3', 'u1', 'c1'),
    ]

    // Act
    const { nodes: laidNodes } = applyDagreLayout(nodes, edges)

    // Assert: parents and child must land on different y-levels, not collapse to one.
    expect(personYLevels(laidNodes).size).toBeGreaterThan(1)
    const p1 = laidNodes.find(n => n.id === 'p1')!
    const c1 = laidNodes.find(n => n.id === 'c1')!
    expect(c1.position.y).toBeGreaterThan(p1.position.y)
  })

  it('produces one distinct person rank per generation across a 3-generation chain', () => {
    // Arrange: grandparent union -> parent (also child) -> parent's own union -> grandchild.
    const nodes: Node[] = [
      personNode('gp1', '@I1@'),
      personNode('gp2', '@I2@'),
      unionNode('u1'),
      personNode('parent', '@I3@'),
      personNode('spouse', '@I4@'),
      unionNode('u2'),
      personNode('grandchild', '@I5@'),
    ]
    const edges: Edge[] = [
      unionEdge('e1', 'gp1', 'u1'),
      unionEdge('e2', 'gp2', 'u1'),
      childEdge('e3', 'u1', 'parent'),
      unionEdge('e4', 'parent', 'u2'),
      unionEdge('e5', 'spouse', 'u2'),
      childEdge('e6', 'u2', 'grandchild'),
    ]

    // Act
    const { nodes: laidNodes } = applyDagreLayout(nodes, edges, { rootId: '@I3@' })

    // Assert: three generations of persons must resolve to three distinct signed generations.
    const generations = laidNodes
      .filter(n => n.type === 'person')
      .map(n => (n.data as { generation?: number }).generation)
    expect(new Set(generations)).toEqual(new Set([-1, 0, 1]))
  })

  it('collapses parents and child onto the same rank when CHILD is (incorrectly) person→union', () => {
    // Arrange: same family as the first test, but CHILD reversed to person (source) → union (target) —
    // this is the orientation that caused issue #180's flat-tree regression.
    const nodes: Node[] = [
      personNode('p1', '@I1@'),
      personNode('p2', '@I2@'),
      unionNode('u1'),
      personNode('c1', '@I3@'),
    ]
    const edges: Edge[] = [
      unionEdge('e1', 'p1', 'u1'),
      unionEdge('e2', 'p2', 'u1'),
      { id: 'e3', source: 'c1', target: 'u1', label: 'CHILD' },
    ]

    // Act
    const { nodes: laidNodes } = applyDagreLayout(nodes, edges)

    // Assert: with both edge types pointing person→union, dagre has no reason to separate generations.
    expect(personYLevels(laidNodes).size).toBe(1)
  })
})

describe('applyDagreLayout — exposed generation y-levels', () => {
  it('pins the clustered y-level for each generation across a 3-generation chain', () => {
    // Arrange: same grandparent -> parent -> grandchild chain as above.
    const nodes: Node[] = [
      personNode('gp1', '@I1@'),
      personNode('gp2', '@I2@'),
      unionNode('u1'),
      personNode('parent', '@I3@'),
      personNode('spouse', '@I4@'),
      unionNode('u2'),
      personNode('grandchild', '@I5@'),
    ]
    const edges: Edge[] = [
      unionEdge('e1', 'gp1', 'u1'),
      unionEdge('e2', 'gp2', 'u1'),
      childEdge('e3', 'u1', 'parent'),
      unionEdge('e4', 'parent', 'u2'),
      unionEdge('e5', 'spouse', 'u2'),
      childEdge('e6', 'u2', 'grandchild'),
    ]

    // Act
    const { generationLevels } = applyDagreLayout(nodes, edges, { rootId: '@I3@' })

    // Assert: exact pinned y-level per generation, so a caller (e.g. generation bands) can
    // trust these values without recomputing the clustering itself.
    expect(generationLevels).toEqual([
      { generation: -1, y: 0 },
      { generation: 0, y: 230 },
      { generation: 1, y: 460 },
    ])
  })

  it('pins one y-level per rank across a 4-generation chain', () => {
    // Arrange: great-grandparent union -> grandparent (also child) -> parent (also child) -> child.
    const nodes: Node[] = [
      personNode('ggp1', '@I1@'),
      personNode('ggp2', '@I2@'),
      unionNode('u1'),
      personNode('gp', '@I3@'),
      personNode('gpSpouse', '@I4@'),
      unionNode('u2'),
      personNode('parent', '@I5@'),
      personNode('parentSpouse', '@I6@'),
      unionNode('u3'),
      personNode('child', '@I7@'),
    ]
    const edges: Edge[] = [
      unionEdge('e1', 'ggp1', 'u1'),
      unionEdge('e2', 'ggp2', 'u1'),
      childEdge('e3', 'u1', 'gp'),
      unionEdge('e4', 'gp', 'u2'),
      unionEdge('e5', 'gpSpouse', 'u2'),
      childEdge('e6', 'u2', 'parent'),
      unionEdge('e7', 'parent', 'u3'),
      unionEdge('e8', 'parentSpouse', 'u3'),
      childEdge('e9', 'u3', 'child'),
    ]

    // Act: root the generations on the parent (second-from-bottom).
    const { generationLevels } = applyDagreLayout(nodes, edges, { rootId: '@I5@' })

    // Assert: four generations, each 230px apart, centered on generation 0.
    expect(generationLevels).toEqual([
      { generation: -2, y: 0 },
      { generation: -1, y: 230 },
      { generation: 0, y: 460 },
      { generation: 1, y: 690 },
    ])
  })

  it('returns no y-levels when no rootId is supplied', () => {
    const nodes: Node[] = [
      personNode('p1', '@I1@'),
      personNode('p2', '@I2@'),
      unionNode('u1'),
      personNode('c1', '@I3@'),
    ]
    const edges: Edge[] = [
      unionEdge('e1', 'p1', 'u1'),
      unionEdge('e2', 'p2', 'u1'),
      childEdge('e3', 'u1', 'c1'),
    ]

    const { generationLevels } = applyDagreLayout(nodes, edges)

    expect(generationLevels).toEqual([])
  })
})

describe('applyDagreLayout — node dimensions for React Flow measurement', () => {
  // Mirrors the private PERSON_H/UNION_H constants in src/lib/layout.ts.
  const PERSON_H = 76
  const UNION_H = 14

  it('carries width and height on every laid-out node, matching its type (issue #230)', () => {
    // Arrange: same family shape as the CHILD-orientation tests above.
    const nodes: Node[] = [
      personNode('p1', '@I1@'),
      personNode('p2', '@I2@'),
      unionNode('u1'),
      personNode('c1', '@I3@'),
    ]
    const edges: Edge[] = [
      unionEdge('e1', 'p1', 'u1'),
      unionEdge('e2', 'p2', 'u1'),
      childEdge('e3', 'u1', 'c1'),
    ]

    // Act
    const { nodes: laidNodes } = applyDagreLayout(nodes, edges)

    // Assert: React Flow only skips its ResizeObserver measurement pass — and reveals
    // a node immediately — when the node object itself carries `width`/`height`.
    // Without these, every node stays `visibility: hidden` (issue #230).
    laidNodes.forEach(n => {
      const [expectedW, expectedH] =
        n.type === 'union' ? [UNION_W, UNION_H] : [PERSON_W, PERSON_H]
      expect(n.width).toBe(expectedW)
      expect(n.height).toBe(expectedH)
    })
  })
})

describe('applyDagreLayout — union horizontal centering', () => {
  it('centers a union node horizontally between its two parents, even when its own child count pulls it off the naive dagre position', () => {
    // Arrange: mirrors issue #219's Donald/John family. Donald's union u1 (with Irene) has one
    // child; John's union u2 (with johnSpouse) has five children. Without a post-layout centering
    // pass, dagre's median heuristic pulls a union toward its wider set of children rather than
    // holding it centred on its two actual parents — this is the reported drift.
    const nodes: Node[] = [
      personNode('donald', '@I3@'),
      personNode('irene', '@I5@'),
      unionNode('u1'),
      personNode('stephen', '@I6@'),
      personNode('john', '@I4@'),
      personNode('johnSpouse', '@I7@'),
      unionNode('u2'),
      personNode('jc1', '@I8@'),
      personNode('jc2', '@I9@'),
      personNode('jc3', '@I10@'),
      personNode('jc4', '@I11@'),
      personNode('jc5', '@I12@'),
    ]
    const edges: Edge[] = [
      unionEdge('e5', 'donald', 'u1'),
      unionEdge('e6', 'irene', 'u1'),
      childEdge('e7', 'u1', 'stephen'),
      unionEdge('e8', 'john', 'u2'),
      unionEdge('e9', 'johnSpouse', 'u2'),
      childEdge('e10', 'u2', 'jc1'),
      childEdge('e11', 'u2', 'jc2'),
      childEdge('e12', 'u2', 'jc3'),
      childEdge('e13', 'u2', 'jc4'),
      childEdge('e14', 'u2', 'jc5'),
    ]

    // Act
    const { nodes: laidNodes } = applyDagreLayout(nodes, edges)

    // Assert: each union's centre x must be the exact midpoint of its own two parents' centres —
    // u2 must not be dragged toward the median of its five children.
    const john = laidNodes.find(n => n.id === 'john')!
    const johnSpouse = laidNodes.find(n => n.id === 'johnSpouse')!
    const u2 = laidNodes.find(n => n.id === 'u2')!

    const expectedCenter = (centerX(john) + centerX(johnSpouse)) / 2
    expect(centerX(u2)).toBeCloseTo(expectedCenter, 5)
  })

  it('aligns a union to its single in-view parent and leaves rank assignment unchanged', () => {
    // Arrange: only one parent (donald) is present in this view — the other spouse has been
    // filtered out (e.g. a partial tree slice). u1 has no second UNION-edge parent to average
    // against, so it must align exactly to donald's centre x rather than drift or collapse to 0.
    const nodes: Node[] = [
      personNode('donald', '@I3@'),
      unionNode('u1'),
      personNode('stephen', '@I6@'),
    ]
    const edges: Edge[] = [
      unionEdge('e5', 'donald', 'u1'),
      childEdge('e7', 'u1', 'stephen'),
    ]

    // Act
    const { nodes: laidNodes } = applyDagreLayout(nodes, edges)

    // Assert: union's centre x matches its one known parent exactly.
    const donald = laidNodes.find(n => n.id === 'donald')!
    const u1 = laidNodes.find(n => n.id === 'u1')!
    expect(centerX(u1)).toBeCloseTo(centerX(donald), 5)

    // Assert: rank assignment is unaffected by the centering pass — parent and child still
    // resolve to distinct, correctly ordered y-levels.
    expect(personYLevels(laidNodes).size).toBeGreaterThan(1)
    expect(laidNodes.find(n => n.id === 'stephen')!.position.y).toBeGreaterThan(donald.position.y)
  })

  describe('colliding unions on the same rank (resolveRankXs)', () => {
    // dagre's crossing-minimisation reorders small synthetic graphs so that same-rank
    // unions never actually collide, so the collision-pressure branch is unreachable
    // through applyDagreLayout fixtures and is exercised on the pure helper instead.
    const W = UNION_W

    /** Centre x of a member given its resolved left-edge x. */
    const center = (x: number) => x + W / 2

    /** Asserts every member keeps NODE_GAP clearance from its neighbours. */
    function expectSeparated(xs: number[], widths: number[]) {
      const boxes = xs.map((x, i) => ({ x, w: widths[i] })).sort((a, b) => a.x - b.x)
      boxes.slice(1).forEach((box, i) => {
        expect(box.x - (boxes[i].x + boxes[i].w)).toBeGreaterThanOrEqual(NODE_GAP)
      })
    }

    it('places a union inside its parents\' span by displacing the rank-mate on top of it (issue #236)', () => {
      // Arrange: the exact repro from issue #236. The union's parents sit 20px apart
      // (span [1483, 1503] in left-edge terms) with a same-rank union seeded right on
      // its ideal x. No x is both inside that span and clear of a *stationary*
      // neighbour, so the old one-union-at-a-time helper returned 1449 — 34px outside
      // the span, silently breaking AC2. Solving the rank as a whole moves the
      // neighbour instead.
      const { xs, spanRelaxed } = resolveRankXs([
        { x: 1493, w: W, parentCenterXs: [1490, 1510] },
        { x: 1493, w: W },
      ])

      // Assert: AC2 holds unconditionally — centre inside the parents' span.
      expect(center(xs[0])).toBeGreaterThanOrEqual(1490)
      expect(center(xs[0])).toBeLessThanOrEqual(1510)
      // Assert: and the left edge lands inside the span the issue names explicitly.
      expect(xs[0]).toBeGreaterThanOrEqual(1483)
      expect(xs[0]).toBeLessThanOrEqual(1503)
      // Assert: collision-freedom holds too — the rank-mate was moved clear.
      expectSeparated(xs, [W, W])
      // Assert: nothing had to be relaxed; both invariants held outright.
      expect(spanRelaxed).toEqual([])
    })

    it('does not let one union cross past another', () => {
      // Arrange: two nested couples — uOuter's parents straddle uInner's, so both
      // mean-parent x values land within a node-width of each other.
      const outerParents = [1000, 2000] // ideal centre 1500
      const innerParents = [1400, 1620] // ideal centre 1510

      // Act
      const { xs, spanRelaxed } = resolveRankXs([
        { x: 1500 - W / 2, w: W, parentCenterXs: outerParents },
        { x: 1510 - W / 2, w: W, parentCenterXs: innerParents },
      ])
      const [outerX, innerX] = xs

      // Assert: uInner's parents sit to the right of uOuter's mean, so uInner must
      // stay to the right of uOuter — it must not jump through to the far side.
      expect(innerX).toBeGreaterThan(outerX)
      expectSeparated(xs, [W, W])
      // Assert: both stay inside their own parents' spans.
      expect(center(outerX)).toBeGreaterThanOrEqual(Math.min(...outerParents))
      expect(center(outerX)).toBeLessThanOrEqual(Math.max(...outerParents))
      expect(center(innerX)).toBeGreaterThanOrEqual(Math.min(...innerParents))
      expect(center(innerX)).toBeLessThanOrEqual(Math.max(...innerParents))
      expect(spanRelaxed).toEqual([])
    })

    it('keeps both unions within their own parents\' spans under collision pressure (AC2)', () => {
      // Arrange: two narrow, adjacent spans whose ideals are only 35px apart — closer
      // than the 44px (UNION_W + NODE_GAP) they need. The rank must spread, and the
      // spreading must stay inside both spans rather than pushing either one out.
      const leftParents = [1000, 1020] // span [993, 1013], ideal 1003
      const rightParents = [1010, 1080] // span [1003, 1073], ideal 1038

      // Act
      const { xs, spanRelaxed } = resolveRankXs([
        { x: 1003, w: W, parentCenterXs: leftParents },
        { x: 1038, w: W, parentCenterXs: rightParents },
      ])

      // Assert: they were genuinely forced apart (at least one moved off its ideal) …
      expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(W + NODE_GAP)
      expect([xs[0] - 1003, xs[1] - 1038].some(delta => Math.abs(delta) > 1e-9)).toBe(true)
      // … and yet both centres are still inside their own parents' spans.
      expect(center(xs[0])).toBeGreaterThanOrEqual(Math.min(...leftParents))
      expect(center(xs[0])).toBeLessThanOrEqual(Math.max(...leftParents))
      expect(center(xs[1])).toBeGreaterThanOrEqual(Math.min(...rightParents))
      expect(center(xs[1])).toBeLessThanOrEqual(Math.max(...rightParents))
      expect(spanRelaxed).toEqual([])
    })

    it('reports a relaxed span, and still never overlaps, when two spans are provably infeasible', () => {
      // Arrange: the documented residual-infeasibility case. Both spans are 10px wide
      // and overlap each other, so the widest achievable separation is
      // (max hi) - (min lo) = 1008 - 993 = 15px — far short of the 44px two 14px-wide
      // unions need. Only moving the *person* nodes a rank above could fix this, which
      // this pass deliberately does not do.
      const leftParents = [1000, 1010] // span [993, 1003]
      const rightParents = [1005, 1015] // span [998, 1008]

      // Act
      const { xs, spanRelaxed } = resolveRankXs([
        { x: 998, w: W, parentCenterXs: leftParents },
        { x: 1003, w: W, parentCenterXs: rightParents },
      ])

      // Assert: collision-freedom is absolute — it is never the invariant that gives.
      expectSeparated(xs, [W, W])
      // Assert: so is ordering — the left union's parents are to the left, so it stays left.
      expect(xs[0]).toBeLessThan(xs[1])
      // Assert: the span breach is reported rather than swallowed, and it is minimal —
      // only the member that actually ended up outside its span is listed.
      expect(spanRelaxed.length).toBeGreaterThan(0)
      spanRelaxed.forEach(i => {
        const parents = i === 0 ? leftParents : rightParents
        const outside =
          center(xs[i]) < Math.min(...parents) || center(xs[i]) > Math.max(...parents)
        expect(outside).toBe(true)
      })
      const kept = [0, 1].filter(i => !spanRelaxed.includes(i))
      kept.forEach(i => {
        const parents = i === 0 ? leftParents : rightParents
        expect(center(xs[i])).toBeGreaterThanOrEqual(Math.min(...parents))
        expect(center(xs[i])).toBeLessThanOrEqual(Math.max(...parents))
      })
    })

    it('reports a relaxed span when an immovable rank-mate blocks the only feasible slot', () => {
      // Arrange: the #236 repro again, except the blocking rank-mate is pinned (a node
      // this pass must not move, e.g. a person node dagre placed). With nothing free to
      // displace, the conflict is real and the union has to leave its span.
      const { xs, spanRelaxed } = resolveRankXs([
        { x: 1493, w: W, parentCenterXs: [1490, 1510] },
        { x: 1493, w: W, movable: false },
      ])

      // Assert: the immovable member did not move …
      expect(xs[1]).toBe(1493)
      // … the boxes still do not overlap …
      expectSeparated(xs, [W, W])
      // … and the span breach is reported, not silently returned as if it were fine
      // (the old helper returned exactly this 1449 with no signal at all).
      expect(spanRelaxed).toEqual([0])
    })
  })

  describe('three unions sharing parents on one rank', () => {
    // Arrange (shared): a, b and c are pairwise partnered, so all three unions land on the
    // same rank and each shares a parent with the other two. Every union must still centre
    // on its own two parents and stay in the left-to-right order those parents imply.
    const nodes: Node[] = [
      personNode('a', '@I1@'),
      personNode('b', '@I2@'),
      personNode('c', '@I3@'),
      unionNode('u1'),
      unionNode('u2'),
      unionNode('u3'),
      personNode('ch1', '@I5@'),
      personNode('ch2', '@I6@'),
      personNode('ch3', '@I7@'),
    ]
    const edges: Edge[] = [
      unionEdge('e1', 'a', 'u1'),
      unionEdge('e2', 'c', 'u1'),
      childEdge('e3', 'u1', 'ch1'),
      unionEdge('e4', 'a', 'u2'),
      unionEdge('e5', 'b', 'u2'),
      childEdge('e6', 'u2', 'ch2'),
      unionEdge('e7', 'b', 'u3'),
      unionEdge('e8', 'c', 'u3'),
      childEdge('e9', 'u3', 'ch3'),
    ]

    it('keeps every union on one rank, non-overlapping and within its own parents\' span', () => {
      // Act
      const { nodes: laidNodes } = applyDagreLayout(nodes, edges)
      const byId = (id: string) => laidNodes.find(n => n.id === id)!
      const unions = [
        { union: byId('u1'), parents: ['a', 'c'] },
        { union: byId('u2'), parents: ['a', 'b'] },
        { union: byId('u3'), parents: ['b', 'c'] },
      ]

      // Assert: all three unions share one rank (precondition for the same-rank pass).
      expect(new Set(unions.map(u => u.union.position.y)).size).toBe(1)

      // Assert: each union centre stays within the min/max of its own parents' centres.
      unions.forEach(({ union, parents }) => {
        const parentCenters = parents.map(id => centerX(byId(id)))
        expect(centerX(union)).toBeGreaterThanOrEqual(Math.min(...parentCenters))
        expect(centerX(union)).toBeLessThanOrEqual(Math.max(...parentCenters))
      })

      // Assert: no two unions occupy overlapping x-spans.
      const sorted = [...unions].map(u => u.union).sort((l, r) => l.position.x - r.position.x)
      sorted.slice(1).forEach((node, i) => {
        expect(sorted[i].position.x + UNION_W).toBeLessThanOrEqual(node.position.x)
      })
    })
  })
})
