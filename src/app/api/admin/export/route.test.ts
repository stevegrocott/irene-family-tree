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

describe('GET /api/admin/export', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRead.mockResolvedValue([])
  })

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('returns 403 when the authenticated user is not an admin', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Forbidden' })
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('returns 500 when the Neo4j read throws', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockRejectedValue(new Error('Connection refused'))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to query graph database', detail: 'Connection refused' })
  })

  it('returns the GEDCOM document with a text/plain Content-Type on success', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)

    const response = await GET()
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(text).toMatch(/^0 HEAD/)
    expect(text).toMatch(/0 TRLR\n$/)
  })

  it('sets a Content-Disposition attachment header with a filename dated to today', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)

    const response = await GET()
    const dateStamp = new Date().toISOString().slice(0, 10)

    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="family-tree-${dateStamp}.ged"`
    )
  })
})
