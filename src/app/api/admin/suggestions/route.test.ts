import { GET } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
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

describe('GET /api/admin/suggestions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when the authenticated user is not an admin', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Forbidden' })
  })

  it('returns 200 with an empty suggestions array when none exist', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([])

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ suggestions: [] })
  })

  it('returns 200 with parsed suggestion data including JSON fields', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const row = {
      id: 'sg-1',
      changeType: 'UPDATE_PERSON',
      targetId: 'I001',
      personName: 'John Doe',
      authorName: 'Jane Smith',
      authorEmail: 'jane@example.com',
      previousValue: JSON.stringify({ name: 'John' }),
      newValue: JSON.stringify({ name: 'John Doe' }),
      appliedAt: '2024-01-01T00:00:00Z',
      status: 'pending',
    }
    mockRead.mockResolvedValue([row])

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.suggestions).toHaveLength(1)
    expect(body.suggestions[0].previousValue).toEqual({ name: 'John' })
    expect(body.suggestions[0].newValue).toEqual({ name: 'John Doe' })
  })

  it("queries Neo4j for changes with status 'pending'", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([])

    await GET()

    expect(mockRead).toHaveBeenCalledWith(
      expect.stringContaining("status: 'pending'"),
      expect.any(Object)
    )
  })

  it('returns 500 when Neo4j read throws', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockRejectedValue(new Error('Connection refused'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to query graph database' })
  })
})
