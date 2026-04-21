/**
 * @fileoverview Layout algorithms for family tree visualization.
 * Uses the Dagre graph layout library to automatically position nodes in a hierarchical tree structure.
 */

import dagre from '@dagrejs/dagre'
import { Node, Edge } from 'reactflow'

/** Width of a person node in pixels. */
const PERSON_W = 200
/** Height of a person node in pixels. */
const PERSON_H = 76
/** Width of a union (marriage) node in pixels. */
const UNION_W = 14
/** Height of a union (marriage) node in pixels. */
const UNION_H = 14

/**
 * Returns the width and height dimensions for a given node type.
 *
 * @param {string | undefined} type - Node type ('person', 'union', or undefined)
 * @returns {{w: number, h: number}} Width and height for the node type
 */
function nodeSize(type: string | undefined) {
  return type === 'union'
    ? { w: UNION_W, h: UNION_H }
    : { w: PERSON_W, h: PERSON_H }
}

/**
 * Derive signed generation numbers from laid-out y-positions.
 * Clusters person nodes by y-coordinate rank; root person = generation 0,
 * nodes above = negative (ancestors), nodes below = positive (descendants).
 *
 * @param positionedNodes - Nodes after dagre layout (position.y is top-left corner)
 * @param gedcomRootId - GEDCOM ID of the root person (e.g. "@I85@")
 */
function generationsFromLayout(
  positionedNodes: Array<Node & { position: { x: number; y: number } }>,
  gedcomRootId: string,
): Map<string, number> {
  const rootNode = positionedNodes.find(
    n => n.type === 'person' && (n.data as { gedcomId?: string }).gedcomId === gedcomRootId,
  )
  if (!rootNode) return new Map()

  // Collect unique y-levels for person nodes (round to nearest 10px to absorb float drift)
  const personNodes = positionedNodes.filter(n => n.type === 'person')
  const yLevels = [...new Set(personNodes.map(n => Math.round(n.position.y / 10) * 10))].sort(
    (a, b) => a - b,
  )
  const rootY = Math.round(rootNode.position.y / 10) * 10
  const rootRank = yLevels.indexOf(rootY)

  const gen = new Map<string, number>()
  for (const n of personNodes) {
    const rank = yLevels.indexOf(Math.round(n.position.y / 10) * 10)
    if (rank !== -1) gen.set(n.id, rank - rootRank)
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

  // Edges arrive pre-transformed from FamilyTree.tsx:
  //   CHILD  → union (source) → person (target)   [child is below union]
  //   UNION  → person (source) → union (target)   [spouse is above their family union]
  // Use them as-is so dagre places parents above unions above children.
  edges.forEach(e => {
    g.setEdge(e.source, e.target)
  })

  dagre.layout(g)

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  const positionedNodes = nodes.map(n => {
    const { x, y, width: w, height: h } = g.node(n.id)
    const px = x - w / 2
    const py = y - h / 2
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px + w > maxX) maxX = px + w
    if (py + h > maxY) maxY = py + h
    return { ...n, position: { x: px, y: py } }
  })

  // Derive signed generations from laid-out y-positions (requires layout to be complete first)
  const generations = options?.rootId
    ? generationsFromLayout(positionedNodes, options.rootId)
    : new Map<string, number>()

  const finalNodes = positionedNodes.map(n => {
    const generation = generations.get(n.id)
    return generation !== undefined ? { ...n, data: { ...n.data, generation } } : n
  })

  return {
    nodes: finalNodes,
    edges,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  }
}
