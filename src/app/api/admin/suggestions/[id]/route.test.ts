import { POST } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  write: jest.fn(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

import { read, write } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>
const mockWrite = write as jest.MockedFunction<typeof write>

import { auth } from '@/auth'
const mockAuth = auth as jest.MockedFunction<typeof auth>

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
    mockWrite.mockResolvedValue([])

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
    mockWrite.mockResolvedValue([])

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

  it('creates a relationship between persons and sets status to approved for ADD_RELATIONSHIP', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([{
      ...pendingSuggestion,
      changeType: 'ADD_RELATIONSHIP',
      payload: JSON.stringify({ personId: 'I001', relativeId: 'I002', type: 'spouse' }),
    }])
    mockWrite.mockResolvedValue([])

    const response = await POST(makeRequest({ action: 'approve' }), makeParams('sg-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (p1:Person'),
      expect.objectContaining({ id: 'sg-1' })
    )
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'approved'"),
      expect.any(Object)
    )
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
      { id: 'sg-1' }
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
