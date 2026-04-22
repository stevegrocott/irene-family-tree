import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { write } from '@/lib/neo4j'

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

  return NextResponse.json(rows[0], { status: 201 })
}
