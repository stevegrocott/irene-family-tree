import { read } from '@/lib/neo4j'
import { FlowNode, FlowEdge, TreeResponse } from '@/types/tree'

export const runtime = 'nodejs'

export async function GET(_: Request, { params }: { params: { rootId: string } }) {
  const rows = await read<{ nodes: any[]; rels: any[] }>(
    `MATCH (root:Person {gedcomId: $id})
     CALL apoc.path.subgraphAll(root, {
       relationshipFilter: 'UNION>|CHILD>',
       maxLevel: 8
     }) YIELD nodes, relationships
     RETURN [n IN nodes | n {.*, _id: elementId(n), _labels: labels(n)}] AS nodes,
            [r IN relationships | {
              _id:   elementId(r),
              type:  type(r),
              start: elementId(startNode(r)),
              end:   elementId(endNode(r))
            }] AS rels`,
    { id: params.rootId }
  )

  if (!rows.length) return Response.json({ error: 'Person not found' }, { status: 404 })

  const { nodes, rels } = rows[0]

  const flowNodes: FlowNode[] = nodes.map((n: any) => ({
    id:       n._id,
    type:     n._labels.includes('Union') ? 'union' : 'person',
    data:     n,
    position: { x: 0, y: 0 },
  }))

  const flowEdges: FlowEdge[] = rels.map((r: any) => ({
    id:     r._id,
    source: r.start,
    target: r.end,
    label:  r.type,
  }))

  return Response.json({ nodes: flowNodes, edges: flowEdges } satisfies TreeResponse)
}
