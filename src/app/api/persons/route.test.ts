import { GET, POST } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  write: jest.fn(),
}))

import { read, write } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>
const mockWrite = write as jest.MockedFunction<typeof write>

const makeRequest = (url = 'http://localhost/api/persons') =>
  new Request(url) as unknown as Request

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

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(persons)
  })

  it('returns 200 with empty array when no persons exist', async () => {
    mockRead.mockResolvedValue([])

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([])
  })

  it('returns persons with nullable birthYear and deathYear fields', async () => {
    const persons = [{ gedcomId: 'I001', name: 'John', sex: 'M', birthYear: null, deathYear: null }]
    mockRead.mockResolvedValue(persons)

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(body[0].birthYear).toBeNull()
    expect(body[0].deathYear).toBeNull()
  })

  it('passes the correct Cypher query to read', async () => {
    mockRead.mockResolvedValue([])

    await GET(makeRequest())

    expect(mockRead).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (p:Person)')
    )
  })

  it('filters by name when ?q= is provided', async () => {
    const persons = [{ gedcomId: 'I001', name: 'John Doe', sex: 'M', birthYear: '1900', deathYear: null }]
    mockRead.mockResolvedValue(persons)

    const response = await GET(makeRequest('http://localhost/api/persons?q=John'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(persons)
    expect(mockRead).toHaveBeenCalledWith(
      expect.stringContaining('WHERE p.name CONTAINS $q'),
      { q: 'John' }
    )
  })

  it('does not apply WHERE filter when ?q= is absent', async () => {
    mockRead.mockResolvedValue([])

    await GET(makeRequest())

    const [query] = (mockRead as jest.Mock).mock.calls[0]
    expect(query).not.toContain('WHERE')
  })
})

describe('POST /api/persons', () => {
  const makePostRequest = (body: unknown) =>
    new Request('http://localhost/api/persons', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 when name is missing', async () => {
    const response = await POST(makePostRequest({ sex: 'M' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'name is required' })
  })

  it('returns 400 when body is invalid JSON', async () => {
    const request = new Request('http://localhost/api/persons', {
      method: 'POST',
      body: 'not-json',
    })
    const response = await POST(request)

    expect(response.status).toBe(400)
  })

  it('returns 201 with created person on success', async () => {
    const created = {
      gedcomId: '@U12345678@',
      name: 'Alice Test',
      sex: 'F',
      birthYear: '1990',
      birthPlace: 'London',
    }
    mockWrite.mockResolvedValue([created])

    const response = await POST(makePostRequest({ name: 'Alice Test', sex: 'F', birthYear: '1990', birthPlace: 'London' }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toMatchObject({ name: 'Alice Test', sex: 'F', birthYear: '1990', birthPlace: 'London' })
  })

  it('returns 201 with only name provided', async () => {
    mockWrite.mockResolvedValue([{ gedcomId: '@U00000000@', name: 'Bob', sex: null, birthYear: null, birthPlace: null }])

    const response = await POST(makePostRequest({ name: 'Bob' }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.name).toBe('Bob')
  })

  it('generates a gedcomId matching @U<8 hex chars>@ pattern', async () => {
    mockWrite.mockImplementation(async (_cypher, params) => [{
      gedcomId: (params as Record<string, unknown>).gedcomId as string,
      name: 'Alice',
      sex: null,
      birthYear: null,
      birthPlace: null,
    }])

    const response = await POST(makePostRequest({ name: 'Alice' }))
    const body = await response.json()

    expect(body.gedcomId).toMatch(/^@U[0-9a-f]{8}@$/)
  })

  it('passes name, sex, birthYear, birthPlace to the write call', async () => {
    mockWrite.mockResolvedValue([{ gedcomId: '@U00000000@', name: 'Carol', sex: 'F', birthYear: '1985', birthPlace: 'Paris' }])

    await POST(makePostRequest({ name: 'Carol', sex: 'F', birthYear: '1985', birthPlace: 'Paris' }))

    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('CREATE'),
      expect.objectContaining({ name: 'Carol', sex: 'F', birthYear: '1985', birthPlace: 'Paris' })
    )
  })

  it('returns 500 when Neo4j write throws', async () => {
    mockWrite.mockRejectedValue(new Error('DB error'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makePostRequest({ name: 'Alice' }))

    expect(response.status).toBe(500)
  })
})
