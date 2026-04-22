import { NextResponse } from 'next/server'
import { read, write } from '@/lib/neo4j'
import { auth } from '@/auth'
import { ALLOWED_PATCH_FIELDS } from '@/lib/patches'

export const runtime = 'nodejs'

interface SuggestionRow {
  id: string
  targetId: string
  newValue: string | null
  status: string
}

function safeParseJson(val: unknown): Record<string, unknown> | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'object') return val as Record<string, unknown>
  try { return JSON.parse(val as string) } catch { return null }
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
  if (action !== 'approve' && action !== 'decline') {
    return NextResponse.json({ error: 'action must be "approve" or "decline"' }, { status: 400 })
  }

  let rows: SuggestionRow[]
  try {
    rows = await read<SuggestionRow>(
      `MATCH (c:Change {id: $id})
       RETURN c.id AS id, c.targetId AS targetId,
              c.newValue AS newValue, c.status AS status`,
      { id }
    )
  } catch (err) {
    console.error('Neo4j query failed', err)
    return NextResponse.json({ error: 'Failed to query graph database' }, { status: 500 })
  }

  if (!rows.length) {
    return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
  }

  const suggestion = rows[0]
  if (suggestion.status !== 'pending') {
    return NextResponse.json({ error: 'Suggestion is not pending' }, { status: 409 })
  }

  try {
    if (action === 'approve') {
      const rawNew = safeParseJson(suggestion.newValue) ?? {}
      const newValue: Record<string, unknown> = {}
      for (const key of ALLOWED_PATCH_FIELDS) {
        if (key in rawNew) newValue[key] = rawNew[key]
      }
      if (Object.keys(newValue).length > 0) {
        await write(
          `MATCH (c:Change {id: $id})
           MATCH (p:Person {gedcomId: c.targetId})
           SET p += $newValue
           SET c.status = 'approved'`,
          { id, newValue }
        )
      } else {
        await write(
          `MATCH (c:Change {id: $id}) SET c.status = 'approved'`,
          { id }
        )
      }
    } else {
      await write(
        `MATCH (c:Change {id: $id}) SET c.status = 'declined'`,
        { id }
      )
    }
  } catch (err) {
    console.error('Neo4j write failed', err)
    return NextResponse.json({ error: 'Failed to update graph database' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
