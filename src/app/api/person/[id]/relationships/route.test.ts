import { POST } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  write: jest.fn(),
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

const makeRequest = (body: unknown) =>
  new Request('http://localhost/api/person/I001/relationships', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('POST /api/person/[id]/relationships', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: no existing union found
    mockRead.mockResolvedValue([{ unionId: null }])
  })

  it('returns 400 when body is invalid JSON', async () => {
    const request = new Request('http://localhost/api/person/I001/relationships', {
      method: 'POST',
      body: 'not-json',
    })
    const response = await POST(request, makeParams('I001'))

    expect(response.status).toBe(400)
  })

  it('returns 400 when targetId is missing', async () => {
    const response = await POST(makeRequest({ type: 'spouse' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'targetId is required' })
  })

  it('returns 400 when type is invalid', async () => {
    const response = await POST(makeRequest({ type: 'sibling', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'type must be spouse, parent, or child' })
  })

  it('creates a spouse union with UNION edges for both persons', async () => {
    mockWrite.mockResolvedValue([{ unionId: '@F12345678@' }])

    const response = await POST(makeRequest({ type: 'spouse', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toMatchObject({ unionId: expect.any(String) })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('UNION'),
      expect.objectContaining({ id: 'I001', targetId: 'I002' })
    )
  })

  // AC#3 (issue #58): Ideally we would execute the Cypher against a live Neo4j
  // instance and query the resulting graph to confirm the CHILD edge points
  // Union → Person. That is not feasible here because `@/lib/neo4j` is mocked
  // at the top of this file — `write` never touches a real database, so no
  // post-write graph query can be issued. Asserting the Cypher string contains
  // the canonical pattern `(u)-[:CHILD]->(child)` (see the two tests below)
  // is the accepted substitute: it fails if the direction is reversed to
  // `(child)-[:CHILD]->(u)` (the PR #57 regression) while staying within the
  // unit-test boundary. Real-graph direction verification belongs in an
  // integration/E2E suite running against a live Neo4j.
  it('creates a parent relationship with UNION for target and CHILD for id', async () => {
    mockWrite.mockResolvedValue([{ unionId: '@F12345678@' }])

    const response = await POST(makeRequest({ type: 'parent', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('(u)-[:CHILD]->(child)'),
      expect.objectContaining({ id: 'I001', targetId: 'I002' })
    )
  })

  it('creates a child relationship with UNION for id and CHILD for target', async () => {
    mockWrite.mockResolvedValue([{ unionId: '@F12345678@' }])

    const response = await POST(makeRequest({ type: 'child', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('(u)-[:CHILD]->(child)'),
      expect.objectContaining({ id: 'I001', targetId: 'I002' })
    )
  })

  it('generates a unionId matching @F<8 hex chars>@ pattern', async () => {
    mockWrite.mockImplementation(async (_cypher, params) => [{
      unionId: (params as Record<string, unknown>).unionId as string,
    }])

    const response = await POST(makeRequest({ type: 'spouse', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(body.unionId).toMatch(/^@F[0-9a-f]{8}@$/)
  })

  it('returns 500 when Neo4j write throws', async () => {
    mockWrite.mockRejectedValue(new Error('DB error'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makeRequest({ type: 'spouse', targetId: 'I002' }), makeParams('I001'))

    expect(response.status).toBe(500)
  })

  it('returns 404 when write returns no rows (person not found)', async () => {
    mockWrite.mockResolvedValue([])

    const response = await POST(makeRequest({ type: 'spouse', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Person not found' })
  })

  it('returns 404 when write returns a row with a null unionId (person not found)', async () => {
    mockWrite.mockResolvedValue([{ unionId: null as unknown as string, created: false }])

    const response = await POST(makeRequest({ type: 'spouse', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('Person not found')
    expect(mockRecordChange).not.toHaveBeenCalled()
  })

  it.each(['spouse', 'parent', 'child'] as const)(
    'returns 404 when write returns null unionId (%s relationship)',
    async (type) => {
      mockWrite.mockResolvedValue([{ unionId: null as unknown as string }])

      const response = await POST(makeRequest({ type, targetId: 'I002' }), makeParams('I001'))

      expect(response.status).toBe(404)
    }
  )

  it('calls recordChange with relationship details and session author after successful POST', async () => {
    mockWrite.mockResolvedValue([{ unionId: '@F12345678@' }])

    await POST(makeRequest({ type: 'spouse', targetId: 'I002' }), makeParams('I001'))

    expect(mockRecordChange).toHaveBeenCalledWith(
      'editor@example.com',
      'Editor User',
      'ADD_RELATIONSHIP',
      'I001',
      null,
      { type: 'spouse', targetId: 'I002', unionId: '@F12345678@' }
    )
  })

  it('returns 409 when a spouse union already exists between the two persons', async () => {
    mockRead.mockResolvedValue([{ unionId: '@Fexisting1@' }])

    const response = await POST(makeRequest({ type: 'spouse', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Relationship already exists', unionId: '@Fexisting1@' })
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('returns 409 when a parent-child union already exists', async () => {
    mockRead.mockResolvedValue([{ unionId: '@Fexisting2@' }])

    const response = await POST(makeRequest({ type: 'parent', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Relationship already exists', unionId: '@Fexisting2@' })
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('returns 409 when a child union already exists', async () => {
    mockRead.mockResolvedValue([{ unionId: '@Fexisting3@' }])

    const response = await POST(makeRequest({ type: 'child', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Relationship already exists', unionId: '@Fexisting3@' })
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('returns 500 when Neo4j read throws during existence check', async () => {
    mockRead.mockRejectedValue(new Error('DB read error'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(makeRequest({ type: 'spouse', targetId: 'I002' }), makeParams('I001'))

    expect(response.status).toBe(500)
  })
})
