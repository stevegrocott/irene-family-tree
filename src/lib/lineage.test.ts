import { computeLineage } from './lineage'
import type { FlowNode, FlowEdge } from '@/types/tree'

/** Minimal person node; only `id`/`type` are read by the lineage BFS. */
function personNode(id: string): FlowNode {
  return { id, type: 'person', data: { gedcomId: id } as FlowNode['data'], position: { x: 0, y: 0 } }
}

function unionNode(id: string): FlowNode {
  return { id, type: 'union', data: { gedcomId: id }, position: { x: 0, y: 0 } }
}

/** CHILD edge in the API/contract orientation: union (source) → person (target). */
function childEdge(id: string, unionId: string, personId: string): FlowEdge {
  return { id, source: unionId, target: personId, label: 'CHILD' }
}

/** UNION edge: person (source) → union (target). */
function unionEdge(id: string, personId: string, unionId: string): FlowEdge {
  return { id, source: personId, target: unionId, label: 'UNION' }
}

describe('computeLineage — isolated focus', () => {
  it('includes only the focus person when they have no relations', () => {
    const nodes = [personNode('p1')]
    const edges: FlowEdge[] = []

    const { nodeIds, edgeIds } = computeLineage(nodes, edges, 'p1')

    expect(nodeIds).toEqual(new Set(['p1']))
    expect(edgeIds).toEqual(new Set())
  })

  it('returns an empty lineage when the focus id is not in the graph', () => {
    const nodes = [personNode('p1')]
    const edges: FlowEdge[] = []

    const { nodeIds, edgeIds } = computeLineage(nodes, edges, 'ghost')

    expect(nodeIds).toEqual(new Set())
    expect(edgeIds).toEqual(new Set())
  })
})

