import { Node, Edge } from 'reactflow'
import { applyDagreLayout, resolveUnionX, PERSON_W, UNION_W } from './layout'

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

  describe('two colliding unions on the same rank (resolveUnionX)', () => {
    // dagre's crossing-minimisation reorders small synthetic graphs so that same-rank
    // unions never actually collide, so the clamp branch is unreachable through
    // applyDagreLayout fixtures and is exercised on the pure helper instead — driven
    // the same way the layout pass drives it: one union at a time, each seeing the
    // *post-clamp* working position of the rank-mate already placed.
    const W = UNION_W
    // Two nested couples: uOuter's parents straddle uInner's, so both mean-parent x
    // values land within a node-width of each other — a genuine collision.
    const outerParents = [1000, 2000]   // ideal centre 1500
    const innerParents = [1400, 1620]   // ideal centre 1510

    it('does not let the second union cross past the first', () => {
      // Act: place uOuter first (rank-mate still at its dagre slot), then uInner
      // against uOuter's resolved position.
      const outerX = resolveUnionX({ parentCenterXs: outerParents, w: W, rankMates: [{ x: 1510 - W / 2, w: W }] })
      const innerX = resolveUnionX({ parentCenterXs: innerParents, w: W, rankMates: [{ x: outerX, w: W }] })

      // Assert: uInner's parents sit to the right of uOuter's mean, so uInner must
      // stay to the right of uOuter — it must not clamp through to the far side.
      expect(innerX).toBeGreaterThan(outerX)
      // Assert: their occupied spans stay disjoint.
      expect(outerX + W).toBeLessThanOrEqual(innerX)
    })

    it('keeps a clamped union within its own parents\' horizontal span (AC2)', () => {
      // Act: a rank-mate parked exactly on the ideal forces the clamp branch.
      const idealX = (innerParents[0] + innerParents[1]) / 2 - W / 2
      const clampedX = resolveUnionX({
        parentCenterXs: innerParents,
        w: W,
        rankMates: [{ x: idealX, w: W }],
      })

      // Assert: the clamp fired (moved off the ideal) …
      expect(clampedX).not.toBeCloseTo(idealX, 5)
      // … but never outside the min/max of its own parents' centres.
      expect(clampedX + W / 2).toBeGreaterThanOrEqual(Math.min(...innerParents))
      expect(clampedX + W / 2).toBeLessThanOrEqual(Math.max(...innerParents))
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
