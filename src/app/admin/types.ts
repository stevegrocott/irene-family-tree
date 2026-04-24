export interface Change {
  id: string
  changeType: 'UPDATE_PERSON' | 'CREATE_PERSON' | 'ADD_RELATIONSHIP' | 'DELETE_PERSON'
  targetId: string
  personName: string | null
  authorName: string
  authorEmail: string
  previousValue: Record<string, unknown> | null
  newValue: Record<string, unknown>
  appliedAt: string
  status: string
}
