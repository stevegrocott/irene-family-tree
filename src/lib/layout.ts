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

/** Same nodesep dagre is configured with — the minimum clear gap the separation
 * sweep keeps between any two boxes on one rank. */
const NODE_GAP = 30

/** Feasibility is decided on floats derived from dagre's own layout, so an
 * exactly-`NODE_GAP`-apart pair can read as `29.999999999` apart. This slack stops
 * that last-bit drift being mistaken for a genuine constraint conflict. */
const FEASIBILITY_EPSILON = 1e-6

/**
 * One node competing for horizontal space on a single dagre rank.
 */
export interface RankMember {
  /** Left-edge x dagre assigned. Used as the anchor for a member with no parent span. */
  x: number
  /** Node width in pixels. */
  w: number
  /**
   * Centre x of each in-view UNION-edge parent of this member.
   *
   * Non-empty ⇒ the member's final centre x must land inside `[min, max]` of these
   * values (issue #219 AC2). Empty or omitted ⇒ the member carries no span
   * constraint and is simply anchored at `x`.
   */
  parentCenterXs?: number[]
  /**
   * `false` ⇒ the sweep must not move this member; it stays exactly at `x` and acts
   * as a hard obstacle. Person nodes are positioned by dagre and are never moved by
   * this pass. Defaults to `true`.
   */
  movable?: boolean
}

/** Result of laying out one rank. */
export interface RankLayout {
  /** Final left-edge x per member, in the order the members were supplied. */
  xs: number[]
  /**
   * Indices of members whose final centre x fell outside their own parent span.
   *
   * Always empty when a span-satisfying arrangement exists. Non-empty only in the
   * residual-infeasibility case documented on {@link resolveRankXs}.
   */
  spanRelaxed: number[]
}

/** Internal, fully-resolved view of a {@link RankMember}. */
interface PreparedMember {
  /** Index into the caller's `members` array. */
  index: number
  w: number
  /** Where the member would sit with the rank all to itself. */
  ideal: number
  /** Hard lower/upper bound on the left-edge x. `±Infinity` when unconstrained. */
  lo: number
  hi: number
  /** True when `lo`/`hi` come from a parent span that may be relaxed under conflict. */
  hasSpan: boolean
  /** Seed x, used only to break ties between equal ideals. */
  seed: number
}

/**
 * Lay out every node on one dagre rank so that all three of these hold at once:
 *
 * 1. **Parent span (issue #219 AC2)** — each union's centre x stays within the
 *    min/max centre x of its own parents.
 * 2. **Collision-freedom** — consecutive boxes keep `NODE_GAP` clearance.
 * 3. **Order** — members stay in the left-to-right order their ideal positions
 *    imply, which for a union is the order its parents imply (issue #219's original
 *    misattribution guard).
 *
 * The previous implementation placed one union at a time and treated every rank-mate
 * as immovable, so when a union's parents sat close together beside a neighbour there
 * was no x satisfying both (1) and (2) and it had to break one of them. This pass
 * displaces the *neighbours* instead: given freedom to spread the rank wider, a
 * solution exists whenever the movable members' spans allow it.
 *
 * ## Algorithm
 *
 * Members are ordered once, by ideal position, and that order never changes — so the
 * sweep cannot regress and needs no unbounded iteration. Two bound propagations then
 * decide feasibility before anything is placed:
 *
 * - `L[i]` — the leftmost x member *i* can take given every member to its left.
 * - `U[i]` — the rightmost x member *i* can take given every member to its right.
 *
 * `L[i] <= U[i]` for all *i* ⇔ a solution satisfying every constraint exists, and a
 * single left-to-right pass taking `clamp(ideal, max(L[i], previousEnd), U[i])` finds
 * one.
 *
 * ## Residual infeasibility
 *
 * Two unions whose parent spans overlap and are each narrower than
 * `NODE_GAP + width` cannot both stay inside their spans without also moving the
 * *person* nodes on the rank above — which this pass deliberately does not do (that
 * would cascade through every rank of the tree). The same is true of a union pinned
 * against an immovable (`movable: false`) neighbour.
 *
 * The chosen behaviour is: **collision-freedom and ordering are absolute; the parent
 * span is the only constraint ever relaxed, only for the members provably involved in
 * the conflict, and every relaxation is reported in `spanRelaxed`.** Overlapping nodes
 * are never an acceptable outcome, and a silent relaxation is never an acceptable
 * outcome either — a caller can always see which members were relaxed and by how much.
 *
 * Relaxation runs as a bounded loop: each round drops the span of at least one member
 * that anchors the conflict, so it terminates in at most `members.length` rounds. If a
 * round finds a conflict it cannot resolve that way (only possible when immovable
 * members conflict with each other), the sweep falls back to pure greedy separation,
 * which is always satisfiable.
 *
 * @param members - Every node on the rank, in any order
 * @returns Final left-edge x per member plus the indices whose span was relaxed
 */
