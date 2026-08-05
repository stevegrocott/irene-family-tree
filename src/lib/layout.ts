/**
 * @fileoverview Layout algorithms for family tree visualization.
 * Uses the Dagre graph layout library to automatically position nodes in a hierarchical tree structure.
 */

import dagre from '@dagrejs/dagre'
import { Node, Edge } from 'reactflow'

/** Width of a person node in pixels. */
export const PERSON_W = 240
/** Height of a person node in pixels. */
const PERSON_H = 76
/** Width of a union (marriage) node in pixels. */
export const UNION_W = 14
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

/** Same nodesep dagre is configured with — the minimum gap a re-centred union must
 * keep from any rank-mate's occupied x-span. */
const NODE_GAP = 30

/**
 * Resolve the final left-edge x for one union node during the re-centering pass.
 *
 * The union wants the mean of its parents' centre x values ("ideal"). If that lands
 * on top of a same-rank neighbour it is snapped to the nearer edge of the occupied
 * range, then bounded to stay inside its own parents' horizontal span (AC2 of #219).
 *
 * Exported for unit testing: dagre's crossing-minimisation reorders synthetic graphs
 * to avoid same-rank union collisions, so the clamp branch is not reachable from a
 * small `applyDagreLayout` fixture and must be exercised directly.
 *
 * @param parentCenterXs - Centre x of each in-view UNION-edge parent (non-empty)
 * @param w - Width of the union node being placed
 * @param rankMates - Same-rank neighbours as `{ x: left edge, w: width }`, using each
 *   neighbour's current working position (post-clamp if already processed this pass)
 * @returns The union's left-edge x
 */
export function resolveUnionX({
  parentCenterXs,
  w,
  rankMates,
}: {
  parentCenterXs: number[]
  w: number
  rankMates: Array<{ x: number; w: number }>
}): number {
  const idealX = parentCenterXs.reduce((a, b) => a + b, 0) / parentCenterXs.length - w / 2

  // Derive the x-ranges a `w`-wide box must avoid to keep NODE_GAP clearance from
  // every rank-mate, then merge overlaps so a snap lands clear of all of them rather
  // than only the first one it escapes.
  const forbidden = rankMates
    .map(other => ({ lo: other.x - w - NODE_GAP, hi: other.x + other.w + NODE_GAP }))
    .sort((a, b) => a.lo - b.lo)

  const merged: { lo: number; hi: number }[] = []
  for (const range of forbidden) {
    const last = merged[merged.length - 1]
    if (last && range.lo <= last.hi) {
      last.hi = Math.max(last.hi, range.hi)
    } else {
      merged.push({ ...range })
    }
  }

  const collision = merged.find(r => idealX > r.lo && idealX < r.hi)
  // No rank-mate in the way: take the mean-parent-x position outright.
  if (!collision) return idealX

  // Snap to whichever edge of the occupied range sits closer to the ideal x, so the
  // union stays as near its parents as it can without overlapping a rank-mate.
  const snapped = idealX - collision.lo <= collision.hi - idealX ? collision.lo : collision.hi
  // Then keep it within its own parents' span — the snap only knows about neighbours,
  // so without this bound it can push the union outside its parents' min/max centre.
  const minParentX = Math.min(...parentCenterXs) - w / 2
  const maxParentX = Math.max(...parentCenterXs) - w / 2
  return Math.min(Math.max(snapped, minParentX), maxParentX)
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
    // The relationship type arrives either as the edge's `label` (unit tests build
    // edges this way directly) or as `data.relType` (the real app's shape — see
    // FamilyTree.tsx, which deliberately leaves `label` unset so React Flow never
    // renders it as visible edge text, per issue #198).
    const relType = e.label ?? (e.data as { relType?: string } | undefined)?.relType
    if (relType !== 'UNION') return
    const parent = rawPositionById.get(e.source)
    if (!parent) return
    const { w } = nodeSize(parent.type)
    const centerXs = unionParentCenterXs.get(e.target) ?? []
    centerXs.push(parent.position.x + w / 2)
    unionParentCenterXs.set(e.target, centerXs)
  })

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  // Mutable working positions, seeded from dagre's raw layout and updated in place
  // as each union is clamped below. Same-rank collision checks read from this map
  // instead of `rawPositionedNodes` so a union processed later in this pass sees the
  // *final* (post-clamp) position of an already-processed rank-mate rather than its
  // stale pre-centering one — otherwise two same-rank unions can each independently
  // clamp toward the other's original slot and cross, reintroducing issue #219.
  const workingPositionXs = new Map(rawPositionedNodes.map(n => [n.id, n.position.x]))

  const positionedNodes = rawPositionedNodes.map(n => {
    const { w, h } = nodeSize(n.type)
    const parentCenterXs = n.type === 'union' ? unionParentCenterXs.get(n.id) : undefined
    let px = n.position.x
    if (parentCenterXs?.length) {
      const rankMates = rawPositionedNodes
        .filter(other => other.id !== n.id && other.position.y === n.position.y)
        .map(other => ({
          // Each neighbour's *current working* position — final if it was already
          // clamped earlier in this pass, otherwise dagre's original collision-free x.
          x: workingPositionXs.get(other.id) ?? other.position.x,
          w: nodeSize(other.type).w,
        }))
      px = resolveUnionX({ parentCenterXs, w, rankMates })
    }
    const py = n.position.y
    if (n.type === 'union') workingPositionXs.set(n.id, px)
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
