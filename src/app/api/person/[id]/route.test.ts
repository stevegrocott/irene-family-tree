/**
 * Unit tests for GET /api/person/[id].
 *
 * Verifies that the route handler returns the correct HTTP status codes and
 * response shapes for success, not-found, and database-error scenarios.
 * Neo4j `read` is fully mocked so no live database connection is required.
 */
import { GET, PATCH } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  write: jest.fn(),
  neo4jErrorResponse: jest.fn((err: unknown, publicMessage: string, status = 500) => {
    const detail = err instanceof Error ? err.message : String(err)
    return Response.json({ error: publicMessage, detail }, { status })
  }),
}))

jest.mock('@/lib/changes', () => ({
  recordChange: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn().mockResolvedValue({ user: { email: 'editor@example.com', name: 'Editor User' } }),
}))

import { read, write } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>
const mockWrite = write as jest.MockedFunction<typeof write>

import { recordChange } from '@/lib/changes'
const mockRecordChange = recordChange as jest.MockedFunction<typeof recordChange>

import { auth } from '@/auth'
const mockAuth = auth as unknown as jest.MockedFunction<() => Promise<unknown>>

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
    expect(body).toEqual({ error: 'Failed to query graph database', detail: 'Connection refused' })
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

  /** Confirms `photoUrl` is returned as part of the PersonDetail response. */
  it('returns photoUrl on the person', async () => {
    mockRead.mockResolvedValue([{ ...personDetail, photoUrl: 'https://example.com/photo.jpg' }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.photoUrl).toBe('https://example.com/photo.jpg')
  })

  /** Verifies `photoUrl` is allowed to be null. */
  it('handles a null photoUrl', async () => {
    mockRead.mockResolvedValue([{ ...personDetail, photoUrl: null }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.photoUrl).toBeNull()
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

  // Issue #142: for anonymous requests the root person and every nested
  // parent / sibling / spouse / child summary must be redacted when likely living.
  describe('privacy redaction for likely-living persons', () => {
    const CURRENT_YEAR = new Date().getFullYear()
    /** Born recently enough to be within the 105-year living threshold. */
    const RECENT = String(CURRENT_YEAR - 40)
    /** Born long enough ago that the person cannot plausibly be living. */
    const ANCIENT = String(CURRENT_YEAR - 130)

    /** Living root, with a living child and a long-dead parent, sibling and spouse. */
    const livingDetail = {
      ...personDetail,
      birthYear: RECENT,
      deathYear: null,
      deathPlace: null,
      parents: [{ gedcomId: 'I002', name: 'James Doe', sex: 'M', birthYear: ANCIENT, deathYear: '1940' }],
      siblings: [{ gedcomId: 'I003', name: 'Jane Doe', sex: 'F', birthYear: ANCIENT, deathYear: null }],
      marriages: [
        {
          unionId: 'F001',
          marriageYear: '1925',
          marriagePlace: 'Boston, MA',
          spouse: { gedcomId: 'I004', name: 'Mary Smith', sex: 'F', birthYear: RECENT, deathYear: null },
          children: [
            { gedcomId: 'I005', name: 'Robert Doe', sex: 'M', birthYear: RECENT, deathYear: null },
          ],
        },
      ],
    }

    it('redacts the root person for anonymous requests', async () => {
      mockAuth.mockResolvedValueOnce(null)
      mockRead.mockResolvedValue([livingDetail])

      const body = await (await GET(makeRequest(), makeParams('I001'))).json()

      expect(body.living).toBe(true)
      expect(body.name).toBe('John Doe')
      expect(body.birthYear).toBeNull()
      expect(body.deathYear).toBeNull()
      expect(body.birthPlace).toBeNull()
      expect(body.deathPlace).toBeNull()
      expect(body.occupation).toBeNull()
      expect(body.notes).toBeNull()
    })

    it('redacts living nested spouse and child summaries for anonymous requests', async () => {
      mockAuth.mockResolvedValueOnce(null)
      mockRead.mockResolvedValue([livingDetail])

      const body = await (await GET(makeRequest(), makeParams('I001'))).json()

      const spouse = body.marriages[0].spouse
      expect(spouse.living).toBe(true)
      expect(spouse.name).toBe('Mary Smith')
      expect(spouse.birthYear).toBeNull()

      const child = body.marriages[0].children[0]
      expect(child.living).toBe(true)
      expect(child.name).toBe('Robert Doe')
      expect(child.birthYear).toBeNull()
    })

    it('leaves deceased nested parent and sibling summaries untouched for anonymous requests', async () => {
      mockAuth.mockResolvedValueOnce(null)
      mockRead.mockResolvedValue([livingDetail])

      const body = await (await GET(makeRequest(), makeParams('I001'))).json()

      expect(body.parents[0]).toEqual(livingDetail.parents[0])
      // Born >105 years ago with no death year: not plausibly living, so not redacted.
      expect(body.siblings[0]).toEqual(livingDetail.siblings[0])
    })

    it('returns full data including nested summaries when signed in', async () => {
      mockRead.mockResolvedValue([livingDetail])

      const body = await (await GET(makeRequest(), makeParams('I001'))).json()

      expect(body).toEqual(livingDetail)
      expect(body.living).toBeUndefined()
      expect(body.marriages[0].spouse.living).toBeUndefined()
    })
  })
})

const makePatchRequest = (id: string, body: unknown) =>
  new Request(`http://localhost/api/person/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

const updatedPerson = {
  gedcomId: 'I001',
  name: 'John Updated',
  sex: 'M',
  birthYear: '1901',
  birthDate: '1901-03-15',
  birthPlace: 'Manchester, England',
  deathYear: '1981',
  deathDate: '1981-07-04',
  deathPlace: 'Chicago, USA',
  occupation: 'Teacher',
  notes: 'Updated notes',
}

describe('PATCH /api/person/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 200 with updated person when write succeeds', async () => {
    mockWrite.mockResolvedValue([updatedPerson])

    const response = await PATCH(makePatchRequest('I001', { name: 'John Updated' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(updatedPerson)
  })

  it('returns 400 when body is invalid JSON', async () => {
    const request = new Request('http://localhost/api/person/I001', {
      method: 'PATCH',
      body: 'not-json',
    })
    const response = await PATCH(request, makeParams('I001'))

    expect(response.status).toBe(400)
  })

  it('returns 400 when no valid fields are provided', async () => {
    const response = await PATCH(makePatchRequest('I001', { invalidField: 'value' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'No valid fields provided' })
  })

  it('returns 404 when no person matches the id', async () => {
    mockWrite.mockResolvedValue([])

    const response = await PATCH(makePatchRequest('MISSING', { name: 'Ghost' }), makeParams('MISSING'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Person not found' })
  })

  it('returns 404 when the returned row has a null gedcomId', async () => {
    mockWrite.mockResolvedValue([{ ...updatedPerson, gedcomId: null }])

    const response = await PATCH(makePatchRequest('I001', { name: 'John' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Person not found' })
  })

  it('returns 500 when Neo4j write throws', async () => {
    mockWrite.mockRejectedValue(new Error('DB error'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await PATCH(makePatchRequest('I001', { name: 'Alice' }), makeParams('I001'))

    expect(response.status).toBe(500)
    expect((await response.json())).toEqual({ error: 'Failed to update graph database', detail: 'DB error' })
  })

  it('passes the id and only allowed fields to the write call', async () => {
    mockWrite.mockResolvedValue([updatedPerson])

    await PATCH(makePatchRequest('I001', { name: 'John', occupation: 'Doctor', unknownField: 'ignored' }), makeParams('I001'))

    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (p:Person {gedcomId: $id})'),
      expect.objectContaining({
        id: 'I001',
        fields: { name: 'John', occupation: 'Doctor' },
      })
    )
  })

  it('strips disallowed fields from the write call', async () => {
    mockWrite.mockResolvedValue([updatedPerson])

    await PATCH(makePatchRequest('I001', { name: 'John', password: 'secret', admin: true }), makeParams('I001'))

    const callArgs = (mockWrite as jest.Mock).mock.calls[0][1] as { fields: Record<string, unknown> }
    expect(callArgs.fields).not.toHaveProperty('password')
    expect(callArgs.fields).not.toHaveProperty('admin')
    expect(callArgs.fields).toHaveProperty('name', 'John')
  })

  it('accepts all allowed patch fields', async () => {
    mockWrite.mockResolvedValue([updatedPerson])
    const allFields = {
      name: 'Alice', sex: 'F', birthYear: '1990', birthDate: '1990-01-01',
      birthPlace: 'Paris', deathYear: '2070', deathDate: '2070-12-31',
      deathPlace: 'Lyon', occupation: 'Engineer', notes: 'No notes',
      photoUrl: 'https://example.com/alice.jpg',
    }

    const response = await PATCH(makePatchRequest('I001', allFields), makeParams('I001'))

    expect(response.status).toBe(200)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ fields: allFields })
    )
  })

  it('accepts a valid https photoUrl', async () => {
    mockWrite.mockResolvedValue([{ ...updatedPerson, photoUrl: 'https://example.com/photo.jpg' }])

    const response = await PATCH(
      makePatchRequest('I001', { photoUrl: 'https://example.com/photo.jpg' }),
      makeParams('I001')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.photoUrl).toBe('https://example.com/photo.jpg')
    expect(mockWrite).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ fields: { photoUrl: 'https://example.com/photo.jpg' } })
    )
  })

  it('accepts a null photoUrl to clear the photo', async () => {
    mockWrite.mockResolvedValue([{ ...updatedPerson, photoUrl: null }])

    const response = await PATCH(makePatchRequest('I001', { photoUrl: null }), makeParams('I001'))

    expect(response.status).toBe(200)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ fields: { photoUrl: null } })
    )
  })

  it('returns 400 when photoUrl is an http (non-https) URL', async () => {
    const response = await PATCH(
      makePatchRequest('I001', { photoUrl: 'http://example.com/photo.jpg' }),
      makeParams('I001')
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'photoUrl must be an https:// URL or null' })
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('returns 400 when photoUrl is not a valid URL', async () => {
    const response = await PATCH(
      makePatchRequest('I001', { photoUrl: 'not-a-url' }),
      makeParams('I001')
    )

    expect(response.status).toBe(400)
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('calls recordChange with previous person, updated person, and session author after successful update', async () => {
    const previousPerson = { ...updatedPerson, name: 'John Original' }
    mockRead.mockResolvedValueOnce([previousPerson])
    mockWrite.mockResolvedValue([updatedPerson])

    await PATCH(makePatchRequest('I001', { name: 'John Updated' }), makeParams('I001'))

    expect(mockRecordChange).toHaveBeenCalledWith(
      'editor@example.com',
      'Editor User',
      'UPDATE_PERSON',
      'I001',
      previousPerson,
      updatedPerson
    )
  })
})
