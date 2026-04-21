/**
 * @fileoverview Shared TypeScript types for the family tree data model.
 * Covers person records, union (marriage) records, relationships, and the
 * ReactFlow node/edge shapes returned by the tree API.
 */

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

/** Relationship kind between a focal person and a relative. */
export type RelKind = 'parent' | 'child' | 'spouse' | 'sibling'

/**
 * A person related to a focal individual, including the relationship kind.
 */
export interface Relative {
  /** GEDCOM identifier of the relative. */
  gedcomId: string
  /** Full display name of the relative. */
  name: string
  /** Sex code of the relative: `'M'`, `'F'`, or `'U'`. */
  sex: string
  /** Four-digit birth year of the relative, or `null` if unknown. */
  birthYear: string | null
  /** Four-digit death year of the relative, or `null` if unknown. */
  deathYear: string | null
  /** How this person is related to the focal individual. */
  relKind: RelKind
}

/**
 * Extended person record that includes all immediate relatives.
 * Returned by the `GET /api/person/[id]` endpoint.
 */
export interface PersonDetail extends PersonData {
  /** Immediate relatives (parents, children, spouses, siblings). */
  relatives: Relative[]
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
 * Full response shape returned by the `GET /api/tree/[id]` endpoint.
 */
export interface TreeResponse {
  /** All person and union nodes in the subgraph. */
  nodes: FlowNode[]
  /** All relationship edges connecting those nodes. */
  edges: FlowEdge[]
}
