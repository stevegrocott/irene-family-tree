/**
 * @fileoverview Layout algorithms for family tree visualization.
 * Uses the Dagre graph layout library to automatically position nodes in a hierarchical tree structure.
 */

import dagre from '@dagrejs/dagre'
import { Node, Edge } from 'reactflow'

/** Width of a person node in pixels. */
const PERSON_W = 240
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
 * One clustered generation rank: its signed generation number (0 = root's rank)
 * and the rounded y-coordinate shared by every person node at that rank.
 */
export interface GenerationLevel {
  generation: number
  y: number
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
): { generationByNodeId: Map<string, number>; levels: GenerationLevel[] } {
  const rootNode = positionedNodes.find(
    n => n.type === 'person' && (n.data as { gedcomId?: string }).gedcomId === gedcomRootId,
  )
  if (!rootNode) return { generationByNodeId: new Map(), levels: [] }

  // Collect unique y-levels for person nodes (round to nearest 10px to absorb float drift)
  const personNodes = positionedNodes.filter(n => n.type === 'person')
  const yLevels = [...new Set(personNodes.map(n => Math.round(n.position.y / 10) * 10))].sort(
    (a, b) => a - b,
  )
  const rootY = Math.round(rootNode.position.y / 10) * 10
  const rootRank = yLevels.indexOf(rootY)

  const generationByNodeId = new Map<string, number>()
  for (const n of personNodes) {
    const rank = yLevels.indexOf(Math.round(n.position.y / 10) * 10)
    if (rank !== -1) generationByNodeId.set(n.id, rank - rootRank)
  }

  const levels = yLevels.map((y, rank) => ({ generation: rank - rootRank, y }))
  return { generationByNodeId, levels }
}

/**
 * Applies a hierarchical dagre layout to family tree nodes and edges.
 *
 * Person nodes are sized at 200×76, union nodes at 14×14.
 * Edges are expected pre-transformed (CHILD: union→person, UNION: person→union)
 * so that parents rank above unions above children; this function uses them as-is.
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
  g.setGraph({ rankdir: 'TB', ranksep: 70, nodesep: 30 })

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

  const rawPositionedNodes = nodes.map(n => {
    const { x, y, width: w, height: h } = g.node(n.id)
    return { ...n, position: { x: x - w / 2, y: y - h / 2 } }
  })

  // Dagre positions each union node at the median x of its neighbours (parents AND
  // children), so a union with an imbalanced child count drifts off-centre from the
  // two parents who actually form it. Re-centre every union node on the midpoint of
  // its own UNION-edge parents, overriding dagre's x for that node only.
  const rawPositionById = new Map(rawPositionedNodes.map(n => [n.id, n]))
  const unionParentCenterXs = new Map<string, number[]>()
  edges.forEach(e => {
    if (e.label !== 'UNION') return
    const parent = rawPositionById.get(e.source)
    if (!parent) return
    const { w } = nodeSize(parent.type)
    const centerXs = unionParentCenterXs.get(e.target) ?? []
    centerXs.push(parent.position.x + w / 2)
    unionParentCenterXs.set(e.target, centerXs)
  })

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  // Same nodesep dagre used when laying out the graph — the minimum gap we must
  // preserve between a repositioned union and any rank-mate's occupied x-span.
  const NODE_GAP = 30

  const positionedNodes = rawPositionedNodes.map(n => {
    const { w, h } = nodeSize(n.type)
    const parentCenterXs = n.type === 'union' ? unionParentCenterXs.get(n.id) : undefined
    let px = n.position.x
    if (parentCenterXs?.length) {
      const candidateX = parentCenterXs.reduce((a, b) => a + b, 0) / parentCenterXs.length - w / 2
      // Only take dagre's median-based x if the mean-parent-x override wouldn't
      // collide with another node occupying the same rank. Otherwise keep dagre's
      // own (collision-free) position rather than pushing the union on top of a
      // sibling union or person node.
      const collidesWithRankMate = rawPositionedNodes.some(other => {
        if (other.id === n.id || other.position.y !== n.position.y) return false
        const { w: ow } = nodeSize(other.type)
        return candidateX < other.position.x + ow + NODE_GAP && candidateX + w + NODE_GAP > other.position.x
      })
      if (!collidesWithRankMate) px = candidateX
    }
    const py = n.position.y
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px + w > maxX) maxX = px + w
    if (py + h > maxY) maxY = py + h
    return { ...n, position: { x: px, y: py } }
  })

  // Derive signed generations from laid-out y-positions (requires layout to be complete first)
  const { generationByNodeId, levels: generationLevels } = options?.rootId
    ? generationsFromLayout(positionedNodes, options.rootId)
    : { generationByNodeId: new Map<string, number>(), levels: [] as GenerationLevel[] }

  const finalNodes = positionedNodes.map(n => {
    const generation = generationByNodeId.get(n.id)
    return generation !== undefined ? { ...n, data: { ...n.data, generation } } : n
  })

  return {
    nodes: finalNodes,
    edges,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    generationLevels,
  }
}
