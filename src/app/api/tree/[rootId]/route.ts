import { read } from '@/lib/neo4j'
import { FlowNode, FlowEdge, TreeResponse, PersonData, UnionData } from '@/types/tree'
import { MIN_HOPS, DEFAULT_HOPS, MAX_HOPS, UNION_LABEL } from '@/constants/tree'

export const runtime = 'nodejs'

const MAX_NODES = 500

/**
 * Raw shape of a graph node as returned by the Neo4j bounce-traversal query.
 * Person nodes carry demographic fields; Union nodes carry only `gedcomId`.
 *
 * @interface Neo4jNode
 * @property {string} _id - Unique Neo4j element ID
 * @property {string[]} _labels - Node labels (e.g., ['Person'] or ['Union'])
 * @property {string} [name] - Person's full name (Person nodes only)
 * @property {string} [sex] - Person's sex/gender (Person nodes only)
 * @property {string | null} [birthYear] - Birth year as string (Person nodes only)
 * @property {string | null} [deathYear] - Death year as string (Person nodes only)
 * @property {string} gedcomId - GEDCOM cross-reference identifier
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
 *
 * @interface Neo4jRel
 * @property {string} _id - Unique Neo4j element ID for the relationship
 * @property {string} type - Relationship type (e.g., 'UNION', 'CHILD')
 * @property {string} start - Element ID of the start node
 * @property {string} end - Element ID of the end node
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
 * Query Parameters:
 * - `hops` (optional): Number of relationship hops to traverse from root person
 *   (default: DEFAULT_HOPS, range: MIN_HOPS to MAX_HOPS, clamped if exceeds max)
 *
 * @async
 * @param {Request} request - Incoming HTTP request; the optional `hops` query param controls traversal depth
 * @param {Object} params - Route segment params object
 * @param {Promise<{ rootId: string }>} params.params - Promise resolving to route params
 * @returns {Promise<Response>} JSON `TreeResponse` on success, or error JSON with 400/404/500 status
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ rootId: string }> }
) {
  const { rootId } = await params

  const url = new URL(request.url)
  const hopsParam = url.searchParams.get('hops')
  let hops: number

  if (hopsParam === null) {
    hops = DEFAULT_HOPS
  } else if (!/^\d+$/.test(hopsParam)) {
    return Response.json({ error: 'hops must be a positive integer' }, { status: 400 })
  } else {
    hops = parseInt(hopsParam, 10)
    if (hops < MIN_HOPS) {
      return Response.json({ error: 'hops must be at least 1' }, { status: 400 })
    }
    hops = Math.min(hops, MAX_HOPS)
  }

  let rows: { nodes: Neo4jNode[]; rels: Neo4jRel[] }[]
  try {
    rows = await read<{ nodes: Neo4jNode[]; rels: Neo4jRel[] }>(
      `MATCH (root:Person {gedcomId: $id})

       OPTIONAL MATCH (root)-[:CHILD|UNION*1..${hops}]-(other)
       WHERE other:Person OR other:Union

       WITH root, ([root] + collect(DISTINCT other))[0..$maxNodes] AS allNodes

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
