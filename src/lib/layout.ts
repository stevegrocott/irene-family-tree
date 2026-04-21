import dagre from '@dagrejs/dagre'
import { Node, Edge } from 'reactflow'

export function applyDagreLayout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', ranksep: 100, nodesep: 60 })

  nodes.forEach(n => {
    const w = n.type === 'union' ? 12 : 160
    const h = n.type === 'union' ? 12 : 68
    g.setNode(n.id, { width: w, height: h })
  })
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)

  return {
    nodes: nodes.map(n => {
      const { x, y } = g.node(n.id)
      const w = n.type === 'union' ? 12 : 160
      const h = n.type === 'union' ? 12 : 68
      return { ...n, position: { x: x - w / 2, y: y - h / 2 } }
    }),
    edges,
  }
}
