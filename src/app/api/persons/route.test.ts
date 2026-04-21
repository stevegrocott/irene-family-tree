import { GET } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
}))

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

describe('GET /api/persons', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 200 with an array of persons matching the Person shape', async () => {
    const persons = [
      { gedcomId: 'I001', name: 'John Doe', sex: 'M', birthYear: '1900', deathYear: '1980' },
      { gedcomId: 'I002', name: 'Jane Doe', sex: 'F', birthYear: '1905', deathYear: null },
    ]
    mockRead.mockResolvedValue(persons)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(persons)
  })

  it('returns 200 with empty array when no persons exist', async () => {
    mockRead.mockResolvedValue([])

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([])
  })

  it('returns persons with nullable birthYear and deathYear fields', async () => {
    const persons = [{ gedcomId: 'I001', name: 'John', sex: 'M', birthYear: null, deathYear: null }]
    mockRead.mockResolvedValue(persons)

    const response = await GET()
    const body = await response.json()

    expect(body[0].birthYear).toBeNull()
    expect(body[0].deathYear).toBeNull()
  })

  it('passes the correct Cypher query to read', async () => {
    mockRead.mockResolvedValue([])

    await GET()

    expect(mockRead).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (p:Person)')
    )
  })
})
