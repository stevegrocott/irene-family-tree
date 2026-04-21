export interface PersonData {
  gedcomId: string
  name: string
  sex: string
  birthYear: string | null
  deathYear: string | null
  isRoot?: boolean
}

export interface UnionData {
  gedcomId: string
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
  relType: string
}

export interface TreeResponse {
  nodes: FlowNode[]
  edges: FlowEdge[]
}
