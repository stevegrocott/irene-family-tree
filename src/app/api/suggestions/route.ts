import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { write } from '@/lib/neo4j'
import { auth } from '@/auth'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authorEmail = session.user.email ?? 'anonymous'
  const authorName = session.user.name ?? 'anonymous'

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.changeType || body.payload === undefined || body.payload === null) {
    return NextResponse.json({ error: 'changeType and payload are required' }, { status: 400 })
  }

  const id = randomUUID()
  const changeType = body.changeType as string
  const payload = JSON.stringify(body.payload)
  const status = 'pending'

  try {
    await write(
      `CREATE (c:PendingChange {
        id: $id,
        authorEmail: $authorEmail,
        authorName: $authorName,
        changeType: $changeType,
        payload: $payload,
        status: $status,
        createdAt: datetime()
      }) RETURN c.id AS id`,
      { id, authorEmail, authorName, changeType, payload, status }
    )
  } catch (err) {
    console.error('Neo4j write failed', err)
    return NextResponse.json({ error: 'Failed to create suggestion' }, { status: 500 })
  }

  return NextResponse.json({ id }, { status: 201 })
}
