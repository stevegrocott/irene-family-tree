import type { Session } from 'next-auth'
import { neo4jErrorResponseMock } from '@/test-utils/neo4jMock'
import { GET } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  ...neo4jErrorResponseMock(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

import { auth } from '@/auth'
type AuthFn = () => Promise<Session | null>
const mockAuth = auth as unknown as jest.MockedFunction<AuthFn>

const ADMIN_SESSION: Session = {
  user: { email: 'admin@example.com', name: 'Admin', role: 'admin' },
  expires: '2100-01-01T00:00:00.000Z',
}
const USER_SESSION: Session = {
  user: { email: 'user@example.com', name: 'User', role: 'user' },
  expires: '2100-01-01T00:00:00.000Z',
}

const makeDuplicateRow = (suffix: string) => ({
  gedcomId1: `I00${suffix}a`,
  name1: 'John Doe',
  sex1: 'M',
  birthYear1: '1900',
  deathYear1: '1970',
  birthPlace1: 'Springfield',
  deathPlace1: 'Springfield',
  occupation1: 'Farmer',
  notes1: null,
  gedcomId2: `I00${suffix}b`,
  name2: 'John Doe',
  sex2: 'M',
  birthYear2: '1901',
  deathYear2: '1971',
  birthPlace2: 'Springfield',
  deathPlace2: 'Springfield',
  occupation2: 'Farmer',
  notes2: null,
})

const makeExpectedPerson = (
  gedcomId: string,
  birthYear: string,
  deathYear: string,
) => ({
  gedcomId,
  name: 'John Doe',
  sex: 'M',
  birthYear,
  deathYear,
  birthPlace: 'Springfield',
  deathPlace: 'Springfield',
  occupation: 'Farmer',
  notes: null,
})

describe('GET /api/admin/duplicates', () => {
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
    mockAuth.mockResolvedValue(USER_SESSION)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Forbidden' })
  })

  it('returns 200 with an empty duplicates array when none exist', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    mockRead.mockResolvedValue([])

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ duplicates: [] })
  })

  it('returns 200 with duplicate pairs mapped into person1/person2 objects', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    mockRead.mockResolvedValue([makeDuplicateRow('1')])

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.duplicates).toHaveLength(1)
    expect(body.duplicates[0]).toEqual({
      person1: makeExpectedPerson('I001a', '1900', '1970'),
      person2: makeExpectedPerson('I001b', '1901', '1971'),
    })
  })

  it('queries Person pairs with normalized name match, birthYear window, and gedcomId ordering', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    mockRead.mockResolvedValue([])

    await GET()

    const [cypher, params] = mockRead.mock.calls[0]
    expect(cypher).toMatch(/toLower\(p1\.name\)/)
    expect(cypher).toMatch(/toLower\(p2\.name\)/)
    expect(cypher).toMatch(/p1\.gedcomId\s*<\s*p2\.gedcomId/)
    expect(cypher).toContain('LIMIT')
    expect(params).toEqual(expect.objectContaining({ limit: expect.any(Number) }))
  })

  it('returns 500 when the Neo4j read throws', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION)
    mockRead.mockRejectedValue(new Error('Connection refused'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to query graph database', detail: 'Connection refused' })
  })
})
