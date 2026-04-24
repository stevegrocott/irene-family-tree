import { read, write } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'

export type CascadeRevertOutcome =
  | { ok: true; unionsReverted: number }
  | { ok: false; status: 403 | 404 | 409; error: string; blockedBy?: BlockedEdge[] }

export interface BlockedEdge {
  unionId: string
  authorEmail: string
  authorName: string
}

interface CreateChangeRow {
  id: string
  authorEmail: string
  authorName: string
  newValue: string
}

interface RelChangeRow {
  id: string
  authorEmail: string
  authorName: string
  newValue: string
}

export async function cascadeRevertPerson(
  personId: string,
  requester: { email: string; name: string; isAdmin: boolean }
): Promise<CascadeRevertOutcome> {
  // 1. Find the CREATE_PERSON change (by requester, or any if admin)
  const createRows = await read<CreateChangeRow>(
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

  // 2. Find all Union nodes where the person is a UNION member (spouse/parent role)
  //    Mirrors the my-changes endpoint union lookup approach
  const unionRows = await read<{ unionId: string }>(
    `MATCH (p:Person {gedcomId: $personId})-[:UNION]->(u:Union)
     RETURN DISTINCT u.gedcomId AS unionId`,
    { personId }
  )
  const unionIds = unionRows.map(r => r.unionId).filter(Boolean)

  // 3. Find live ADD_RELATIONSHIP changes matching these union IDs (by parsing newValue in JS,
  //    since Neo4j Community/Aura may not have APOC for server-side JSON parsing)
  const relChangesByUnion = new Map<string, { id: string; authorEmail: string; authorName: string }>()

  if (unionIds.length > 0) {
    const allRelRows = await read<RelChangeRow>(
      `MATCH (c:Change { changeType: 'ADD_RELATIONSHIP', status: 'live' })
       RETURN c.id AS id, c.authorEmail AS authorEmail, c.authorName AS authorName, c.newValue AS newValue`,
      {}
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

    // 4. Check authorship — admins bypass, non-admins must own every union
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

  // 5. Atomic writes (sequential; each write is its own Neo4j transaction)
  for (const unionId of unionIds) {
    await write(`MATCH (u:Union {gedcomId: $unionId}) DETACH DELETE u`, { unionId })
  }
  for (const [, relChange] of relChangesByUnion) {
    await write(`MATCH (c:Change {id: $id}) SET c.status = 'reverted'`, { id: relChange.id })
  }
  await write(`MATCH (p:Person {gedcomId: $personId}) DETACH DELETE p`, { personId })
  await write(`MATCH (c:Change {id: $id}) SET c.status = 'reverted'`, { id: createChange.id })

  try {
    await recordChange(requester.email, requester.name, 'DELETE_PERSON', personId, prevFromCreate, {})
  } catch (auditErr) {
    console.error('Audit recordChange failed (non-fatal)', auditErr)
  }

  return { ok: true, unionsReverted: unionIds.length }
}
