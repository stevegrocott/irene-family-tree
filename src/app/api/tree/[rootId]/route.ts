import { read } from '@/lib/neo4j'
import { FlowNode, FlowEdge, TreeResponse, PersonData, UnionData } from '@/types/tree'

export const runtime = 'nodejs'

/** Maximum number of nodes returned per query to guard against unbounded graph traversal. */
const MAX_NODES = 500
/** Default relationship hop depth used when no `hops` query parameter is provided. */
const DEFAULT_HOPS = 8
/** Maximum allowed value for the `hops` query parameter. */
const MAX_HOPS = 16
/** Neo4j label used to identify Union (family) nodes. */
const UNION_LABEL = 'Union'

/**
 * Raw shape of a graph node as returned by the Neo4j bounce-traversal query.
 * Person nodes carry demographic fields; Union nodes carry only `gedcomId`.
 */
interface Neo4jNode {
  _id: string
  _labels: string[]
  name?: string
  sex?: string
  birthYear?: string | null
  deathYear?: string | null
  gedcomId: string
}

/**
 * Raw shape of a graph relationship as returned by the Neo4j query.
 * `start` and `end` are element IDs corresponding to `Neo4jNode._id`.
 */
interface Neo4jRel {
  _id: string
  type: string
  start: string
  end: string
}

/**
 * Returns a family-tree subgraph centred on the given person.
 *
 * Uses a "bounce-traversal" Cypher query that walks outward two generations in
 * both directions (grandparents → root → grandchildren) via Union intermediary
 * nodes, then maps the raw Neo4j result to React Flow `FlowNode` / `FlowEdge`
 * shapes with placeholder positions.
 *
 * @param request  - Incoming HTTP request; the optional `hops` query param controls traversal depth.
 * @param params   - Route segment params; `rootId` is the GEDCOM ID of the focal person.
 * @returns JSON `TreeResponse` on success, or a 404/500 error JSON on failure.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ rootId: string }> }
) {
  const { rootId } = await params

  // Parse and validate the ?hops=N query parameter
  const url = new URL(request.url)
  const hopsParam = url.searchParams.get('hops')
  let hops: number

  if (hopsParam === null) {
    hops = DEFAULT_HOPS
  } else {
    // Must be a whole-number integer string (no decimals, no non-numeric chars)
    if (!/^\d+$/.test(hopsParam)) {
      return Response.json({ error: 'hops must be a positive integer' }, { status: 400 })
    }
    hops = parseInt(hopsParam, 10)
    if (hops < 1) {
      return Response.json({ error: 'hops must be at least 1' }, { status: 400 })
    }
    hops = Math.min(hops, MAX_HOPS)
  }

  let rows: { nodes: Neo4jNode[]; rels: Neo4jRel[] }[]
  try {
    rows = await read<{ nodes: Neo4jNode[]; rels: Neo4jRel[] }>(
      `MATCH (root:Person {gedcomId: $id})

       // Walk the family graph in any direction — each generation costs 2 hops
       // (Person→Union then Union←Person), so 8 hops covers 4 generations each way.
       OPTIONAL MATCH (root)-[:CHILD|UNION*1..${hops}]-(other)
       WHERE other:Person OR other:Union

       WITH root, ([root] + collect(DISTINCT other))[0..$maxNodes] AS allNodes

       // Collect every edge that connects two nodes in the result set
       UNWIND allNodes AS n
       OPTIONAL MATCH (n)-[r:CHILD|UNION]-(m)
       WHERE m IN allNodes

       WITH allNodes, collect(DISTINCT r) AS allRels

       RETURN [n IN allNodes | CASE
         WHEN 'Person' IN labels(n) THEN
           {_id: elementId(n), _labels: labels(n), name: n.name, sex: n.sex,
            birthYear: n.birthYear, deathYear: n.deathYear, gedcomId: n.gedcomId}
         ELSE
           {_id: elementId(n), _labels: labels(n), gedcomId: n.gedcomId}
        END] AS nodes,
       [r IN allRels | {
         _id:   elementId(r),
         type:  type(r),
         start: elementId(startNode(r)),
         end:   elementId(endNode(r))
       }] AS rels`,
      { id: rootId, maxNodes: MAX_NODES }
    )
  } catch (err) {
    console.error('Neo4j query failed', err)
    return Response.json({ error: 'Failed to query graph database' }, { status: 500 })
  }

  if (!rows.length) return Response.json({ error: 'Person not found' }, { status: 404 })

  const { nodes, rels } = rows[0]

  const flowNodes: FlowNode[] = nodes.map((n) => {
    const isUnion = n._labels.includes(UNION_LABEL)
    return isUnion
      ? { id: n._id, type: 'union' as const, data: { gedcomId: n.gedcomId } as UnionData, position: { x: 0, y: 0 } }
      : {
          id: n._id,
          type: 'person' as const,
          data: {
            gedcomId: n.gedcomId,
            name: n.name ?? '',
            sex: n.sex ?? '',
            birthYear: n.birthYear ?? null,
            deathYear: n.deathYear ?? null,
          } as PersonData,
          position: { x: 0, y: 0 },
        }
  })

  const flowEdges: FlowEdge[] = rels.map((r) => ({
    id: r._id,
    source: r.start,
    target: r.end,
    label: r.type,
  }))

  return Response.json({ nodes: flowNodes, edges: flowEdges } satisfies TreeResponse)
}
