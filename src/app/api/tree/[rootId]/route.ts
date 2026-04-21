import { read } from '@/lib/neo4j'
import { FlowNode, FlowEdge, TreeResponse, PersonData, UnionData } from '@/types/tree'

export const runtime = 'nodejs'

const MAX_TREE_DEPTH = 8
const MAX_NODES = 500
const UNION_LABEL = 'Union'

interface Neo4jNode {
  _id: string
  _labels: string[]
  name?: string
  sex?: string
  birthYear?: string | null
  deathYear?: string | null
  gedcomId: string
}

interface Neo4jRel {
  _id: string
  type: string
  start: string
  end: string
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ rootId: string }> }
) {
  const { rootId } = await params

  let rows: { nodes: Neo4jNode[]; rels: Neo4jRel[] }[]
  try {
    rows = await read<{ nodes: Neo4jNode[]; rels: Neo4jRel[] }>(
      `MATCH (root:Person {gedcomId: $id})
       OPTIONAL MATCH (root)-[:UNION|CHILD*1..4]->(desc)
       OPTIONAL MATCH (anc)-[:UNION|CHILD*1..4]->(root)
       WITH root, collect(DISTINCT desc) AS descendants, collect(DISTINCT anc) AS ancestors
       WITH [root] + descendants + ancestors AS allNodes
       CALL (allNodes) {
         UNWIND allNodes AS n
         MATCH (n)-[r:UNION|CHILD]->(m)
         WHERE m IN allNodes
         RETURN collect(DISTINCT r) AS allRels
       }
       WITH allNodes[0..$maxNodes] AS nodes, allRels
       RETURN [nd IN nodes | CASE
         WHEN 'Person' IN labels(nd) THEN
           {_id: elementId(nd), _labels: labels(nd), name: nd.name, sex: nd.sex,
            birthYear: nd.birthYear, deathYear: nd.deathYear, gedcomId: nd.gedcomId}
         ELSE
           {_id: elementId(nd), _labels: labels(nd), gedcomId: nd.gedcomId}
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
    relType: r.type,
  }))

  return Response.json({ nodes: flowNodes, edges: flowEdges } satisfies TreeResponse)
}
