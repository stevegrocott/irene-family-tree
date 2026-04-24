import { POST } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  write: jest.fn(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

jest.mock('@/lib/changes', () => ({
  recordChange: jest.fn(),
}))

import { read, write } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>
const mockWrite = write as jest.MockedFunction<typeof write>

import { auth } from '@/auth'
const mockAuth = auth as jest.MockedFunction<typeof auth>

import { recordChange } from '@/lib/changes'
const mockRecordChange = recordChange as jest.MockedFunction<typeof recordChange>

const ADMIN_SESSION = { user: { email: 'admin@example.com', name: 'Admin', role: 'admin' } }
const USER_SESSION = { user: { email: 'user@example.com', name: 'User', role: 'user' } }

const makeRequest = (body: unknown) =>
  new Request('http://localhost/api/admin/suggestions/sg-1', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

const pendingSuggestion = {
  id: 'sg-1',
  changeType: 'UPDATE_PERSON',
  payload: null,
  status: 'pending',
  authorEmail: 'author@example.com',
  authorName: 'Original Author',
}

describe('POST /api/admin/suggestions/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)

    const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when the authenticated user is not an admin', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)

    const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Forbidden' })
  })

  it('returns 400 when the request body is not valid JSON', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const request = new Request('http://localhost/api/admin/suggestions/sg-1', {
      method: 'POST',
      body: 'not-json',
    })

    const response = await POST(request, makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Invalid JSON body' })
  })

  it('returns 400 when action is missing', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)

    const response = await POST(makeRequest({}), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'action must be "approve" or "decline"' })
  })

  it('returns 400 when action is an unrecognised value', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)

    const response = await POST(makeRequest({ action: 'delete' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'action must be "approve" or "decline"' })
  })

  it('returns 500 when the Neo4j read throws', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockRejectedValue(new Error('Connection refused'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to query graph database' })
  })

  it('returns 404 when no suggestion record is found', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([])

    const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Suggestion not found' })
  })

  it('returns 409 when the suggestion status is not pending', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([{ ...pendingSuggestion, status: 'approved' }])

    const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Suggestion is not pending' })
  })

  it('returns 200 with success:true and sets status to approved on approve action with no payload fields', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([pendingSuggestion])
    mockWrite.mockResolvedValue([])

    const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'approved'"),
      { id: 'sg-1' }
    )
  })

  it('applies payload fields to the person and sets status to approved for UPDATE_PERSON', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const newVal = { name: 'John Doe', occupation: 'Farmer' }
    mockRead.mockResolvedValue([{
      ...pendingSuggestion,
      payload: JSON.stringify({ targetId: 'I001', ...newVal }),
    }])
    mockWrite.mockResolvedValue([{ id: 'sg-1' }])

    const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('SET p += $newValue'),
      expect.objectContaining({ id: 'sg-1', newValue: newVal })
    )
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'approved'"),
      expect.any(Object)
    )
  })

  it('strips disallowed fields from payload during UPDATE_PERSON approve', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const newVal = { name: 'John Doe', password: 'secret', admin: true }
    mockRead.mockResolvedValue([{
      ...pendingSuggestion,
      payload: JSON.stringify({ targetId: 'I001', ...newVal }),
    }])
    mockWrite.mockResolvedValue([{ id: 'sg-1' }])

    await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))

    const callArgs = (mockWrite as jest.Mock).mock.calls[0][1] as { newValue: Record<string, unknown> }
    expect(callArgs.newValue).not.toHaveProperty('password')
    expect(callArgs.newValue).not.toHaveProperty('admin')
    expect(callArgs.newValue).toHaveProperty('name', 'John Doe')
  })

  it('creates a new Person node and sets status to approved for CREATE_PERSON', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([{
      ...pendingSuggestion,
      changeType: 'CREATE_PERSON',
      payload: JSON.stringify({ name: 'Jane Doe', sex: 'F' }),
    }])
    mockWrite.mockResolvedValue([])

    const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('CREATE (p:Person'),
      expect.objectContaining({ id: 'sg-1' })
    )
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'approved'"),
      expect.any(Object)
    )
  })

  describe('ADD_RELATIONSHIP (type: parent) approval', () => {
    const parentSuggestion = {
      ...pendingSuggestion,
      changeType: 'ADD_RELATIONSHIP',
      payload: JSON.stringify({ type: 'parent', targetId: 'PARENT_ID', childId: 'CHILD_ID' }),
    }

    it('creates UNION and CHILD edges (not HAS_MEMBER) and returns 200', async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION as never)
      mockRead.mockResolvedValue([parentSuggestion])
      mockWrite.mockResolvedValue([{ unionId: '@Fabc12345@', created: true }])

      const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ success: true })

      const approvalCall = (mockWrite as jest.Mock).mock.calls.find(
        ([cypher]: [string]) => cypher.includes('MATCH (child:Person') && cypher.includes('(parent:Person')
      )
      expect(approvalCall).toBeDefined()
      const [approvalCypher, approvalParams] = approvalCall as [string, Record<string, unknown>]

      expect(approvalCypher).toContain('(parent)-[:UNION]->')
      expect(approvalCypher).toContain('-[:CHILD]->(child)')
      expect(approvalCypher).toContain(':Union')
      expect(approvalCypher).not.toMatch(/HAS_MEMBER/)
      expect(approvalParams).toEqual(
        expect.objectContaining({ id: 'sg-1', childId: 'CHILD_ID', targetId: 'PARENT_ID' })
      )
      expect(approvalParams.unionId).toEqual(expect.stringMatching(/^@F[0-9a-f]{8}@$/))
    })

    it('does not emit any HAS_MEMBER Cypher across all write calls', async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION as never)
      mockRead.mockResolvedValue([parentSuggestion])
      mockWrite.mockResolvedValue([{ unionId: '@Fabc12345@', created: true }])

      await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))

      for (const call of (mockWrite as jest.Mock).mock.calls) {
        expect(call[0]).not.toMatch(/HAS_MEMBER/)
      }
    })

    it('records a Change node with the ORIGINAL author (not the admin)', async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION as never)
      mockRead.mockResolvedValue([parentSuggestion])
      mockWrite.mockResolvedValue([{ unionId: '@Fabc12345@', created: true }])

      const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))

      expect(response.status).toBe(200)
      expect(mockRecordChange).toHaveBeenCalledTimes(1)
      expect(mockRecordChange).toHaveBeenCalledWith(
        'author@example.com',
        'Original Author',
        'ADD_RELATIONSHIP',
        'CHILD_ID',
        null,
        { type: 'parent', targetId: 'PARENT_ID', unionId: '@Fabc12345@' }
      )
    })

    it('does not use the admin email/name when recording the Change', async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION as never)
      mockRead.mockResolvedValue([parentSuggestion])
      mockWrite.mockResolvedValue([{ unionId: '@Fabc12345@', created: true }])

      await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))

      const [calledEmail, calledName] = mockRecordChange.mock.calls[0]
      expect(calledEmail).not.toBe(ADMIN_SESSION.user.email)
      expect(calledName).not.toBe(ADMIN_SESSION.user.name)
    })

    it('skips recordChange when the union already existed (created=false)', async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION as never)
      mockRead.mockResolvedValue([parentSuggestion])
      mockWrite.mockResolvedValue([{ unionId: '@Fexisting@', created: false }])

      const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))

      expect(response.status).toBe(200)
      expect(mockRecordChange).not.toHaveBeenCalled()
    })

    it('returns 409 when the parent or child person no longer exists', async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION as never)
      mockRead.mockResolvedValue([parentSuggestion])
      mockWrite.mockResolvedValue([])

      const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body).toEqual({
        error: 'Target person(s) no longer exist; suggestion cannot be applied',
      })
      expect(mockRecordChange).not.toHaveBeenCalled()
    })

    it('treats recordChange failures as non-fatal and still returns 200', async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION as never)
      mockRead.mockResolvedValue([parentSuggestion])
      mockWrite.mockResolvedValue([{ unionId: '@Fabc12345@', created: true }])
      mockRecordChange.mockRejectedValueOnce(new Error('audit db down'))
      jest.spyOn(console, 'error').mockImplementation(() => {})

      const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ success: true })
    })
  })

  it('returns 200 and sets status to declined on decline action', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([pendingSuggestion])
    mockWrite.mockResolvedValue([])

    const response = await POST(makeRequest({ action: 'decline' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'declined'"),
      expect.objectContaining({ id: 'sg-1' })
    )
  })

  it('persists declineReason on the PendingChange node when a reason is provided', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([pendingSuggestion])
    mockWrite.mockResolvedValue([])

    const response = await POST(
      makeRequest({ action: 'decline', reason: 'Insufficient evidence' }),
      makeParams('sg-1')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('c.declineReason = $reason'),
      { id: 'sg-1', reason: 'Insufficient evidence' }
    )
  })

  it('passes declineReason as null when no reason is provided', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([pendingSuggestion])
    mockWrite.mockResolvedValue([])

    await POST(makeRequest({ action: 'decline' }), makeParams('sg-1'))

    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('c.declineReason = $reason'),
      { id: 'sg-1', reason: null }
    )
  })

  it('does not modify the person record when declining', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([{
      ...pendingSuggestion,
      payload: JSON.stringify({ targetId: 'I001', name: 'John Doe' }),
    }])
    mockWrite.mockResolvedValue([])

    await POST(makeRequest({ action: 'decline' }), makeParams('sg-1'))

    expect(mockWrite).not.toHaveBeenCalledWith(
      expect.stringContaining('SET p += $newValue'),
      expect.anything()
    )
  })

  it('returns 500 when the Neo4j write throws', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([pendingSuggestion])
    mockWrite.mockRejectedValue(new Error('Write failed'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to update graph database' })
  })

  it('passes the suggestion id from route params to the Neo4j read call against PendingChange', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([{ ...pendingSuggestion, id: 'sg-99' }])
    mockWrite.mockResolvedValue([])

    await POST(makeRequest({ action: 'approve' }), makeParams('sg-99'))

    expect(mockRead).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (c:PendingChange {id: $id})'),
      { id: 'sg-99' }
    )
  })
})
