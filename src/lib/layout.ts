/**
 * @fileoverview Layout algorithms for family tree visualization.
 * Uses the Dagre graph layout library to automatically position nodes in a hierarchical tree structure.
 */

import dagre from '@dagrejs/dagre'
import { Node, Edge } from 'reactflow'

/**
 * Applies a hierarchical dagre layout to family tree nodes and edges
 *
 * Automatically calculates positions for all nodes in the family tree using a top-to-bottom
 * hierarchical layout algorithm. Person nodes are sized at 160x68, while union nodes are 12x12.
 * The layout respects rank separation (80) and node separation (40) for clear visual hierarchy.
 *
 * @param {Node[]} nodes - The React Flow nodes to position
 * @param {Edge[]} edges - The React Flow edges defining the graph structure
 * @returns {{nodes: Node[], edges: Edge[]}} A new set of nodes with calculated positions and the same edges
 */
export function applyDagreLayout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 40 })

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
