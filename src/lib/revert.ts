import { read, write } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { ALLOWED_PATCH_FIELDS } from '@/lib/patches'

export type ConflictKind =
  | 'has-relationships'
  | 'union-touched'
  | 'field-updated-later'

export interface RevertConflict {
  kind: ConflictKind
  detail: string
}

export type RevertOutcome =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string; conflict?: RevertConflict }

export interface ChangeRow {
  id: string
  changeType: 'CREATE_PERSON' | 'ADD_RELATIONSHIP' | 'UPDATE_PERSON' | 'DELETE_PERSON'
  targetId: string
  previousValue: string | null
  newValue: string
  status: string
  authorEmail: string
  authorName: string
  appliedAt: string
}

export async function revertChange(
  changeId: string,
  reverter: { email: string; name: string }
): Promise<RevertOutcome> {
  const rows = await read<ChangeRow>(
    `MATCH (c:Change {id: $id})
     RETURN c.id AS id, c.changeType AS changeType, c.targetId AS targetId,
            c.previousValue AS previousValue, c.newValue AS newValue,
            c.status AS status, c.authorEmail AS authorEmail,
            c.authorName AS authorName, c.appliedAt AS appliedAt`,
    { id: changeId }
  )

  if (rows.length === 0) {
    return { ok: false, status: 404, error: 'Change not found' }
  }

  const change = rows[0]

  if (change.status !== 'live') {
    return { ok: false, status: 409, error: 'Change is not live' }
  }

  if (change.changeType === 'ADD_RELATIONSHIP') {
    const parsed = JSON.parse(change.newValue) as {
      type: 'spouse' | 'parent' | 'child'
      targetId: string
      unionId: string
    }
    const edgeRows = await read<{ unionEdges: number; childEdges: number }>(
      `MATCH (u:Union {gedcomId: $unionId})
       OPTIONAL MATCH (u)<-[ue:UNION]-()
       OPTIONAL MATCH (u)-[ce:CHILD]->()
       RETURN count(DISTINCT ue) AS unionEdges, count(DISTINCT ce) AS childEdges`,
      { unionId: parsed.unionId }
    )
    const { unionEdges = 0, childEdges = 0 } = edgeRows[0] ?? {}

    const pristine =
      parsed.type === 'spouse'
        ? unionEdges === 2 && childEdges === 0
        : unionEdges === 1 && childEdges === 1

    if (!pristine) {
      return {
        ok: false,
        status: 409,
        error: 'Cannot revert: union has been modified since',
        conflict: {
          kind: 'union-touched',
          detail: `Union has ${unionEdges} spouse edge(s) and ${childEdges} child edge(s); other edits are present, so reverting this relationship alone would leave the union inconsistent.`,
        },
      }
    }

    await write(
      `MATCH (u:Union {gedcomId: $unionId}) DETACH DELETE u`,
      { unionId: parsed.unionId }
    )
    await write(
      `MATCH (c:Change {id: $id}) SET c.status = 'reverted'`,
      { id: change.id }
    )

    return { ok: true }
  }

  if (change.changeType === 'CREATE_PERSON') {
    const edgeRows = await read<{ edges: number }>(
      `MATCH (p:Person {gedcomId: $targetId})
       OPTIONAL MATCH (p)-[r]-()
       RETURN count(r) AS edges`,
      { targetId: change.targetId }
    )
    const edgeCount = edgeRows[0]?.edges ?? 0
    if (edgeCount > 0) {
      return {
        ok: false,
        status: 409,
        error: 'Cannot revert: person has relationships',
        conflict: {
          kind: 'has-relationships',
          detail: `Person has ${edgeCount} relationship(s); remove them before reverting.`,
        },
      }
    }

    await write(
      `MATCH (p:Person {gedcomId: $targetId}) DETACH DELETE p`,
      { targetId: change.targetId }
    )
    await write(
      `MATCH (c:Change {id: $id}) SET c.status = 'reverted'`,
      { id: change.id }
    )

    const prevFromCreate = JSON.parse(change.newValue) as Record<string, unknown>
    await recordChange(
      reverter.email,
      reverter.name,
      'DELETE_PERSON',
      change.targetId,
      prevFromCreate,
      {}
    )

    return { ok: true }
  }

  // Touch imports so TypeScript does not complain until later tasks use them.
  void ALLOWED_PATCH_FIELDS

  return { ok: false, status: 409, error: 'Unsupported change type' }
}