describe('computeLineage — ancestors', () => {
  it('includes both parents of the focus person and the connecting union', () => {
    const nodes = [personNode('gp1'), personNode('gp2'), unionNode('u1'), personNode('focus')]
    const edges = [
      unionEdge('e1', 'gp1', 'u1'),
      unionEdge('e2', 'gp2', 'u1'),
      childEdge('e3', 'u1', 'focus'),
    ]

    const { nodeIds, edgeIds } = computeLineage(nodes, edges, 'focus')

    expect(nodeIds).toEqual(new Set(['focus', 'u1', 'gp1', 'gp2']))
    expect(edgeIds).toEqual(new Set(['e1', 'e2', 'e3']))
  })

  it('walks multiple generations of ancestors', () => {
    const nodes = [
      personNode('ggp1'), personNode('ggp2'), unionNode('u1'),
      personNode('gp1'), personNode('gp2'), unionNode('u2'),
      personNode('focus'),
    ]
    const edges = [
      unionEdge('e1', 'ggp1', 'u1'),
      unionEdge('e2', 'ggp2', 'u1'),
      childEdge('e3', 'u1', 'gp1'),
      unionEdge('e4', 'gp1', 'u2'),
      unionEdge('e5', 'gp2', 'u2'),
      childEdge('e6', 'u2', 'focus'),
    ]

    const { nodeIds, edgeIds } = computeLineage(nodes, edges, 'focus')

    expect(nodeIds).toEqual(new Set(['focus', 'u1', 'u2', 'ggp1', 'ggp2', 'gp1', 'gp2']))
    expect(edgeIds).toEqual(new Set(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']))
  })

  it('excludes siblings sharing the same parent union', () => {
    const nodes = [
      personNode('p1'), personNode('p2'), unionNode('u1'),
      personNode('focus'), personNode('sibling'),
    ]
    const edges = [
      unionEdge('e1', 'p1', 'u1'),
      unionEdge('e2', 'p2', 'u1'),
      childEdge('e3', 'u1', 'focus'),
      childEdge('e4', 'u1', 'sibling'),
    ]

    const { nodeIds } = computeLineage(nodes, edges, 'focus')

    expect(nodeIds.has('sibling')).toBe(false)
  })
})

describe('computeLineage — descendants', () => {
  it('includes children and the connecting union', () => {
    const nodes = [personNode('focus'), personNode('spouse'), unionNode('u1'), personNode('child')]
    const edges = [
      unionEdge('e1', 'focus', 'u1'),
      unionEdge('e2', 'spouse', 'u1'),
      childEdge('e3', 'u1', 'child'),
    ]

    const { nodeIds, edgeIds } = computeLineage(nodes, edges, 'focus')

    expect(nodeIds).toEqual(new Set(['focus', 'u1', 'spouse', 'child']))
    expect(edgeIds).toEqual(new Set(['e1', 'e2', 'e3']))
  })

  it('walks multiple generations of descendants', () => {
    const nodes = [
      personNode('focus'), personNode('spouse'), unionNode('u1'),
      personNode('child'), personNode('childSpouse'), unionNode('u2'),
      personNode('grandchild'),
    ]
    const edges = [
      unionEdge('e1', 'focus', 'u1'),
      unionEdge('e2', 'spouse', 'u1'),
      childEdge('e3', 'u1', 'child'),
      unionEdge('e4', 'child', 'u2'),
      unionEdge('e5', 'childSpouse', 'u2'),
      childEdge('e6', 'u2', 'grandchild'),
    ]

    const { nodeIds, edgeIds } = computeLineage(nodes, edges, 'focus')

    expect(nodeIds).toEqual(
      new Set(['focus', 'u1', 'spouse', 'child', 'u2', 'childSpouse', 'grandchild']),
    )
    expect(edgeIds).toEqual(new Set(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']))
  })
})

describe('computeLineage — remarriage', () => {
  it('includes the spouse at a union on the line but not that spouse\'s other marriage', () => {
    // focus + spouse -> child (on the line). spouse also remarried other2, with child2 (not on the line).
    const nodes = [
      personNode('focus'), personNode('spouse'), unionNode('u1'), personNode('child'),
      personNode('other2'), unionNode('u2'), personNode('child2'),
    ]
    const edges = [
      unionEdge('e1', 'focus', 'u1'),
      unionEdge('e2', 'spouse', 'u1'),
      childEdge('e3', 'u1', 'child'),
      unionEdge('e4', 'spouse', 'u2'),
      unionEdge('e5', 'other2', 'u2'),
      childEdge('e6', 'u2', 'child2'),
    ]

    const { nodeIds, edgeIds } = computeLineage(nodes, edges, 'focus')

    expect(nodeIds).toEqual(new Set(['focus', 'u1', 'spouse', 'child']))
    expect(nodeIds.has('u2')).toBe(false)
    expect(nodeIds.has('other2')).toBe(false)
    expect(nodeIds.has('child2')).toBe(false)
    expect(edgeIds).toEqual(new Set(['e1', 'e2', 'e3']))
  })

  it('excludes a half-sibling born of a parent\'s earlier marriage', () => {
    // focus's parent p1 was previously married to p3, producing half-sibling.
    const nodes = [
      personNode('p1'), personNode('p2'), unionNode('u1'), personNode('focus'),
      personNode('p3'), unionNode('u0'), personNode('halfSibling'),
    ]
    const edges = [
      unionEdge('e1', 'p1', 'u1'),
      unionEdge('e2', 'p2', 'u1'),
      childEdge('e3', 'u1', 'focus'),
      unionEdge('e4', 'p1', 'u0'),
      unionEdge('e5', 'p3', 'u0'),
      childEdge('e6', 'u0', 'halfSibling'),
    ]

    const { nodeIds } = computeLineage(nodes, edges, 'focus')

    expect(nodeIds).toEqual(new Set(['focus', 'u1', 'p1', 'p2']))
    expect(nodeIds.has('u0')).toBe(false)
    expect(nodeIds.has('p3')).toBe(false)
    expect(nodeIds.has('halfSibling')).toBe(false)
  })
})

describe('computeLineage — unrelated branches', () => {
  it('excludes an entirely disconnected family', () => {
    const nodes = [
      personNode('focus'), personNode('spouse'), unionNode('u1'), personNode('child'),
      personNode('stranger1'), personNode('stranger2'), unionNode('u9'), personNode('strangerChild'),
    ]
    const edges = [
      unionEdge('e1', 'focus', 'u1'),
      unionEdge('e2', 'spouse', 'u1'),
      childEdge('e3', 'u1', 'child'),
      unionEdge('e4', 'stranger1', 'u9'),
      unionEdge('e5', 'stranger2', 'u9'),
      childEdge('e6', 'u9', 'strangerChild'),
    ]

    const { nodeIds, edgeIds } = computeLineage(nodes, edges, 'focus')

    expect(nodeIds).toEqual(new Set(['focus', 'u1', 'spouse', 'child']))
    expect(edgeIds).toEqual(new Set(['e1', 'e2', 'e3']))
  })
})
