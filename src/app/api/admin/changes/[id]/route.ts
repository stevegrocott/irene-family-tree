import { NextResponse } from 'next/server'
import { read, write } from '@/lib/neo4j'
import { auth } from '@/auth'
import { revertChange } from '@/lib/revert'

export const runtime = 'nodejs'

interface ChangeRow {
  id: string
  status: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body.action
  if (action !== 'keep' && action !== 'revert') {
    return NextResponse.json({ error: 'action must be "keep" or "revert"' }, { status: 400 })
  }

  let rows: ChangeRow[]
  try {
    rows = await read<ChangeRow>(
      `MATCH (c:Change {id: $id})
       RETURN c.id AS id, c.status AS status`,
      { id }
    )
  } catch (err) {
    console.error('Neo4j query failed', err)
    return NextResponse.json({ error: 'Failed to query graph database' }, { status: 500 })
  }

  if (!rows.length) {
    return NextResponse.json({ error: 'Change not found' }, { status: 404 })
  }

  const change = rows[0]
  if (change.status !== 'live') {
    return NextResponse.json({ error: 'Change is not pending review' }, { status: 409 })
  }

  if (action === 'keep') {
    try {
      await write(
        `MATCH (c:Change {id: $id}) SET c.status = 'kept'`,
        { id }
      )
    } catch (err) {
      console.error('Neo4j write failed', err)
      return NextResponse.json({ error: 'Failed to update graph database' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  const email = session.user.email ?? 'anonymous'
  const name = session.user.name ?? email
  const result = await revertChange(id, { email, name })
  if (result.ok) {
    return NextResponse.json({ success: true })
  }
  return NextResponse.json(
    { error: result.error, conflictingChange: result.conflict },
    { status: result.status }
  )
}
