/**
 * @fileoverview Pure lineage BFS over the family tree graph.
 *
 * Computes the ancestor + descendant + spouses-at-union set for a focus
 * person, given the already-loaded nodes/edges from the tree API. Union
 * nodes are first-class (`type: 'union'`); `CHILD` edges run union→person
 * and `UNION` edges run person→union (see #180, #186).
 */

import type { FlowNode, FlowEdge } from '@/types/tree'

/** The in-lineage node and edge id set for a given focus person. */
export interface Lineage {
  nodeIds: Set<string>
  edgeIds: Set<string>
}

function pushTo<K>(map: Map<K, FlowEdge[]>, key: K, edge: FlowEdge): void {
  const existing = map.get(key)
  if (existing) existing.push(edge)
  else map.set(key, [edge])
}

/**
 * Computes the lineage (ancestors, descendants, and spouses at each union on
 * the line) for `focusId`, as a set of node ids and the edge ids connecting
 * them.
 *
 * Ancestors are found by repeatedly following a person's birth union up to
 * its parents. Descendants are found by repeatedly following a person's own
 * unions down to their children, adding the co-spouse at each union without
 * traversing that spouse's other unions — this keeps remarriages and
 * half-siblings out of the set. Runs in O(nodes + edges).
 *
 * @param nodes - All person/union nodes in the loaded graph
 * @param edges - All CHILD/UNION edges in the loaded graph
 * @param focusId - Id of the person being hovered or selected
 * @returns The in-lineage node and edge id sets; empty if `focusId` is absent from `nodes`
 */
export function computeLineage(nodes: FlowNode[], edges: FlowEdge[], focusId: string): Lineage {
  if (!nodes.some(n => n.id === focusId)) {
    return { nodeIds: new Set(), edgeIds: new Set() }
  }

  const birthEdgesByChild = new Map<string, FlowEdge[]>()
  const childEdgesByUnion = new Map<string, FlowEdge[]>()
  const unionEdgesByPerson = new Map<string, FlowEdge[]>()
  const unionEdgesByUnion = new Map<string, FlowEdge[]>()

  for (const edge of edges) {
    if (edge.label === 'CHILD') {
      pushTo(birthEdgesByChild, edge.target, edge)
      pushTo(childEdgesByUnion, edge.source, edge)
    } else if (edge.label === 'UNION') {
      pushTo(unionEdgesByPerson, edge.source, edge)
      pushTo(unionEdgesByUnion, edge.target, edge)
    }
  }

  const nodeIds = new Set<string>([focusId])
  const edgeIds = new Set<string>()

  const ancestorQueue = [focusId]
  while (ancestorQueue.length > 0) {
    const personId = ancestorQueue.shift() as string
    for (const birthEdge of birthEdgesByChild.get(personId) ?? []) {
      const unionId = birthEdge.source
      edgeIds.add(birthEdge.id)
      nodeIds.add(unionId)
      for (const parentEdge of unionEdgesByUnion.get(unionId) ?? []) {
        edgeIds.add(parentEdge.id)
        const parentId = parentEdge.source
        if (!nodeIds.has(parentId)) {
          nodeIds.add(parentId)
          ancestorQueue.push(parentId)
        }
      }
    }
  }

  const descendantQueue = [focusId]
  while (descendantQueue.length > 0) {
    const personId = descendantQueue.shift() as string
    for (const unionEdge of unionEdgesByPerson.get(personId) ?? []) {
      const unionId = unionEdge.target
      edgeIds.add(unionEdge.id)
      nodeIds.add(unionId)
      // Co-spouse joins the lineage but their other unions are not traversed.
      for (const spouseEdge of unionEdgesByUnion.get(unionId) ?? []) {
        edgeIds.add(spouseEdge.id)
        nodeIds.add(spouseEdge.source)
      }
      for (const childEdge of childEdgesByUnion.get(unionId) ?? []) {
        edgeIds.add(childEdge.id)
        const childId = childEdge.target
        if (!nodeIds.has(childId)) {
          nodeIds.add(childId)
          descendantQueue.push(childId)
        }
      }
    }
  }

  return { nodeIds, edgeIds }
}
