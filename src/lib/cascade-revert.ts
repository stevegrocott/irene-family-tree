import { read, writeTransaction } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'

const CHANGE_STATUS = { LIVE: 'live', REVERTED: 'reverted' } as const
const CHANGE_TYPE = {
  CREATE_PERSON: 'CREATE_PERSON',
  ADD_RELATIONSHIP: 'ADD_RELATIONSHIP',
  DELETE_PERSON: 'DELETE_PERSON',
} as const

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
  const [createRows, unionRows] = await Promise.all([
    read<ChangeQueryRow>(
      `MATCH (c:Change { changeType: $createType, status: $live, targetId: $personId })
       WHERE $isAdmin OR toLower(c.authorEmail) = toLower($email)
       RETURN c.id AS id, c.authorEmail AS authorEmail, c.authorName AS authorName, c.newValue AS newValue
       LIMIT 1`,
      { personId, email: requester.email, isAdmin: requester.isAdmin, createType: CHANGE_TYPE.CREATE_PERSON, live: CHANGE_STATUS.LIVE }
    ),
    read<{ unionId: string }>(
      `MATCH (p:Person {gedcomId: $personId})-[:UNION]->(u:Union)
       RETURN DISTINCT u.gedcomId AS unionId
       LIMIT 100`,
      { personId }
    ), // Limits reverting to people with ≤100 unions
  ])

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

  const unionIds = unionRows.map(r => r.unionId).filter(Boolean)

  // Filter ADD_RELATIONSHIP changes in JS since Neo4j Community/Aura may lack APOC for server-side JSON parsing
  const relChangesByUnion = new Map<string, { id: string; authorEmail: string; authorName: string }>()

  if (unionIds.length > 0) {
    const allRelRows = await read<ChangeQueryRow>(
      `MATCH (c:Change { changeType: $relType, status: $live })
       WHERE any(uid IN $unionIds WHERE c.newValue CONTAINS uid)
       RETURN c.id AS id, c.authorEmail AS authorEmail, c.authorName AS authorName, c.newValue AS newValue
       LIMIT $limit`,
      // Each union produces one ADD_RELATIONSHIP change; multiply by 2 as a safety margin for retries or dual-direction entries.
      { unionIds, relType: CHANGE_TYPE.ADD_RELATIONSHIP, live: CHANGE_STATUS.LIVE, limit: unionIds.length * 2 }
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
      } catch (e) {
        console.warn('cascade-revert: failed to parse ADD_RELATIONSHIP newValue for change', row.id, e)
      }
    }

    if (!requester.isAdmin) {
      const requesterEmailLower = requester.email.toLowerCase()
      const blockedBy: BlockedEdge[] = []
      for (const unionId of unionIds) {
        const change = relChangesByUnion.get(unionId)
        if (!change || change.authorEmail.toLowerCase() !== requesterEmailLower) {
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

  const relChangeIds = Array.from(relChangesByUnion.values(), c => c.id)

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
        cypher: `UNWIND $ids AS id MATCH (c:Change {id: id}) SET c.status = $reverted`,
        params: { ids: relChangeIds, reverted: CHANGE_STATUS.REVERTED },
      })
    }
  }
  statements.push(
    { cypher: `MATCH (p:Person {gedcomId: $personId}) DETACH DELETE p`, params: { personId } },
    { cypher: `MATCH (c:Change {id: $id}) SET c.status = $reverted`, params: { id: createChange.id, reverted: CHANGE_STATUS.REVERTED } }
  )

  await writeTransaction(statements)

  try {
    await recordChange(requester.email, requester.name, CHANGE_TYPE.DELETE_PERSON, personId, prevFromCreate, {})
  } catch (err) {
    console.error('Audit recordChange failed', err)
  }

  return { ok: true, unionsReverted: unionIds.length }
}
