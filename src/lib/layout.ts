/**
 * Dagre layout with BFS-computed generation depth relative to the root.
 * Generation is signed: negative for ancestors, positive for descendants.
 */

import dagre from '@dagrejs/dagre'
import { Node, Edge } from 'reactflow'

interface LayoutOptions {
  rootId?: string | null
}

export function applyDagreLayout(nodes: Node[], edges: Edge[], opts: LayoutOptions = {}) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 40, marginx: 40, marginy: 40 })

  const nodeSize = (n: Node) =>
    n.type === 'union' ? { w: 14, h: 14 } : { w: 200, h: 76 }

  nodes.forEach(n => {
    const { w, h } = nodeSize(n)
    g.setNode(n.id, { width: w, height: h })
  })

  // CHILD goes child->union in the graph; reverse for TB layout so children rank below union.
  edges.forEach(e => {
    if (e.label === 'CHILD') g.setEdge(e.target, e.source)
    else g.setEdge(e.source, e.target)
  })
  dagre.layout(g)

  // Compute generation via BFS from root, walking the undirected graph with
  // per-edge-direction semantics: UNION edges are within-generation partners;
  // stepping across CHILD is the only way to change generation.
  const gen = new Map<string, number>()
  if (opts.rootId) {
    gen.set(opts.rootId, 0)
    const adj = new Map<string, Array<{ to: string; kind: 'UNION' | 'CHILD-UP' | 'CHILD-DOWN' }>>()
    const add = (from: string, to: string, kind: 'UNION' | 'CHILD-UP' | 'CHILD-DOWN') => {
      if (!adj.has(from)) adj.set(from, [])
      adj.get(from)!.push({ to, kind })
    }
    edges.forEach(e => {
      if (e.label === 'UNION') {
        add(e.source, e.target, 'UNION')
        add(e.target, e.source, 'UNION')
      } else if (e.label === 'CHILD') {
        // stored as (child)-[CHILD]->(union). Moving child→union is going UP.
        add(e.source, e.target, 'CHILD-UP')
        add(e.target, e.source, 'CHILD-DOWN')
      }
    })
    const queue: string[] = [opts.rootId]
    while (queue.length) {
      const id = queue.shift()!
      const depth = gen.get(id)!
      for (const { to, kind } of adj.get(id) ?? []) {
        if (gen.has(to)) continue
        const next =
          kind === 'UNION' ? depth : kind === 'CHILD-UP' ? depth - 1 : depth + 1
        gen.set(to, next)
        queue.push(to)
      }
    }
  }

  return {
    nodes: nodes.map(n => {
      const pos = g.node(n.id)
      const { w, h } = nodeSize(n)
      return {
        ...n,
        data: { ...n.data, generation: gen.get(n.id) ?? 0 },
        position: { x: pos.x - w / 2, y: pos.y - h / 2 },
      }
    }),
    edges,
  }
}
