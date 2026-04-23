import { POST } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  write: jest.fn(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

jest.mock('@/lib/revert', () => ({
  revertChange: jest.fn(),
}))

import { read, write } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>
const mockWrite = write as jest.MockedFunction<typeof write>

import { auth } from '@/auth'
const mockAuth = auth as jest.MockedFunction<typeof auth>

import { revertChange } from '@/lib/revert'
const mockRevert = revertChange as jest.MockedFunction<typeof revertChange>

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
    expect(mockRevert).not.toHaveBeenCalled()
  })

  it('returns 500 when the Neo4j write throws on keep action', async () => {
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

  describe('revert action delegation', () => {
    it('delegates to revertChange with the change id and reverter derived from the admin session', async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION as never)
      mockRead.mockResolvedValue([liveChange])
      mockRevert.mockResolvedValue({ ok: true })

      const response = await POST(makeRequest({ action: 'revert' }), makeParams('change-1'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ success: true })
      expect(mockRevert).toHaveBeenCalledWith('change-1', {
        email: 'admin@example.com',
        name: 'Admin',
      })
    })

    it('surfaces 409 conflict from revertChange with conflictingChange payload', async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION as never)
      mockRead.mockResolvedValue([liveChange])
      const conflict = {
        kind: 'has-relationships' as const,
        detail: 'Person has 2 relationship(s); remove them before reverting.',
      }
      mockRevert.mockResolvedValue({
        ok: false,
        status: 409,
        error: 'Cannot revert: person has relationships',
        conflict,
      })

      const response = await POST(makeRequest({ action: 'revert' }), makeParams('change-1'))
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body).toEqual({
        error: 'Cannot revert: person has relationships',
        conflictingChange: conflict,
      })
    })

    it('falls back to email for name when session has no name', async () => {
      mockAuth.mockResolvedValue({
        user: { email: 'noname@example.com', role: 'admin' },
      } as never)
      mockRead.mockResolvedValue([liveChange])
      mockRevert.mockResolvedValue({ ok: true })

      await POST(makeRequest({ action: 'revert' }), makeParams('change-1'))

      expect(mockRevert).toHaveBeenCalledWith('change-1', {
        email: 'noname@example.com',
        name: 'noname@example.com',
      })
    })
  })
})
