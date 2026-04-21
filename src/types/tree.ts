export interface PersonData {
  gedcomId: string
  name: string
  sex: string
  birthYear: string | null
  deathYear: string | null
  birthPlace: string | null
  deathPlace: string | null
  occupation: string | null
  notes: string | null
  isRoot?: boolean
  givenName?: string
  surname?: string
  birthDate?: string | null
  birthPlace?: string | null
  deathDate?: string | null
  deathPlace?: string | null
  occupation?: string | null
  notes?: string | null
  generation?: number
}

export interface UnionData {
  gedcomId: string
  marriageDate?: string | null
  marriageYear?: string | null
  marriagePlace?: string | null
}

export type RelKind = 'parent' | 'child' | 'spouse' | 'sibling'

export interface Relative {
  gedcomId: string
  name: string
  sex: string
  birthYear: string | null
  deathYear: string | null
  relKind: RelKind
}

export interface PersonDetail extends PersonData {
  relatives: Relative[]
}

export interface FlowNode {
  id: string
  type: 'person' | 'union'
  data: PersonData | UnionData
  position: { x: number; y: number }
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  label: string
}

export interface TreeResponse {
  nodes: FlowNode[]
  edges: FlowEdge[]
}
