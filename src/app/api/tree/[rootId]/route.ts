import { read } from '@/lib/neo4j'
import { FlowNode, FlowEdge, TreeResponse, PersonData, UnionData, REL } from '@/types/tree'

export const runtime = 'nodejs'

const RELATIONSHIP_FILTER = `${REL.UNION}|${REL.CHILD}`
const DEFAULT_MAX_LEVEL = 8
const MAX_NODES = 500
const UNION_LABEL = 'Union'

interface Neo4jPersonNode {
  _id: string
  _labels: string[]
  gedcomId: string
  name?: string
  givenName?: string
  surname?: string
  sex?: string
  birthDate?: string | null
  birthYear?: string | null
  birthPlace?: string | null
  deathDate?: string | null
  deathYear?: string | null
  deathPlace?: string | null
  occupation?: string | null
  notes?: string | null
}
interface Neo4jUnionNode {
  _id: string
  _labels: string[]
  gedcomId: string
  marriageDate?: string | null
  marriageYear?: string | null
  marriagePlace?: string | null
}
type Neo4jNode = Neo4jPersonNode | Neo4jUnionNode

interface Neo4jRel {
  _id: string
  type: string
  start: string
  end: string
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ rootId: string }> }
) {
  const { rootId } = await params
  const url = new URL(request.url)
  const maxLevel = Math.min(
    Math.max(parseInt(url.searchParams.get('depth') ?? String(DEFAULT_MAX_LEVEL), 10) || DEFAULT_MAX_LEVEL, 1),
    12
  )

  let rows: { nodes: Neo4jNode[]; rels: Neo4jRel[] }[]
  try {
    rows = await read<{ nodes: Neo4jNode[]; rels: Neo4jRel[] }>(
      `MATCH (root:Person {gedcomId: $id})
       CALL apoc.path.subgraphAll(root, {
         relationshipFilter: $relationshipFilter,
         maxLevel: $maxLevel
       }) YIELD nodes, relationships
       WITH nodes[0..$maxNodes] AS nodes, relationships
       RETURN [n IN nodes | CASE
         WHEN 'Person' IN labels(n) THEN
           {_id: elementId(n), _labels: labels(n),
            gedcomId: n.gedcomId, name: n.name,
            givenName: n.givenName, surname: n.surname, sex: n.sex,
            birthDate: n.birthDate, birthYear: n.birthYear, birthPlace: n.birthPlace,
            deathDate: n.deathDate, deathYear: n.deathYear, deathPlace: n.deathPlace,
            occupation: n.occupation, notes: n.notes}
         ELSE
           {_id: elementId(n), _labels: labels(n), gedcomId: n.gedcomId,
            marriageDate: n.marriageDate, marriageYear: n.marriageYear, marriagePlace: n.marriagePlace}
        END] AS nodes,
              [r IN relationships | {
                _id:   elementId(r),
                type:  type(r),
                start: elementId(startNode(r)),
                end:   elementId(endNode(r))
              }] AS rels`,
      { id: rootId, relationshipFilter: RELATIONSHIP_FILTER, maxLevel, maxNodes: MAX_NODES }
    )
  } catch (err) {
    console.error('Neo4j query failed', err)
    return Response.json({ error: 'Failed to query graph database' }, { status: 500 })
  }

  if (!rows.length) return Response.json({ error: 'Person not found' }, { status: 404 })

  const { nodes, rels } = rows[0]
  const rootInternalId = nodes.find((n) => n.gedcomId === rootId)?._id

  const flowNodes: FlowNode[] = nodes.map((n) => {
    const isUnion = n._labels.includes(UNION_LABEL)
    if (isUnion) {
      const u = n as Neo4jUnionNode
      return {
        id: u._id,
        type: 'union' as const,
        data: {
          gedcomId: u.gedcomId,
          marriageDate: u.marriageDate ?? null,
          marriageYear: u.marriageYear ?? null,
          marriagePlace: u.marriagePlace ?? null,
        } as UnionData,
        position: { x: 0, y: 0 },
      }
    }
    const p = n as Neo4jPersonNode
    return {
      id: p._id,
      type: 'person' as const,
      data: {
        gedcomId: p.gedcomId,
        name: p.name ?? '',
        givenName: p.givenName ?? '',
        surname: p.surname ?? '',
        sex: p.sex ?? '',
        birthDate: p.birthDate ?? null,
        birthYear: p.birthYear ?? null,
        birthPlace: p.birthPlace ?? null,
        deathDate: p.deathDate ?? null,
        deathYear: p.deathYear ?? null,
        deathPlace: p.deathPlace ?? null,
        occupation: p.occupation ?? null,
        notes: p.notes ?? null,
        isRoot: p._id === rootInternalId,
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
