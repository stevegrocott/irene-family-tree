import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { read, write } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { auth } from '@/auth'

export const runtime = 'nodejs'

const VALID_TYPES = ['spouse', 'parent', 'child'] as const
type RelationshipType = typeof VALID_TYPES[number]

interface UnionRecord {
  unionId: string
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
  const targetId = body.targetId as string
  const unionId = '@F' + randomUUID().slice(0, 8) + '@'

  // Check for existing union before creating a new one
  let checkCypher: string
  if (type === 'spouse') {
    checkCypher = `MATCH (a:Person {gedcomId: $id}), (b:Person {gedcomId: $targetId})
OPTIONAL MATCH (a)-[:UNION]->(u:Union)<-[:UNION]-(b)
RETURN u.gedcomId AS unionId`
  } else if (type === 'parent') {
    // targetId is the parent; id is the child
    checkCypher = `MATCH (child:Person {gedcomId: $id}), (parent:Person {gedcomId: $targetId})
OPTIONAL MATCH (parent)-[:UNION]->(u:Union)-[:CHILD]->(child)
RETURN u.gedcomId AS unionId`
  } else {
    // type === 'child': id is the parent; targetId is the child
    checkCypher = `MATCH (parent:Person {gedcomId: $id}), (child:Person {gedcomId: $targetId})
OPTIONAL MATCH (parent)-[:UNION]->(u:Union)-[:CHILD]->(child)
RETURN u.gedcomId AS unionId`
  }

  let existingRows: UnionRecord[]
  try {
    existingRows = await read<UnionRecord>(checkCypher, { id, targetId })
  } catch (err) {
    console.error('Neo4j read failed', err)
    return NextResponse.json({ error: 'Failed to read from graph database' }, { status: 500 })
  }

  if (existingRows.length && existingRows[0].unionId) {
    return NextResponse.json(
      { error: 'Relationship already exists', unionId: existingRows[0].unionId },
      { status: 409 }
    )
  }

  let cypher: string
  if (type === 'spouse') {
    cypher = `MATCH (a:Person {gedcomId: $id}), (b:Person {gedcomId: $targetId})
MERGE (u:Union {gedcomId: $unionId})
MERGE (a)-[:UNION]->(u)
MERGE (b)-[:UNION]->(u)
RETURN u.gedcomId AS unionId`
  } else if (type === 'parent') {
    // targetId is the parent; id is the child
    cypher = `MATCH (child:Person {gedcomId: $id}), (parent:Person {gedcomId: $targetId})
MERGE (u:Union {gedcomId: $unionId})
MERGE (parent)-[:UNION]->(u)
MERGE (u)-[:CHILD]->(child)
RETURN u.gedcomId AS unionId`
  } else {
    // type === 'child': id is the parent; targetId is the child
    cypher = `MATCH (parent:Person {gedcomId: $id}), (child:Person {gedcomId: $targetId})
MERGE (u:Union {gedcomId: $unionId})
MERGE (parent)-[:UNION]->(u)
MERGE (u)-[:CHILD]->(child)
RETURN u.gedcomId AS unionId`
  }

  let rows: UnionRecord[]
  try {
    rows = await write<UnionRecord>(cypher, { id, targetId, unionId })
  } catch (err) {
    console.error('Neo4j write failed', err)
    return NextResponse.json({ error: 'Failed to write to graph database' }, { status: 500 })
  }

  if (!rows.length || !rows[0].unionId) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  const authorEmail = session?.user?.email ?? 'anonymous'
  const authorName = session?.user?.name ?? 'anonymous'
  await recordChange(
    authorEmail,
    authorName,
    'ADD_RELATIONSHIP',
    id,
    null,
    { type, targetId, unionId: rows[0].unionId }
  )

  return NextResponse.json(rows[0], { status: 201 })
}
