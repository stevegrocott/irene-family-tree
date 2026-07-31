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
