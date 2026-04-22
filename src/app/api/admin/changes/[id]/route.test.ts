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
  new Request('http://localhost/api/admin/changes/change-1', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

const liveChange = {
  id: 'change-1',
  targetId: 'I001',
  previousValue: null,
  status: 'live',
}

describe('POST /api/admin/changes/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)

    const response = await POST(makeRequest({ action: 'keep' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when the authenticated user is not an admin', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)

    const response = await POST(makeRequest({ action: 'keep' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Forbidden' })
  })

  it('returns 400 when the request body is not valid JSON', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const request = new Request('http://localhost/api/admin/changes/change-1', {
      method: 'POST',
      body: 'not-json',
    })

    const response = await POST(request, makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Invalid JSON body' })
  })

  it('returns 400 when action is missing', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)

    const response = await POST(makeRequest({}), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'action must be "keep" or "revert"' })
  })

  it('returns 400 when action is an unrecognised value', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)

    const response = await POST(makeRequest({ action: 'delete' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'action must be "keep" or "revert"' })
  })

  it('returns 500 when the Neo4j read throws', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockRejectedValue(new Error('Connection refused'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makeRequest({ action: 'keep' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to query graph database' })
  })

  it('returns 404 when no change record is found', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([])

    const response = await POST(makeRequest({ action: 'keep' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Change not found' })
  })

  it('returns 409 when the change status is not live', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([{ ...liveChange, status: 'kept' }])

    const response = await POST(makeRequest({ action: 'keep' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Change is not pending review' })
  })

  it('returns 200 with success:true and sets status to kept on keep action', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([liveChange])
    mockWrite.mockResolvedValue([])

    const response = await POST(makeRequest({ action: 'keep' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'kept'"),
      { id: 'change-1' }
    )
  })

  it('returns 200 and reverts person fields when action is revert with a previousValue object', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const prev = { name: 'Old Name', occupation: 'Farmer', notes: 'Old notes' }
    mockRead.mockResolvedValue([{ ...liveChange, previousValue: prev }])
    mockWrite.mockResolvedValue([])

    const response = await POST(makeRequest({ action: 'revert' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET p += $prevValue"),
      expect.objectContaining({ id: 'change-1', prevValue: prev })
    )
  })

  it('returns 200 and reverts person fields when previousValue is a JSON string', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const prev = { name: 'Old Name', birthYear: '1900' }
    mockRead.mockResolvedValue([{ ...liveChange, previousValue: JSON.stringify(prev) }])
    mockWrite.mockResolvedValue([])

    const response = await POST(makeRequest({ action: 'revert' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET p += $prevValue"),
      expect.objectContaining({ id: 'change-1', prevValue: prev })
    )
  })

  it('strips disallowed fields from previousValue during revert', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const prev = { name: 'Old Name', password: 'secret', admin: true }
    mockRead.mockResolvedValue([{ ...liveChange, previousValue: prev }])
    mockWrite.mockResolvedValue([])

    await POST(makeRequest({ action: 'revert' }), makeParams('change-1'))

    const callArgs = (mockWrite as jest.Mock).mock.calls[0][1] as { prevValue: Record<string, unknown> }
    expect(callArgs.prevValue).not.toHaveProperty('password')
    expect(callArgs.prevValue).not.toHaveProperty('admin')
    expect(callArgs.prevValue).toHaveProperty('name', 'Old Name')
  })

  it('returns 200 and sets status to reverted without touching person when previousValue is null', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([{ ...liveChange, previousValue: null }])
    mockWrite.mockResolvedValue([])

    const response = await POST(makeRequest({ action: 'revert' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'reverted'"),
      { id: 'change-1' }
    )
    expect(mockWrite).not.toHaveBeenCalledWith(
      expect.stringContaining("SET p += $prevValue"),
      expect.anything()
    )
  })

  it('returns 500 when the Neo4j write throws', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([liveChange])
    mockWrite.mockRejectedValue(new Error('Write failed'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makeRequest({ action: 'keep' }), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to update graph database' })
  })

  it('passes the change id from the route params to the Neo4j read call', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([{ ...liveChange, id: 'change-99' }])
    mockWrite.mockResolvedValue([])

    await POST(makeRequest({ action: 'keep' }), makeParams('change-99'))

    expect(mockRead).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (c:Change {id: $id})'),
      { id: 'change-99' }
    )
  })
})
