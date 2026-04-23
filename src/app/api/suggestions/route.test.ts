import { POST } from './route'

jest.mock('@/lib/neo4j', () => ({
  write: jest.fn(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

import { write } from '@/lib/neo4j'
const mockWrite = write as jest.MockedFunction<typeof write>

import { auth } from '@/auth'
const mockAuth = auth as jest.MockedFunction<typeof auth>

const authedSession = { user: { email: 'user@example.com', name: 'Test User' } }

const makeRequest = (body: unknown) =>
  new Request('http://localhost/api/suggestions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

describe('POST /api/suggestions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue(authedSession as never)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await POST(makeRequest({ changeType: 'UPDATE_PERSON', payload: {} }))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when changeType is missing', async () => {
    const response = await POST(makeRequest({ payload: { name: 'Alice' } }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'changeType and payload are required' })
  })

  it('returns 400 when payload is missing', async () => {
    const response = await POST(makeRequest({ changeType: 'UPDATE_PERSON' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'changeType and payload are required' })
  })

  it('returns 400 when changeType is not in the allowed enum', async () => {
    const response = await POST(
      makeRequest({ changeType: 'DELETE_PERSON', payload: { id: '123' } })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Invalid changeType' })
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('returns 400 when body is invalid JSON', async () => {
    const request = new Request('http://localhost/api/suggestions', {
      method: 'POST',
      body: 'not-json',
    })
    const response = await POST(request)

    expect(response.status).toBe(400)
  })

  it('returns 201 with the created id on success', async () => {
    mockWrite.mockResolvedValue([{ id: 'some-uuid' }])

    const response = await POST(makeRequest({ changeType: 'UPDATE_PERSON', payload: { name: 'Alice' } }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toHaveProperty('id')
  })

  it('writes PendingChange node with correct fields', async () => {
    mockWrite.mockResolvedValue([{ id: 'some-uuid' }])

    await POST(makeRequest({ changeType: 'UPDATE_PERSON', payload: { name: 'Alice' } }))

    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('PendingChange'),
      expect.objectContaining({
        authorEmail: 'user@example.com',
        authorName: 'Test User',
        changeType: 'UPDATE_PERSON',
        payload: JSON.stringify({ name: 'Alice' }),
        status: 'pending',
      })
    )
  })

  it('returns 500 when Neo4j write throws', async () => {
    mockWrite.mockRejectedValue(new Error('DB error'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makeRequest({ changeType: 'UPDATE_PERSON', payload: { name: 'Alice' } }))

    expect(response.status).toBe(500)
  })
})
