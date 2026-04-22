import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'

export const runtime = 'nodejs'

interface ChangeRow {
  id: string
  changeType: string
  targetId: string
  personName: string
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

export async function GET() {
  let rows: ChangeRow[]
  try {
    rows = await read<ChangeRow>(
      `MATCH (c:Change {status: 'live'})
       RETURN c.id            AS id,
              c.changeType    AS changeType,
              c.targetId      AS targetId,
              c.personName    AS personName,
              c.authorName    AS authorName,
              c.authorEmail   AS authorEmail,
              c.previousValue AS previousValue,
              c.newValue      AS newValue,
              c.appliedAt     AS appliedAt,
              c.status        AS status
       ORDER BY c.appliedAt DESC`
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

  return NextResponse.json({ changes })
}
