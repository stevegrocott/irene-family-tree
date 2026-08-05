import { resolveArrowTarget, resolveShellAction } from './keyboardNav'
import type { FlowNode, FlowEdge } from '@/types/tree'

/** Minimal person node; only `id`/`type`/`position.x` are read by arrow resolution. */
function personNode(id: string, x = 0): FlowNode {
  return { id, type: 'person', data: { gedcomId: id } as FlowNode['data'], position: { x, y: 0 } }
}

function unionNode(id: string, x = 0): FlowNode {
  return { id, type: 'union', data: { gedcomId: id } as FlowNode['data'], position: { x, y: 0 } }
}

/** CHILD edge in the API/contract orientation: union (source) → person (target). */
function childEdge(id: string, unionId: string, personId: string): FlowEdge {
  return { id, source: unionId, target: personId, label: 'CHILD' }
}

/** UNION edge: person (source) → union (target). */
function unionEdge(id: string, personId: string, unionId: string): FlowEdge {
  return { id, source: personId, target: unionId, label: 'UNION' }
}

describe('resolveArrowTarget — no relation in that direction', () => {
  it('returns null for ArrowUp when the person has no birth union', () => {
    const nodes = [personNode('root')]
    expect(resolveArrowTarget(nodes, [], 'root', 'ArrowUp')).toBeNull()
  })

  it('returns null for ArrowDown when the person has no union of their own', () => {
    const nodes = [personNode('root')]
    expect(resolveArrowTarget(nodes, [], 'root', 'ArrowDown')).toBeNull()
  })

  it('returns null for ArrowLeft/ArrowRight for an only child', () => {
    const nodes = [personNode('gp1', 0), unionNode('u1', 0), personNode('focus', 0)]
    const edges = [unionEdge('e1', 'gp1', 'u1'), childEdge('e2', 'u1', 'focus')]
    expect(resolveArrowTarget(nodes, edges, 'focus', 'ArrowLeft')).toBeNull()
    expect(resolveArrowTarget(nodes, edges, 'focus', 'ArrowRight')).toBeNull()
  })

  it('returns null when currentId is not present in nodes', () => {
    const nodes = [personNode('p1')]
    expect(resolveArrowTarget(nodes, [], 'ghost', 'ArrowUp')).toBeNull()
  })
})

describe('resolveArrowTarget — ArrowUp to parent', () => {
  it('moves to the single parent of a birth union', () => {
    const nodes = [personNode('parent', 0), unionNode('u1', 0), personNode('child', 0)]
    const edges = [unionEdge('e1', 'parent', 'u1'), childEdge('e2', 'u1', 'child')]
    expect(resolveArrowTarget(nodes, edges, 'child', 'ArrowUp')).toBe('parent')
  })

  it('picks the parent nearest the child on-screen when there are two', () => {
    const nodes = [
      personNode('mother', 0),
      personNode('father', 100),
      unionNode('u1', 50),
      personNode('child', 90),
    ]
    const edges = [
      unionEdge('e1', 'mother', 'u1'),
      unionEdge('e2', 'father', 'u1'),
      childEdge('e3', 'u1', 'child'),
    ]
    expect(resolveArrowTarget(nodes, edges, 'child', 'ArrowUp')).toBe('father')
  })
})

describe('resolveArrowTarget — ArrowDown to child', () => {
  it('moves to the single child of the person\'s union', () => {
    const nodes = [personNode('parent', 0), unionNode('u1', 0), personNode('child', 0)]
    const edges = [unionEdge('e1', 'parent', 'u1'), childEdge('e2', 'u1', 'child')]
    expect(resolveArrowTarget(nodes, edges, 'parent', 'ArrowDown')).toBe('child')
  })

  it('picks the child nearest the parent on-screen when there are several', () => {
    const nodes = [
      personNode('parent', 50),
      unionNode('u1', 50),
      personNode('c1', 0),
      personNode('c2', 40),
      personNode('c3', 200),
    ]
    const edges = [
      unionEdge('e1', 'parent', 'u1'),
      childEdge('e2', 'u1', 'c1'),
      childEdge('e3', 'u1', 'c2'),
      childEdge('e4', 'u1', 'c3'),
    ]
    expect(resolveArrowTarget(nodes, edges, 'parent', 'ArrowDown')).toBe('c2')
  })

  it('returns null when the person has a union but no children yet', () => {
    const nodes = [personNode('spouse1', 0), personNode('spouse2', 20), unionNode('u1', 10)]
    const edges = [unionEdge('e1', 'spouse1', 'u1'), unionEdge('e2', 'spouse2', 'u1')]
    expect(resolveArrowTarget(nodes, edges, 'spouse1', 'ArrowDown')).toBeNull()
  })
})

