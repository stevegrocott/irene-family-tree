import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'
import { auth } from '@/auth'

export const runtime = 'nodejs'

const PAGE_SIZE = 20

interface ChangeRow {
  id: string
  changeType: string
  targetId: string
  personName: string | null
  authorName: string
  authorEmail: string
  previousValue: string | null
  newValue: string
  appliedAt: string
  status: string
}

function safeParseJson(val: unknown): Record<string, unknown> | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'object') return val as Record<string, unknown>
  try { return JSON.parse(val as string) } catch { return null }
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const skip = (page - 1) * PAGE_SIZE

  let rows: ChangeRow[]
  try {
    rows = await read<ChangeRow>(
      `MATCH (c:Change {status: 'live'})
       OPTIONAL MATCH (p:Person {gedcomId: c.targetId})
       RETURN c.id            AS id,
              c.changeType    AS changeType,
              c.targetId      AS targetId,
              p.name          AS personName,
              c.authorName    AS authorName,
              c.authorEmail   AS authorEmail,
              c.previousValue AS previousValue,
              c.newValue      AS newValue,
              c.appliedAt     AS appliedAt,
              c.status        AS status
       ORDER BY c.appliedAt DESC
       SKIP $skip LIMIT $limit`,
      { skip, limit: PAGE_SIZE }
    )
  } catch (err) {
    console.error('Neo4j query failed', err)
    return NextResponse.json({ error: 'Failed to query graph database' }, { status: 500 })
  }

  const changes = rows.map(row => ({
    ...row,
    previousValue: safeParseJson(row.previousValue),
    newValue: safeParseJson(row.newValue) ?? {},
  }))

  return NextResponse.json({ changes, page })
}
