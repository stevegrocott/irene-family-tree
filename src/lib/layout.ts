/**
 * @fileoverview Layout algorithms for family tree visualization.
 * Uses the Dagre graph layout library to automatically position nodes in a hierarchical tree structure.
 */

import dagre from '@dagrejs/dagre'
import { Node, Edge } from 'reactflow'

const PERSON_W = 200
const PERSON_H = 76
const UNION_W = 14
const UNION_H = 14

function nodeSize(type: string | undefined) {
  return type === 'union'
    ? { w: UNION_W, h: UNION_H }
    : { w: PERSON_W, h: PERSON_H }
}

/**
 * BFS from rootId over the adjacency implied by the edges (undirected),
 * returning a Map<nodeId, generation> where generation 0 = root.
 */
function bfsGenerations(nodeIds: string[], edges: Edge[], rootId?: string): Map<string, number> {
  const gen = new Map<string, number>()
  if (!rootId) return gen

  const adj = new Map<string, string[]>()
  for (const id of nodeIds) adj.set(id, [])
  for (const e of edges) {
    adj.get(e.source)?.push(e.target)
    adj.get(e.target)?.push(e.source)
  }

  gen.set(rootId, 0)
  const queue = [rootId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const curGen = gen.get(cur)!
    for (const nb of adj.get(cur) ?? []) {
      if (!gen.has(nb)) {
        gen.set(nb, curGen + 1)
        queue.push(nb)
      }
    }
  }
  return gen
}

/**
 * Applies a hierarchical dagre layout to family tree nodes and edges.
 *
 * Person nodes are sized at 200×76, union nodes at 14×14.
 * CHILD edges are reversed for dagre so that parents rank above children.
 * An optional rootId triggers a BFS generation pass stored on each node's data.
 *
 * @param nodes - React Flow nodes to position
 * @param edges - React Flow edges defining the graph structure
 * @param options - Optional settings: rootId to seed the BFS generation pass
 * @returns Nodes with calculated positions, same edges, and bounding-box bounds
 */
export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  options?: { rootId?: string },
) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', ranksep: 70, nodesep: 25 })

  nodes.forEach(n => {
    const { w, h } = nodeSize(n.type)
    g.setNode(n.id, { width: w, height: h })
  })

  // Reverse CHILD edges so dagre places parents above children
  edges.forEach(e => {
    const isChild = (e.data as { relType?: string } | undefined)?.relType === 'CHILD'
    g.setEdge(isChild ? e.target : e.source, isChild ? e.source : e.target)
  })

  dagre.layout(g)

  const generations = bfsGenerations(
    nodes.map(n => n.id),
    edges,
    options?.rootId,
  )

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  const positionedNodes = nodes.map(n => {
    const { x, y } = g.node(n.id)
    const { w, h } = nodeSize(n.type)
    const px = x - w / 2
    const py = y - h / 2
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px + w > maxX) maxX = px + w
    if (py + h > maxY) maxY = py + h

    const generation = generations.get(n.id)
    return {
      ...n,
      position: { x: px, y: py },
      data: generation !== undefined ? { ...n.data, generation } : n.data,
    }
  })

  return {
    nodes: positionedNodes,
    edges,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  }
}