export function resolveRankXs(members: RankMember[]): RankLayout {
  if (members.length === 0) return { xs: [], spanRelaxed: [] }

  const prepared: PreparedMember[] = members.map((m, index) => {
    const movable = m.movable !== false
    const parentCenterXs = m.parentCenterXs ?? []
    const hasSpan = movable && parentCenterXs.length > 0
    if (hasSpan) {
      const mean = parentCenterXs.reduce((a, b) => a + b, 0) / parentCenterXs.length
      return {
        index,
        w: m.w,
        seed: m.x,
        hasSpan,
        ideal: mean - m.w / 2,
        lo: Math.min(...parentCenterXs) - m.w / 2,
        hi: Math.max(...parentCenterXs) - m.w / 2,
      }
    }
    // No span: a movable member floats freely around its dagre seed, an immovable one
    // is pinned to it.
    return {
      index,
      w: m.w,
      seed: m.x,
      hasSpan,
      ideal: m.x,
      lo: movable ? -Infinity : m.x,
      hi: movable ? Infinity : m.x,
    }
  })

  // Fix the left-to-right order once, by ideal position — for a union that is the mean
  // of its parents' centres, so this is exactly the order the parents imply. Ties fall
  // back to the dagre seed and then to input index so the result is deterministic.
  const order = [...prepared].sort(
    (a, b) => a.ideal - b.ideal || a.seed - b.seed || a.index - b.index,
  )

  /** Spans dropped so far, by `prepared` index. */
  const relaxed = new Set<number>()
  const loOf = (p: PreparedMember) => (relaxed.has(p.index) ? -Infinity : p.lo)
  const hiOf = (p: PreparedMember) => (relaxed.has(p.index) ? Infinity : p.hi)

  const xs = new Array<number>(members.length)

  /** Place every member left-to-right inside the supplied feasible bounds. */
  const placeWithin = (L: number[], U: number[]) => {
    let previousEnd = -Infinity
    order.forEach((p, i) => {
      // L[i] <= U[i] (feasibility) and previousEnd <= U[i] (because the previous
      // member was itself capped at U[i-1] <= U[i] - w - NODE_GAP), so this clamp is
      // always well-defined and always yields a separated, in-bounds position.
      const x = Math.min(Math.max(p.ideal, L[i], previousEnd), U[i])
      xs[p.index] = x
      previousEnd = x + p.w + NODE_GAP
    })
  }

  let placed = false
  // At most one round per member: every round that finds a conflict drops at least one
  // span, and there are only `members.length` spans to drop.
  for (let round = 0; round <= members.length && !placed; round++) {
    // Leftmost feasible x per member, propagated left-to-right, tracking which member's
    // own lower bound is currently forcing it.
    const L: number[] = []
    const anchorL: number[] = []
    order.forEach((p, i) => {
      const own = loOf(p)
      const pushed = i === 0 ? -Infinity : L[i - 1] + order[i - 1].w + NODE_GAP
      if (own >= pushed) {
        L[i] = own
        anchorL[i] = i
      } else {
        L[i] = pushed
        anchorL[i] = anchorL[i - 1]
      }
    })

    // Rightmost feasible x per member, propagated right-to-left, same anchor tracking.
    const U: number[] = []
    const anchorU: number[] = []
    for (let i = order.length - 1; i >= 0; i--) {
      const own = hiOf(order[i])
      const pulled = i === order.length - 1 ? Infinity : U[i + 1] - order[i].w - NODE_GAP
      if (own <= pulled) {
        U[i] = own
        anchorU[i] = i
      } else {
        U[i] = pulled
        anchorU[i] = anchorU[i + 1]
      }
    }

    const conflict = L.findIndex((lower, i) => lower > U[i] + FEASIBILITY_EPSILON)
    if (conflict === -1) {
      placeWithin(L, U)
      placed = true
      break
    }

    // The conflict is between one member's lower bound and another's upper bound. Drop
    // whichever of those two anchors still carries a relaxable parent span.
    let dropped = false
    for (const anchor of [anchorL[conflict], anchorU[conflict]]) {
      const p = order[anchor]
      if (p.hasSpan && !relaxed.has(p.index)) {
        relaxed.add(p.index)
        dropped = true
      }
    }
    if (!dropped) break
  }

  if (!placed) {
    // Last resort: immovable members conflict with each other, so no combination of
    // span relaxations helps. Pure greedy separation — always satisfiable, keeps the
    // order and the clearance, and may shift an otherwise-immovable member right.
    let previousEnd = -Infinity
    for (const p of order) {
      const x = Math.max(p.ideal, previousEnd)
      xs[p.index] = x
      previousEnd = x + p.w + NODE_GAP
    }
  }

  // Report relaxations from the result itself rather than from the bookkeeping above,
  // so `spanRelaxed` always describes what actually happened to the positions.
  const spanRelaxed = prepared
    .filter(
      p =>
        p.hasSpan &&
        (xs[p.index] < p.lo - FEASIBILITY_EPSILON || xs[p.index] > p.hi + FEASIBILITY_EPSILON),
    )
    .map(p => p.index)

  return { xs, spanRelaxed }
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
    // Carry dagre's computed width/height onto the node itself (not just its position).
    // React Flow uses node.width/height to know a node's dimensions are already known;
    // without them, nodes are "unmeasured" until a ResizeObserver pass fires after first
    // render, leaving stale/zero bounds in React Flow's internal node lookup in the
    // meantime — which breaks click-to-select hit-testing on the very first interaction.
    return { ...n, position: { x: x - w / 2, y: y - h / 2 }, width: w, height: h }
  })

  // Dagre positions each union node at the median x of its neighbours (parents AND
  // children), so a union with an imbalanced child count drifts off-centre from the
  // two parents who actually form it. Collect each union's UNION-edge parent centres
  // so the per-rank pass below can re-centre it on them, overriding dagre's x for
  // union nodes only.
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

  // Working positions, seeded from dagre's raw layout and overwritten rank by rank.
  const workingPositionXs = new Map(rawPositionedNodes.map(n => [n.id, n.position.x]))

  // Group by rank. `position.y` is the top-left corner, so equal `position.y` means
  // both the same dagre rank *and* the same node height — exactly the neighbours whose
  // boxes can actually overlap horizontally.
  const rankBuckets = new Map<number, typeof rawPositionedNodes>()
  for (const n of rawPositionedNodes) {
    const bucket = rankBuckets.get(n.position.y)
    if (bucket) bucket.push(n)
    else rankBuckets.set(n.position.y, [n])
  }

  // Solve each rank as a whole rather than placing unions one at a time. A single
  // union may not be able to sit inside its parents' span without overlapping a
  // rank-mate, but the rank as a whole can always spread to make room — see
  // `resolveRankXs`. Ranks are independent, so bucket iteration order is irrelevant.
  for (const bucket of rankBuckets.values()) {
    if (!bucket.some(n => n.type === 'union')) continue
    const members: RankMember[] = bucket.map(n => ({
      x: n.position.x,
      w: nodeSize(n.type).w,
      // Only union nodes are re-positioned here; person nodes keep dagre's x and act
      // as fixed obstacles. A union with no in-view parent has no span to honour, so
      // it simply holds its dagre position unless a neighbour needs the room.
      parentCenterXs: n.type === 'union' ? unionParentCenterXs.get(n.id) ?? [] : undefined,
      movable: n.type === 'union',
    }))
    const { xs } = resolveRankXs(members)
    bucket.forEach((n, i) => workingPositionXs.set(n.id, xs[i]))
  }

  const positionedNodes = rawPositionedNodes.map(n => {
    const { w, h } = nodeSize(n.type)
    const px = workingPositionXs.get(n.id) ?? n.position.x
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
