import { Node, Edge } from 'reactflow'
import { applyDagreLayout } from './layout'

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
