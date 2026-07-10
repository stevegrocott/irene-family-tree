import { read, writeTransaction } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { ALLOWED_PATCH_FIELDS } from '@/lib/patches'

export type MergeOutcome =
  | { ok: true; survivorId: string }
  | { ok: false; status: 400 | 404; error: string }

type PersonProps = Record<string, unknown>

async function fetchPerson(id: string): Promise<PersonProps | null> {
  const rows = await read<{ props: PersonProps }>(
    `MATCH (p:Person {gedcomId: $id}) RETURN properties(p) AS props`,
    { id }
  )
  return rows[0]?.props ?? null
}

/**
 * Merges the `duplicateId` person into the `survivorId` person.
 *
 * The survivor's scalar properties win; any scalar field that is null/undefined
 * on the survivor is coalesced from the duplicate. All of the duplicate's
 * relationships are rewired onto the survivor — outgoing UNION edges (partner in
 * a union) and incoming CHILD edges (child of a union) — using MERGE so that
 * pre-existing survivor edges are not duplicated. The duplicate is then removed
 * with DETACH DELETE. Every graph mutation runs inside a single
 * {@link writeTransaction} so the merge is atomic.
 *
 * A `MERGE_PERSON` change is recorded with both persons' prior states as the
 * previous value and the merged survivor state as the new value, so the merge
 * can be audited (and, later, reasoned about for reversal).
 */
export async function mergePersons(
  survivorId: string,
  duplicateId: string,
  admin: { email: string; name: string }
): Promise<MergeOutcome> {
  if (survivorId === duplicateId) {
    return { ok: false, status: 400, error: 'Cannot merge a person into itself' }
  }

  const survivor = await fetchPerson(survivorId)
  if (!survivor) {
    return { ok: false, status: 404, error: 'Survivor not found' }
  }

  const duplicate = await fetchPerson(duplicateId)
  if (!duplicate) {
    return { ok: false, status: 404, error: 'Duplicate not found' }
  }

  // Coalesce scalar props: survivor wins; fill only the fields that are
  // null/undefined on the survivor from the duplicate.
  const props: PersonProps = {}
  for (const field of ALLOWED_PATCH_FIELDS) {
    if ((survivor[field] === null || survivor[field] === undefined) &&
        duplicate[field] !== null && duplicate[field] !== undefined) {
      props[field] = duplicate[field]
    }
  }
  const merged: PersonProps = { ...survivor, ...props }

  await writeTransaction([
    {
      cypher: `MATCH (surv:Person {gedcomId: $survivorId}) SET surv += $props`,
      params: { survivorId, props },
    },
    {
      // Rewire the duplicate's UNION edges (partner in a union) onto the
      // survivor; MERGE skips unions the survivor already belongs to.
      cypher: `MATCH (dup:Person {gedcomId: $duplicateId})-[:UNION]->(u:Union)
               MATCH (surv:Person {gedcomId: $survivorId})
               MERGE (surv)-[:UNION]->(u)`,
      params: { survivorId, duplicateId },
    },
    {
      // Rewire the duplicate's incoming CHILD edges (child of a union) onto the
      // survivor; MERGE skips unions the survivor is already a child of.
      cypher: `MATCH (u:Union)-[:CHILD]->(dup:Person {gedcomId: $duplicateId})
               MATCH (surv:Person {gedcomId: $survivorId})
               MERGE (u)-[:CHILD]->(surv)`,
      params: { survivorId, duplicateId },
    },
    {
      cypher: `MATCH (dup:Person {gedcomId: $duplicateId}) DETACH DELETE dup`,
      params: { duplicateId },
    },
  ])

  await recordChange(
    admin.email,
    admin.name,
    'MERGE_PERSON',
    survivorId,
    { survivor, duplicate },
    merged
  )

  return { ok: true, survivorId }
}
