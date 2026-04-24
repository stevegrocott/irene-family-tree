import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'
import { auth } from '@/auth'
import { safeParseJson } from '@/lib/utils'

export const runtime = 'nodejs'

/**
 * Represents a pending change row from the database query.
 * @typedef {Object} PendingChangeRow
 * @property {string} id - Unique identifier for the pending change
 * @property {string} changeType - Type of change (CREATE_PERSON, ADD_RELATIONSHIP, or field update)
 * @property {string} authorName - Name of the user who suggested the change
 * @property {string} authorEmail - Email of the user who suggested the change
 * @property {string | null} payload - JSON-stringified object with new/updated values
 * @property {string | null} previousValue - JSON-stringified previous value for the field
 * @property {string | null} targetId - GEDCOM ID of the person being modified (null for CREATE_PERSON)
 * @property {string | null} personName - Display name of the target person
 * @property {string} status - Current status of the change (pending, approved, declined, etc.)
 * @property {string | null} createdAt - ISO timestamp when the change was created
 */
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

/**
 * Fetches pending change suggestions for admin review.
 *
 * Requires admin authentication. Returns paginated pending changes with:
 * - Change metadata (type, author, creation timestamp)
 * - Previous value and new value for the change
 * - Target person information (name, ID)
 * - Current change status
 *
 * Results are sorted by creation date (newest first) and limited to 20 per page.
 *
 * @async
 * @returns {Promise<NextResponse<{suggestions: Object[]}>>} JSON response with array of suggestion objects
 *
 * @example
 * // Response structure
 * {
 *   suggestions: [
 *     {
 *       id: "uuid",
 *       changeType: "CREATE_PERSON",
 *       targetId: "I123",
 *       personName: "John Doe",
 *       authorName: "Jane Smith",
 *       authorEmail: "jane@example.com",
 *       previousValue: null,
 *       newValue: { givenName: "John", surname: "Doe" },
 *       appliedAt: "2024-04-24T10:30:00Z",
 *       status: "pending"
 *     }
 *   ]
 * }
 */
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
