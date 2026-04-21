export const REL = {
  CHILD: 'CHILD',
  UNION: 'UNION',
} as const
export type RelKind = typeof REL[keyof typeof REL]

export interface PersonData {
  gedcomId: string
  name: string
  givenName?: string
  surname?: string
  sex: string
  birthDate?: string | null
  birthYear: string | null
  birthPlace?: string | null
  deathDate?: string | null
  deathYear: string | null
  deathPlace?: string | null
  occupation?: string | null
  notes?: string | null
  generation?: number
  isRoot?: boolean
}

export interface UnionData {
  gedcomId: string
  marriageDate?: string | null
  marriageYear?: string | null
  marriagePlace?: string | null
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

export interface Relative {
  gedcomId: string
  name: string
  sex: string
  birthYear: string | null
  deathYear: string | null
}

export interface PersonDetail {
  person: PersonData
  parents: Relative[]
  siblings: Relative[]
  spouses: Relative[]
  children: Relative[]
  marriages: Array<{
    gedcomId: string
    spouse: Relative | null
    marriageDate: string | null
    marriagePlace: string | null
    children: Relative[]
  }>
}
