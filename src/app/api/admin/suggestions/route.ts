import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'
import { auth } from '@/auth'

export const runtime = 'nodejs'

interface PendingChangeRow {
  id: string
  changeType: string
  authorName: string
  authorEmail: string
  payload: string | null
  previousValue: string | null
  targetId: string | null
  personName: string | null
  status: string
  createdAt: string | null
}

function safeParseJson(val: unknown): Record<string, unknown> | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'object') return val as Record<string, unknown>
  try { return JSON.parse(val as string) } catch { return null }
}

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let rows: PendingChangeRow[]
  try {
    rows = await read<PendingChangeRow>(
      `MATCH (c:PendingChange {status: 'pending'})
       OPTIONAL MATCH (p:Person {gedcomId: c.targetId})
       RETURN c.id          AS id,
              c.changeType  AS changeType,
              c.authorName  AS authorName,
              c.authorEmail AS authorEmail,
              c.payload     AS payload,
              c.previousValue AS previousValue,
              c.targetId    AS targetId,
              coalesce(p.name, c.targetId, '') AS personName,
              c.status      AS status,
              c.createdAt   AS createdAt
       ORDER BY c.createdAt DESC
       SKIP $skip LIMIT $limit`,
      { skip: 0, limit: 20 }
    )
  } catch (err) {
    console.error('Neo4j query failed', err)
    return NextResponse.json({ error: 'Failed to query graph database' }, { status: 500 })
  }

  const suggestions = rows.map(row => {
    const parsedPayload = safeParseJson(row.payload) ?? {}
    const { targetId: _tid, ...newValueFields } = parsedPayload as { targetId?: string } & Record<string, unknown>
    return {
      id: row.id,
      changeType: row.changeType,
      targetId: row.targetId ?? '',
      personName: row.personName ?? '',
      authorName: row.authorName,
      authorEmail: row.authorEmail,
      previousValue: safeParseJson(row.previousValue),
      newValue: newValueFields,
      appliedAt: row.createdAt ?? '',
      status: row.status,
    }
  })

  return NextResponse.json({ suggestions })
}
