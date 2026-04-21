/**
 * Unit tests for GET /api/person/[id].
 *
 * Verifies that the route handler returns the correct HTTP status codes and
 * response shapes for success, not-found, and database-error scenarios.
 * Neo4j `read` is fully mocked so no live database connection is required.
 */
import { GET } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
}))

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

/**
 * Creates a minimal Request object targeting the person-by-id endpoint.
 *
 * @returns {Request} A GET request to `/api/person/I001`
 */
const makeRequest = () => new Request('http://localhost/api/person/I001')

/**
 * Constructs the route segment params object expected by the Next.js handler.
 *
 * @param {string} id - GEDCOM person ID to embed in the params promise
 * @returns {{ params: Promise<{ id: string }> }} Route context with resolved params
 */
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

/**
 * Fully-populated PersonDetail fixture used across multiple test cases.
 * Covers all scalar fields plus nested parents, siblings, marriages, and children.
 */
const personDetail = {
  gedcomId: 'I001',
  name: 'John Doe',
  sex: 'M',
  birthYear: '1900',
  deathYear: '1980',
  birthPlace: 'London, England',
  deathPlace: 'New York, USA',
  occupation: 'Farmer',
  notes: 'Some notes',
  parents: [
    { gedcomId: 'I002', name: 'James Doe', sex: 'M', birthYear: '1870', deathYear: '1940' },
  ],
  siblings: [
    { gedcomId: 'I003', name: 'Jane Doe', sex: 'F', birthYear: '1902', deathYear: null },
  ],
  marriages: [
    {
      unionId: 'F001',
      marriageYear: '1925',
      marriagePlace: 'Boston, MA',
      spouse: { gedcomId: 'I004', name: 'Mary Smith', sex: 'F', birthYear: '1903', deathYear: '1985' },
      children: [
        { gedcomId: 'I005', name: 'Robert Doe', sex: 'M', birthYear: '1926', deathYear: null },
      ],
    },
  ],
}

/**
 * Test suite for the GET /api/person/[id] route handler.
 * Covers 404 not-found cases, 500 database errors, successful 200 responses,
 * correct query parameterisation, and all nullable/optional field edge cases.
 */
describe('GET /api/person/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  /** Returns 404 when the database finds no record for the requested id. */
  it('returns 404 when no person matches the given id', async () => {
    mockRead.mockResolvedValue([])

    const response = await GET(makeRequest(), makeParams('MISSING'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Person not found' })
  })

  /** Returns 404 when the database row exists but gedcomId is null (guard for corrupt data). */
  it('returns 404 when the row has a null gedcomId', async () => {
    mockRead.mockResolvedValue([{ ...personDetail, gedcomId: null }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Person not found' })
  })

  /** Returns 500 with a generic error message when the Neo4j driver rejects. */
  it('returns 500 when the Neo4j query throws', async () => {
    mockRead.mockRejectedValue(new Error('Connection refused'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to query graph database' })
  })

  /** Returns 200 with the complete PersonDetail object when a matching record is found. */
  it('returns 200 with the PersonDetail shape on success', async () => {
    mockRead.mockResolvedValue([personDetail])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(personDetail)
  })

  /** Verifies the route forwards the dynamic `id` segment as a Cypher query parameter. */
  it('passes the id param to the Neo4j read call', async () => {
    mockRead.mockResolvedValue([personDetail])

    await GET(makeRequest(), makeParams('I001'))

    expect(mockRead).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (p:Person {gedcomId: $id})'),
      { id: 'I001' }
    )
  })

  /** Asserts all top-level scalar fields are present and correctly valued in the response. */
  it('returns all core scalar fields on the person', async () => {
    mockRead.mockResolvedValue([personDetail])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.gedcomId).toBe('I001')
    expect(body.name).toBe('John Doe')
    expect(body.sex).toBe('M')
    expect(body.birthYear).toBe('1900')
    expect(body.deathYear).toBe('1980')
    expect(body.birthPlace).toBe('London, England')
    expect(body.deathPlace).toBe('New York, USA')
    expect(body.occupation).toBe('Farmer')
    expect(body.notes).toBe('Some notes')
  })

  /** Confirms the `parents` array contains items matching the PersonSummary shape. */
  it('returns parents array with correct PersonSummary shape', async () => {
    mockRead.mockResolvedValue([personDetail])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(Array.isArray(body.parents)).toBe(true)
    expect(body.parents[0]).toMatchObject({
      gedcomId: 'I002',
      name: 'James Doe',
      sex: 'M',
      birthYear: '1870',
      deathYear: '1940',
    })
  })

  /** Confirms the `siblings` array contains items matching the PersonSummary shape. */
  it('returns siblings array with correct PersonSummary shape', async () => {
    mockRead.mockResolvedValue([personDetail])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(Array.isArray(body.siblings)).toBe(true)
    expect(body.siblings[0]).toMatchObject({
      gedcomId: 'I003',
      name: 'Jane Doe',
      sex: 'F',
      birthYear: '1902',
      deathYear: null,
    })
  })

  /** Confirms the `marriages` array contains items matching the full MarriageDetail shape including nested spouse and children. */
  it('returns marriages array with correct MarriageDetail shape', async () => {
    mockRead.mockResolvedValue([personDetail])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(Array.isArray(body.marriages)).toBe(true)
    expect(body.marriages[0]).toMatchObject({
      unionId: 'F001',
      marriageYear: '1925',
      marriagePlace: 'Boston, MA',
      spouse: { gedcomId: 'I004', name: 'Mary Smith', sex: 'F', birthYear: '1903', deathYear: '1985' },
      children: [expect.objectContaining({ gedcomId: 'I005' })],
    })
  })

  /** Verifies `spouse` is allowed to be null within a MarriageDetail entry. */
  it('handles a marriage with null spouse', async () => {
    const noSpouse = {
      ...personDetail,
      marriages: [{ ...personDetail.marriages[0], spouse: null }],
    }
    mockRead.mockResolvedValue([noSpouse])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.marriages[0].spouse).toBeNull()
  })

  /** Confirms a 200 response is still returned when relationship arrays are empty. */
  it('handles a person with empty parents, siblings, and marriages arrays', async () => {
    const minimal = { ...personDetail, parents: [], siblings: [], marriages: [] }
    mockRead.mockResolvedValue([minimal])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.parents).toEqual([])
    expect(body.siblings).toEqual([])
    expect(body.marriages).toEqual([])
  })

  /** Verifies all optional scalar fields (sex, dates, places, occupation, notes) can be null. */
  it('handles nullable optional scalar fields', async () => {
    const sparse = {
      ...personDetail,
      sex: null,
      birthYear: null,
      deathYear: null,
      birthPlace: null,
      deathPlace: null,
      occupation: null,
      notes: null,
    }
    mockRead.mockResolvedValue([sparse])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sex).toBeNull()
    expect(body.birthYear).toBeNull()
    expect(body.deathYear).toBeNull()
    expect(body.birthPlace).toBeNull()
    expect(body.deathPlace).toBeNull()
    expect(body.occupation).toBeNull()
    expect(body.notes).toBeNull()
  })

  /** Verifies `marriageYear` and `marriagePlace` on a MarriageDetail entry can both be null. */
  it('handles a marriage with nullable year and place', async () => {
    const noDatePlace = {
      ...personDetail,
      marriages: [{ ...personDetail.marriages[0], marriageYear: null, marriagePlace: null }],
    }
    mockRead.mockResolvedValue([noDatePlace])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.marriages[0].marriageYear).toBeNull()
    expect(body.marriages[0].marriagePlace).toBeNull()
  })
})
