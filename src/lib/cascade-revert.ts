import { read, writeTransaction } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'

export type CascadeRevertOutcome =
  | { ok: true; unionsReverted: number }
  | { ok: false; status: 403 | 404 | 409; error: string; blockedBy?: BlockedEdge[] }

export interface BlockedEdge {
  unionId: string
  authorEmail: string
  authorName: string
}

interface ChangeQueryRow {
  id: string
  authorEmail: string
  authorName: string
  newValue: string
}

export async function cascadeRevertPerson(
  personId: string,
  requester: { email: string; name: string; isAdmin: boolean }
): Promise<CascadeRevertOutcome> {
  const createRows = await read<ChangeQueryRow>(
    requester.isAdmin
      ? `MATCH (c:Change { changeType: 'CREATE_PERSON', status: 'live', targetId: $personId })
         RETURN c.id AS id, c.authorEmail AS authorEmail, c.authorName AS authorName, c.newValue AS newValue
         LIMIT 1`
      : `MATCH (c:Change { changeType: 'CREATE_PERSON', status: 'live', targetId: $personId })
         WHERE toLower(c.authorEmail) = toLower($email)
         RETURN c.id AS id, c.authorEmail AS authorEmail, c.authorName AS authorName, c.newValue AS newValue
         LIMIT 1`,
    { personId, email: requester.email }
  )

  if (createRows.length === 0) {
    return { ok: false, status: 404, error: 'No CREATE_PERSON change found for this person' }
  }

  const createChange = createRows[0]

  // Parse before any mutations so a malformed record can't leave the graph half-reverted
  let prevFromCreate: Record<string, unknown>
  try {
    prevFromCreate = JSON.parse(createChange.newValue) as Record<string, unknown>
  } catch {
    return { ok: false, status: 409, error: 'Malformed change record: cannot parse newValue' }
  }

  const unionRows = await read<{ unionId: string }>(
    `MATCH (p:Person {gedcomId: $personId})-[:UNION]->(u:Union)
     RETURN DISTINCT u.gedcomId AS unionId`,
    { personId }
  )
  const unionIds = unionRows.map(r => r.unionId).filter(Boolean)

  // Filter ADD_RELATIONSHIP changes in JS since Neo4j Community/Aura may lack APOC for server-side JSON parsing
  const relChangesByUnion = new Map<string, { id: string; authorEmail: string; authorName: string }>()

  if (unionIds.length > 0) {
    const allRelRows = await read<ChangeQueryRow>(
      `MATCH (c:Change { changeType: 'ADD_RELATIONSHIP', status: 'live' })
       WHERE c.targetId = $personId
       RETURN c.id AS id, c.authorEmail AS authorEmail, c.authorName AS authorName, c.newValue AS newValue
       LIMIT 1000`,
      { personId }
    )

    const unionIdSet = new Set(unionIds)
    for (const row of allRelRows) {
      try {
        const parsed = JSON.parse(row.newValue) as { unionId?: string }
        if (parsed.unionId && unionIdSet.has(parsed.unionId)) {
          relChangesByUnion.set(parsed.unionId, {
            id: row.id,
            authorEmail: row.authorEmail,
            authorName: row.authorName,
          })
        }
      } catch {
        // skip malformed newValue
      }
    }

    if (!requester.isAdmin) {
      const blockedBy: BlockedEdge[] = []
      for (const unionId of unionIds) {
        const change = relChangesByUnion.get(unionId)
        if (!change || change.authorEmail.toLowerCase() !== requester.email.toLowerCase()) {
          blockedBy.push({
            unionId,
            authorEmail: change?.authorEmail ?? 'unknown',
            authorName: change?.authorName ?? 'unknown',
          })
        }
      }
      if (blockedBy.length > 0) {
        return { ok: false, status: 403, error: 'blocked', blockedBy }
      }
    }

  }

  const relChangeIds = Array.from(relChangesByUnion.values()).map(c => c.id)

  // All mutations run in a single transaction to prevent partial revert on failure
  const statements: Array<{ cypher: string; params?: Record<string, unknown> }> = []
  if (unionIds.length > 0) {
    statements.push({
      cypher: `UNWIND $unionIds AS unionId
               MATCH (u:Union {gedcomId: unionId}) DETACH DELETE u`,
      params: { unionIds },
    })
    if (relChangeIds.length > 0) {
      statements.push({
        cypher: `UNWIND $ids AS id MATCH (c:Change {id: id}) SET c.status = 'reverted'`,
        params: { ids: relChangeIds },
      })
    }
  }
  statements.push(
    { cypher: `MATCH (p:Person {gedcomId: $personId}) DETACH DELETE p`, params: { personId } },
    { cypher: `MATCH (c:Change {id: $id}) SET c.status = 'reverted'`, params: { id: createChange.id } }
  )

  await writeTransaction(statements)

  try {
    await recordChange(requester.email, requester.name, 'DELETE_PERSON', personId, prevFromCreate, {})
  } catch (auditErr) {
    console.error('Audit recordChange failed (non-fatal)', auditErr)
  }

  return { ok: true, unionsReverted: unionIds.length }
}