describe('resolveArrowTarget — ArrowLeft/ArrowRight between siblings', () => {
  const nodes = [
    personNode('gp1', 100),
    unionNode('u1', 100),
    personNode('sib-left', 0),
    personNode('focus', 100),
    personNode('sib-right', 200),
  ]
  const edges = [
    unionEdge('e1', 'gp1', 'u1'),
    childEdge('e2', 'u1', 'sib-left'),
    childEdge('e3', 'u1', 'focus'),
    childEdge('e4', 'u1', 'sib-right'),
  ]

  it('ArrowRight moves to the next sibling in on-screen order', () => {
    expect(resolveArrowTarget(nodes, edges, 'focus', 'ArrowRight')).toBe('sib-right')
  })

  it('ArrowLeft moves to the previous sibling in on-screen order', () => {
    expect(resolveArrowTarget(nodes, edges, 'focus', 'ArrowLeft')).toBe('sib-left')
  })

  it('returns null past the last sibling on the right', () => {
    expect(resolveArrowTarget(nodes, edges, 'sib-right', 'ArrowRight')).toBeNull()
  })

  it('returns null past the first sibling on the left', () => {
    expect(resolveArrowTarget(nodes, edges, 'sib-left', 'ArrowLeft')).toBeNull()
  })

  it('orders by x-position rather than edge/data order', () => {
    // Edges are listed left/right out of screen order; resolution must still
    // follow x-position, not edge insertion order.
    const shuffledEdges = [
      unionEdge('e1', 'gp1', 'u1'),
      childEdge('e2', 'u1', 'sib-right'),
      childEdge('e3', 'u1', 'sib-left'),
      childEdge('e4', 'u1', 'focus'),
    ]
    expect(resolveArrowTarget(nodes, shuffledEdges, 'focus', 'ArrowRight')).toBe('sib-right')
    expect(resolveArrowTarget(nodes, shuffledEdges, 'focus', 'ArrowLeft')).toBe('sib-left')
  })
})

describe('resolveShellAction — ⌘K / Ctrl+K open search', () => {
  it('opens search on "k" with metaKey', () => {
    expect(resolveShellAction({ key: 'k', metaKey: true }, { searchOpen: false, hasFocus: false }))
      .toEqual({ type: 'openSearch' })
  })

  it('opens search on "k" with ctrlKey', () => {
    expect(resolveShellAction({ key: 'k', ctrlKey: true }, { searchOpen: false, hasFocus: false }))
      .toEqual({ type: 'openSearch' })
  })

  it('is a no-op for "k" without a modifier', () => {
    expect(resolveShellAction({ key: 'k' }, { searchOpen: false, hasFocus: false })).toBeNull()
  })
})

describe('resolveShellAction — Esc', () => {
  it('closes search when search is open', () => {
    expect(resolveShellAction({ key: 'Escape' }, { searchOpen: true, hasFocus: false }))
      .toEqual({ type: 'closeSearch' })
  })

  it('is a no-op when search is already closed', () => {
    expect(resolveShellAction({ key: 'Escape' }, { searchOpen: false, hasFocus: false })).toBeNull()
  })
})

describe('resolveShellAction — 1/2/3 view switch', () => {
  it('maps "1"/"2"/"3" to walk/split/tree when a focus person is set', () => {
    const state = { searchOpen: false, hasFocus: true }
    expect(resolveShellAction({ key: '1' }, state)).toEqual({ type: 'setView', view: 'walk' })
    expect(resolveShellAction({ key: '2' }, state)).toEqual({ type: 'setView', view: 'split' })
    expect(resolveShellAction({ key: '3' }, state)).toEqual({ type: 'setView', view: 'tree' })
  })

  it('is a no-op for view keys while search is open', () => {
    const state = { searchOpen: true, hasFocus: true }
    expect(resolveShellAction({ key: '1' }, state)).toBeNull()
    expect(resolveShellAction({ key: '2' }, state)).toBeNull()
    expect(resolveShellAction({ key: '3' }, state)).toBeNull()
  })

  it('is a no-op for view keys when no focus person is set', () => {
    const state = { searchOpen: false, hasFocus: false }
    expect(resolveShellAction({ key: '1' }, state)).toBeNull()
    expect(resolveShellAction({ key: '2' }, state)).toBeNull()
    expect(resolveShellAction({ key: '3' }, state)).toBeNull()
  })
})

describe('resolveShellAction — unrelated keys', () => {
  it('returns null for keys with no shell binding', () => {
    expect(resolveShellAction({ key: 'ArrowUp' }, { searchOpen: false, hasFocus: true })).toBeNull()
  })
})
