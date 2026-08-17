/**
 * @fileoverview Shared TypeScript types for the family tree data model.
 * Covers person records, union (marriage) records, relationships, and the
 * ReactFlow node/edge shapes returned by the tree API.
 */

import type { PersonLodVariant } from '@/constants/tree'

/**
 * Data payload attached to a person node in the ReactFlow graph.
 */
export interface PersonData {
  /** GEDCOM identifier (e.g. `@I1@`). */
  gedcomId: string
  /** Full display name. */
  name: string
  /** Sex code: `'M'`, `'F'`, or `'U'`. */
  sex: string
  /** Four-digit birth year, or `null` if unknown. */
  birthYear: string | null
  /** Four-digit death year, or `null` if unknown. */
  deathYear: string | null
  /** Place of birth, or `null` if unknown. */
  birthPlace: string | null
  /** Place of death, or `null` if unknown. */
  deathPlace: string | null
  /** Occupation string, or `null` if unknown. */
  occupation: string | null
  /** Free-text notes attached to the individual. */
  notes: string | null
  /** `true` when this person is the current root of the displayed tree. */
  isRoot?: boolean
  /** Given (first) name extracted from the GEDCOM NAME tag. */
  givenName?: string
  /** Surname extracted from the GEDCOM NAME tag. */
  surname?: string
  /** Full birth date string (may include day and month). */
  birthDate?: string | null
  /** Full death date string (may include day and month). */
  deathDate?: string | null
  /** BFS generation distance from the tree root (0 = root). */
  generation?: number
  /** `true` when sensitive fields were redacted because this person is likely still living. */
  living?: boolean
  /** URL of the person's profile photo, or `null`/absent if none is set. */
  photoUrl?: string | null
  /** Zoom-driven level-of-detail variant (docs/DESIGN_SYSTEM.md §3.2), or absent before the canvas has computed one. */
  lodVariant?: PersonLodVariant
  /** Count of pending `PendingChange` suggestions targeting this person; survives redaction since it's a workflow signal, not a fact about the person. Absent on stubs/older payloads — treat as 0. */
  pendingEdits?: number
}

/**
 * Data payload attached to a union (marriage/partnership) node in the ReactFlow graph.
 */
export interface UnionData {
  /** GEDCOM identifier for the family record (e.g. `@F1@`). */
  gedcomId: string
  /** Full marriage date string, or `null` if unknown. */
  marriageDate?: string | null
  /** Four-digit marriage year, or `null` if unknown. */
  marriageYear?: string | null
  /** Place of marriage, or `null` if unknown. */
  marriagePlace?: string | null
}

/**
 * A node in the ReactFlow family tree graph as serialised by the API.
 */
export interface FlowNode {
  /** Unique node identifier used by ReactFlow. */
  id: string
  /** Visual type: `'person'` renders a person card, `'union'` renders a marriage dot. */
  type: 'person' | 'union'
  /** Node-type-specific data payload. */
  data: PersonData | UnionData
  /** Initial (x, y) position; overwritten by the dagre layout pass. */
  position: { x: number; y: number }
}

/**
 * An edge in the ReactFlow family tree graph as serialised by the API.
 */
export interface FlowEdge {
  /** Unique edge identifier used by ReactFlow. */
  id: string
  /** ID of the source node. */
  source: string
  /** ID of the target node. */
  target: string
  /** Relationship label (e.g. `'CHILD'`, `'SPOUSE'`). */
  label: string
}

/**
 * Lightweight summary of a related person, used in parent, sibling, spouse, and child lists.
 * Returned as part of {@link PersonDetailResponse}.
 */
export interface PersonSummary {
  /** GEDCOM identifier (e.g. `@I1@`). */
  gedcomId: string
  /** Full display name. */
  name: string
  /** Sex code: `'M'`, `'F'`, or `null`. */
  sex: string | null
  /** Four-digit birth year, or `null` if unknown. */
  birthYear: string | null
  /** Four-digit death year, or `null` if unknown. */
  deathYear: string | null
  /** `true` when sensitive fields were redacted because this person is likely still living. */
  living?: boolean
  /** URL of the person's profile photo, or `null`/absent if none is set. */
  photoUrl?: string | null
}

/**
 * A parent entry in {@link PersonDetailResponse}, extending {@link PersonSummary}
 * with the GEDCOM identifier of the Union node connecting this parent to the person,
 * so callers can match authored relationship changes to a specific parent connection
 * instead of tallying counts.
 */
export interface ParentSummary extends PersonSummary {
  /**
   * GEDCOM identifier for the Union (FAM) node linking this parent to the person.
   *
   * Nullable because the detail query reaches the parent union through an
   * `OPTIONAL MATCH` — a parent recorded without a resolvable union yields null
   * rather than being dropped. Consumers matching authorship by union id must
   * treat null as "not authored" and fail closed (issue #308); declaring this
   * non-nullable would let a missing id be read as a match by an `undefined`
   * lookup that silently succeeds.
   */
  unionId: string | null
}

/**
 * Details of a single marriage/union, including the spouse and children of that union.
 */
export interface MarriageDetail {
  /** GEDCOM identifier for the Union node. */
  unionId: string
  /** Four-digit marriage year, or `null` if unknown. */
  marriageYear: string | null
  /** Place name where the marriage occurred, or `null` if unknown. */
  marriagePlace: string | null
  /** The other partner in this union, or `null` if no spouse is recorded. */
  spouse: PersonSummary | null
  /** Children born of this union. */
  children: PersonSummary[]
}

/**
 * Full person detail response returned by `GET /api/person/[id]`.
 * Includes the person's own data plus their immediate relatives.
 */
export interface PersonDetailResponse {
  /** GEDCOM identifier (e.g. `@I1@`). */
  gedcomId: string
  /** Full display name. */
  name: string
  /** Sex code: `'M'`, `'F'`, or `null`. */
  sex: string | null
  /** Four-digit birth year, or `null` if unknown. */
  birthYear: string | null
  /** Four-digit death year, or `null` if unknown. */
  deathYear: string | null
  /** Place of birth, or `null` if unknown. */
  birthPlace: string | null
  /** Place of death, or `null` if unknown. */
  deathPlace: string | null
  /** Occupation string, or `null` if unknown. */
  occupation: string | null
  /** Free-text notes, or `null` if none. */
  notes: string | null
  /** `true` when sensitive fields were redacted because this person is likely still living. */
  living?: boolean
  /** URL of the person's profile photo, or `null`/absent if none is set. */
  photoUrl?: string | null
  /** Biological or adoptive parents. */
  parents: ParentSummary[]
  /** Siblings sharing at least one common parent union. */
  siblings: PersonSummary[]
  /** All recorded marriages with spouse and children. */
  marriages: MarriageDetail[]
}

/**
 * Full response shape returned by the `GET /api/tree/[id]` endpoint.
 */
export interface TreeResponse {
  /** All person and union nodes in the subgraph. */
  nodes: FlowNode[]
  /** All relationship edges connecting those nodes. */
  edges: FlowEdge[]
  /** Total number of nodes matched by the traversal before the `MAX_NODES` cap was applied. */
  totalNodes: number
  /** `true` when the matched node count exceeded `MAX_NODES` and the result was capped. */
  truncated: boolean
}
