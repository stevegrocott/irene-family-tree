import { read } from '@/lib/neo4j'
import { FlowNode, FlowEdge, TreeResponse, PersonData, UnionData } from '@/types/tree'

export const runtime = 'nodejs'

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

       OPTIONAL MATCH (root)-[rBU:CHILD]->(birthUnion:Union)
       OPTIONAL MATCH (parent:Person)-[rPar:UNION]->(birthUnion)

       OPTIONAL MATCH (root)-[rMU:UNION]->(marriageUnion:Union)
       OPTIONAL MATCH (marriageUnion)<-[rChild:CHILD]-(child:Person)

       OPTIONAL MATCH (parent)-[rGPU:CHILD]->(gpUnion:Union)
       OPTIONAL MATCH (grandparent:Person)-[rGP:UNION]->(gpUnion)

       OPTIONAL MATCH (child)-[rGCMU:UNION]->(gcUnion:Union)
       OPTIONAL MATCH (gcUnion)<-[rGC:CHILD]-(grandchild:Person)

       WITH root,
            collect(DISTINCT birthUnion) AS birthUnions,
            collect(DISTINCT parent) AS parents,
            collect(DISTINCT marriageUnion) AS marriageUnions,
            collect(DISTINCT child) AS children,
            collect(DISTINCT gpUnion) AS gpUnions,
            collect(DISTINCT grandparent) AS grandparents,
            collect(DISTINCT gcUnion) AS gcUnions,
            collect(DISTINCT grandchild) AS grandchildren,
            collect(DISTINCT rBU) AS relsBU,
            collect(DISTINCT rPar) AS relsPar,
            collect(DISTINCT rMU) AS relsMU,
            collect(DISTINCT rChild) AS relsChild,
            collect(DISTINCT rGPU) AS relsGPU,
            collect(DISTINCT rGP) AS relsGP,
            collect(DISTINCT rGCMU) AS relsGCMU,
            collect(DISTINCT rGC) AS relsGC

       WITH [n IN ([root] + birthUnions + parents + marriageUnions + children +
                   gpUnions + grandparents + gcUnions + grandchildren)
             WHERE n IS NOT NULL][0..$maxNodes] AS allNodes,
            relsBU + relsPar + relsMU + relsChild + relsGPU + relsGP + relsGCMU + relsGC AS allRels

       RETURN [n IN allNodes | CASE
         WHEN 'Person' IN labels(n) THEN
           {_id: elementId(n), _labels: labels(n), name: n.name, sex: n.sex,
            birthYear: n.birthYear, deathYear: n.deathYear, gedcomId: n.gedcomId}
         ELSE
           {_id: elementId(n), _labels: labels(n), gedcomId: n.gedcomId}
        END] AS nodes,
       [r IN allRels WHERE r IS NOT NULL | {
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
