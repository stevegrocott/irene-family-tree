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
  _changeId: string,
  _reverter: { email: string; name: string }
): Promise<RevertOutcome> {
  throw new Error('not implemented')
}
