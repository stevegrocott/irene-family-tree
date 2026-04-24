import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'
import { auth } from '@/auth'
import { safeParseJson } from '@/lib/utils'

export const runtime = 'nodejs'

const PAGE_SIZE = 20

/** Raw Neo4j row returned by the applied-changes query. */
interface ChangeRow {
  id: string
  changeType: string
  targetId: string
  /** Resolved from the linked Person node; null when the node no longer exists. */
  personName: string | null
  authorName: string
  authorEmail: string
  /** JSON-serialised snapshot of the field before the change, or null. */
  previousValue: string | null
  /** JSON-serialised snapshot of the field after the change. */
  newValue: string
  appliedAt: string
  status: string
}

/**
 * Returns a paginated list of applied (live) changes for the admin change-history view.
 *
 * Query params:
 * - `page` (optional, default 1) — 1-based page number
 *
 * @param request - Incoming Next.js request (used to read search params)
 * @returns JSON `{ changes, page }` on success, or an error response with status 401/403/500
 */
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
       SKIP toInteger($skip) LIMIT toInteger($limit)`,
      { skip, limit: PAGE_SIZE }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Neo4j query failed', err)
    return NextResponse.json({ error: 'Failed to query graph database', detail: msg }, { status: 500 })
  }

  const changes = rows.map(row => ({
    ...row,
    previousValue: safeParseJson(row.previousValue),
    newValue: safeParseJson(row.newValue) ?? {},
  }))

  return NextResponse.json({ changes, page })
}
