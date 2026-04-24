import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { read, write } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { auth } from '@/auth'
import { ALLOWED_PATCH_FIELDS } from '@/lib/patches'

export const runtime = 'nodejs'

interface PendingChangeRow {
  id: string
  changeType: string
  payload: string | null
  status: string
  authorEmail: string
  authorName: string
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

  const reason = typeof body.reason === 'string' ? body.reason : null

  let rows: PendingChangeRow[]
  try {
    rows = await read<PendingChangeRow>(
      `MATCH (c:PendingChange {id: $id})
       RETURN c.id AS id, c.changeType AS changeType,
              c.payload AS payload, c.status AS status,
              c.authorEmail AS authorEmail, c.authorName AS authorName`,
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
      const rawPayload = safeParseJson(suggestion.payload) ?? {}

      if (suggestion.changeType === 'CREATE_PERSON') {
        const newId = randomUUID()
        const personFields: Record<string, unknown> = {}
        for (const key of ALLOWED_PATCH_FIELDS) {
          if (key in rawPayload) personFields[key] = rawPayload[key]
        }
        await write(
          `MATCH (c:PendingChange {id: $id})
           CREATE (p:Person {gedcomId: $newId})
           SET p += $personFields
           SET c.status = 'approved'`,
          { id, newId, personFields }
        )
      } else if (suggestion.changeType === 'ADD_RELATIONSHIP') {
        const targetId = rawPayload.targetId as string
        const childId = rawPayload.childId as string
        const unionId = '@F' + randomUUID().slice(0, 8) + '@'
        const result = await write<{ unionId: string; created: boolean }>(
          `MATCH (c:PendingChange {id: $id})
MATCH (child:Person {gedcomId: $childId}), (parent:Person {gedcomId: $targetId})
OPTIONAL MATCH (parent)-[:UNION]->(existing:Union)-[:CHILD]->(child)
CALL {
  WITH child, parent, existing
  WITH child, parent WHERE existing IS NULL
  MERGE (u:Union {gedcomId: $unionId})
  MERGE (parent)-[:UNION]->(u)
  MERGE (u)-[:CHILD]->(child)
  RETURN u.gedcomId AS unionId, true AS created
UNION
  WITH existing
  WITH existing WHERE existing IS NOT NULL
  RETURN existing.gedcomId AS unionId, false AS created
}
SET c.status = 'approved'
RETURN unionId, created`,
          { id, childId, targetId, unionId }
        )
        if (!result.length) {
          return NextResponse.json(
            { error: 'Target person(s) no longer exist; suggestion cannot be applied' },
            { status: 409 }
          )
        }
        const { unionId: resultUnionId, created } = result[0]
        if (created) {
          try {
            await recordChange(
              suggestion.authorEmail,
              suggestion.authorName,
              'ADD_RELATIONSHIP',
              childId,
              null,
              { type: 'parent', targetId, unionId: resultUnionId }
            )
          } catch (auditErr) {
            console.error('Audit recordChange failed (non-fatal)', auditErr)
          }
        }
      } else {
        const { targetId, ...rest } = rawPayload as { targetId?: string } & Record<string, unknown>
        const newValue: Record<string, unknown> = {}
        for (const key of ALLOWED_PATCH_FIELDS) {
          if (key in rest) newValue[key] = rest[key]
        }
        if (targetId && Object.keys(newValue).length > 0) {
          const result = await write<{ id: string }>(
            `MATCH (c:PendingChange {id: $id})
             MATCH (p:Person {gedcomId: $targetId})
             SET p += $newValue
             SET c.status = 'approved'
             RETURN c.id AS id`,
            { id, targetId, newValue }
          )
          if (!result.length) {
            return NextResponse.json(
              { error: 'Target person no longer exists; suggestion cannot be applied' },
              { status: 409 }
            )
          }
        } else {
          await write(
            `MATCH (c:PendingChange {id: $id}) SET c.status = 'approved'`,
            { id }
          )
        }
      }
    } else {
      await write(
        `MATCH (c:PendingChange {id: $id})
         SET c.status = 'declined', c.declinedAt = datetime(), c.declineReason = $reason`,
        { id, reason }
      )
    }
  } catch (err) {
    console.error('Neo4j write failed', err)
    return NextResponse.json({ error: 'Failed to update graph database' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
