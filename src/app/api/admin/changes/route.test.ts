import { GET } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  neo4jErrorResponse: jest.fn((err: unknown, publicMessage: string, status = 500) => {
    const detail = err instanceof Error ? err.message : String(err)
    return Response.json({ error: publicMessage, detail }, { status })
  }),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

import { auth } from '@/auth'
const mockAuth = auth as jest.MockedFunction<typeof auth>

const ADMIN_SESSION = { user: { email: 'admin@example.com', name: 'Admin', role: 'admin' } }
const USER_SESSION = { user: { email: 'user@example.com', name: 'User', role: 'user' } }

const makeRequest = (url = 'http://localhost/api/admin/changes') => new Request(url)

const makeChangeRow = (id: string) => ({
  id,
  changeType: 'update',
  targetId: `person-${id}`,
  personName: null,
  authorName: 'Admin',
  authorEmail: 'admin@example.com',
  previousValue: null,
  newValue: '{}',
  appliedAt: '2026-01-01T00:00:00.000Z',
  status: 'live',
})

describe('GET /api/admin/changes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when the authenticated user is not an admin', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Forbidden' })
  })

  it('returns 500 when the Neo4j read throws', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockRejectedValue(new Error('Connection refused'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to query graph database', detail: 'Connection refused' })
  })

  it('queries PAGE_SIZE + 1 rows', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([])

    await GET(makeRequest())

    expect(mockRead).toHaveBeenCalledWith(
      expect.any(String),
      { skip: 0, limit: 21 }
    )
  })

  it('returns hasMore:false and all rows when the query returns PAGE_SIZE or fewer rows', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const rows = Array.from({ length: 20 }, (_, i) => makeChangeRow(String(i)))
    mockRead.mockResolvedValue(rows)

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.hasMore).toBe(false)
    expect(body.changes).toHaveLength(20)
  })

  it('returns hasMore:true and trims to PAGE_SIZE rows when the query returns PAGE_SIZE + 1 rows', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const rows = Array.from({ length: 21 }, (_, i) => makeChangeRow(String(i)))
    mockRead.mockResolvedValue(rows)

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.hasMore).toBe(true)
    expect(body.changes).toHaveLength(20)
    expect(body.changes.map((c: { id: string }) => c.id)).toEqual(
      rows.slice(0, 20).map(r => r.id)
    )
  })

  it('uses skip based on the requested page', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([])

    await GET(makeRequest('http://localhost/api/admin/changes?page=3'))

    expect(mockRead).toHaveBeenCalledWith(
      expect.any(String),
      { skip: 40, limit: 21 }
    )
  })
})
