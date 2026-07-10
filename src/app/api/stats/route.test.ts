import { GET } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  neo4jErrorResponse: jest.fn((err: unknown, publicMessage: string, status = 500) => {
    const detail = err instanceof Error ? err.message : String(err)
    return Response.json({ error: publicMessage, detail }, { status })
  }),
}))

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

describe('GET /api/stats', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 200 with the full StatsResponse shape', async () => {
    mockRead
      .mockResolvedValueOnce([{ totalPeople: 3, male: 1, female: 2, unknown: 0 }]) // totals
      .mockResolvedValueOnce([{ unionCount: 1 }]) // unions
      .mockResolvedValueOnce([{ decade: 1950, count: 2 }]) // decades
      .mockResolvedValueOnce([{ surname: 'Doe', count: 2 }]) // surnames
      .mockResolvedValueOnce([{ birthPlace: 'London', count: 1 }]) // birthplaces
      .mockResolvedValueOnce([{ averageLifespan: 75.5 }]) // lifespan
      .mockResolvedValueOnce([{ gedcomId: 'I001', name: 'John Doe', birthYear: '1900' }]) // oldest
      .mockResolvedValueOnce([{ unionId: 'U001', childCount: 4, parents: ['John Doe', 'Jane Doe'] }]) // largest union

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      totalPeople: 3,
      sexBreakdown: { male: 1, female: 2, unknown: 0 },
      unionCount: 1,
      birthsByDecade: [{ decade: 1950, count: 2 }],
      topSurnames: [{ surname: 'Doe', count: 2 }],
      topBirthplaces: [{ birthPlace: 'London', count: 1 }],
      averageLifespan: 75.5,
      oldestAncestor: { gedcomId: 'I001', name: 'John Doe', birthYear: '1900' },
      largestUnion: { unionId: 'U001', childCount: 4, parents: ['John Doe', 'Jane Doe'] },
    })
  })

  it('returns null averageLifespan, oldestAncestor, and largestUnion when no qualifying rows exist', async () => {
    mockRead
      .mockResolvedValueOnce([{ totalPeople: 0, male: 0, female: 0, unknown: 0 }])
      .mockResolvedValueOnce([{ unionCount: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ averageLifespan: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.averageLifespan).toBeNull()
    expect(body.oldestAncestor).toBeNull()
    expect(body.largestUnion).toBeNull()
  })

  it('derives surnames using the last-token split and excludes [Unknown] and single-token names', async () => {
    mockRead.mockResolvedValue([])

    await GET()

    const surnameQuery = mockRead.mock.calls.find(([cypher]) =>
      cypher.includes('AS surname')
    )?.[0]

    expect(surnameQuery).toBeDefined()
    expect(surnameQuery).toContain("cleanName <> '[Unknown]'")
    expect(surnameQuery).toContain('size(parts) > 1')
    expect(surnameQuery).toContain('last(parts) AS surname')
  })

  it('excludes persons with missing or non-numeric birth/death years from the lifespan query', async () => {
    mockRead.mockResolvedValue([])

    await GET()

    const lifespanQuery = mockRead.mock.calls.find(([cypher]) =>
      cypher.includes('AS averageLifespan')
    )?.[0]

    expect(lifespanQuery).toBeDefined()
    expect(lifespanQuery).toContain('p.birthYear IS NOT NULL AND p.birthYear =~ $yearPattern')
    expect(lifespanQuery).toContain('p.deathYear IS NOT NULL AND p.deathYear =~ $yearPattern')
  })

  it('returns 500 via neo4jErrorResponse when the Neo4j driver fails', async () => {
    mockRead.mockRejectedValue(new Error('DB connection lost'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to query graph database', detail: 'DB connection lost' })
  })
})
