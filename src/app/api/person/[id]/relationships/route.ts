import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { write } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { auth } from '@/auth'

export const runtime = 'nodejs'

const VALID_TYPES = ['spouse', 'parent', 'child'] as const
type RelationshipType = typeof VALID_TYPES[number]

function atomicUpsertCypher(type: RelationshipType): string {
  if (type === 'spouse') {
    return `OPTIONAL MATCH (a:Person {gedcomId: $id})-[:UNION]->(u:Union)<-[:UNION]-(b:Person {gedcomId: $targetId})
WITH u AS existingUnion
CALL {
  WITH existingUnion
  WITH existingUnion WHERE existingUnion IS NULL
  MATCH (a:Person {gedcomId: $id}), (b:Person {gedcomId: $targetId})
  MERGE (u:Union {gedcomId: $unionId})
  MERGE (a)-[:UNION]->(u)
  MERGE (b)-[:UNION]->(u)
  RETURN u.gedcomId AS unionId, false AS existed
UNION ALL
  WITH existingUnion
  WITH existingUnion WHERE existingUnion IS NOT NULL
  RETURN existingUnion.gedcomId AS unionId, true AS existed
}
RETURN unionId, existed`
  }
  if (type === 'parent') {
    return `OPTIONAL MATCH (parent:Person {gedcomId: $targetId})-[:UNION]->(u:Union)-[:CHILD]->(child:Person {gedcomId: $id})
WITH u AS existingUnion
CALL {
  WITH existingUnion
  WITH existingUnion WHERE existingUnion IS NULL
  MATCH (child:Person {gedcomId: $id}), (parent:Person {gedcomId: $targetId})
  MERGE (u:Union {gedcomId: $unionId})
  MERGE (parent)-[:UNION]->(u)
  MERGE (u)-[:CHILD]->(child)
  RETURN u.gedcomId AS unionId, false AS existed
UNION ALL
  WITH existingUnion
  WITH existingUnion WHERE existingUnion IS NOT NULL
  RETURN existingUnion.gedcomId AS unionId, true AS existed
}
RETURN unionId, existed`
  }
  // child
  return `OPTIONAL MATCH (parent:Person {gedcomId: $id})-[:UNION]->(u:Union)-[:CHILD]->(child:Person {gedcomId: $targetId})
WITH u AS existingUnion
CALL {
  WITH existingUnion
  WITH existingUnion WHERE existingUnion IS NULL
  MATCH (parent:Person {gedcomId: $id}), (child:Person {gedcomId: $targetId})
  MERGE (u:Union {gedcomId: $unionId})
  MERGE (parent)-[:UNION]->(u)
  MERGE (u)-[:CHILD]->(child)
  RETURN u.gedcomId AS unionId, false AS existed
UNION ALL
  WITH existingUnion
  WITH existingUnion WHERE existingUnion IS NOT NULL
  RETURN existingUnion.gedcomId AS unionId, true AS existed
}
RETURN unionId, existed`
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.targetId || typeof body.targetId !== 'string') {
    return NextResponse.json({ error: 'targetId is required' }, { status: 400 })
  }

  if (!VALID_TYPES.includes(body.type as RelationshipType)) {
    return NextResponse.json({ error: 'type must be spouse, parent, or child' }, { status: 400 })
  }

  const type = body.type as RelationshipType

  if (type === 'parent' && session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can add parent relationships directly' }, { status: 403 })
  }

  const targetId = body.targetId as string
  const unionId = '@F' + randomUUID().slice(0, 8) + '@'

  let rows: { unionId: string; existed: boolean }[]
  try {
    rows = await write<{ unionId: string; existed: boolean }>(atomicUpsertCypher(type), { id, targetId, unionId })
  } catch (err) {
    console.error('Neo4j write failed', err)
    return NextResponse.json({ error: 'Failed to write to graph database' }, { status: 500 })
  }

  if (!rows.length || !rows[0].unionId) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  const resultUnionId = rows[0].unionId

  if (rows[0].existed) {
    return NextResponse.json({ error: 'Relationship already exists', unionId: resultUnionId }, { status: 409 })
  }

  const authorEmail = session?.user?.email ?? 'anonymous'
  const authorName = session?.user?.name ?? 'anonymous'
  try {
    await recordChange(authorEmail, authorName, 'ADD_RELATIONSHIP', id, null, { type, targetId, unionId: resultUnionId })
  } catch (auditErr) {
    console.error('Audit recordChange failed (non-fatal)', auditErr)
  }

  return NextResponse.json({ unionId: resultUnionId }, { status: 201 })
}
