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

import { write } from '@/lib/neo4j'
const mockWrite = write as jest.MockedFunction<typeof write>

import { recordChange } from '@/lib/changes'
const mockRecordChange = recordChange as jest.MockedFunction<typeof recordChange>

import { auth } from '@/auth'
const mockAuth = auth as jest.MockedFunction<typeof auth>

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

  // Parameterized: both a user with no role field and a user with role: 'user'
  // hit the same guard (session.user.role !== 'admin') and must produce
  // identical 403 responses. Covers both shapes explicitly so a future change
  // that special-cases one shape can't silently pass by only handling the other.
  it.each([
    ['no role field', { email: 'editor@example.com', name: 'Editor User' }],
    ['role: user', { email: 'user@example.com', name: 'Regular User', role: 'user' }],
  ])('returns 403 when non-admin (%s) tries to create a parent relationship directly', async (_label, user) => {
    mockAuth.mockResolvedValueOnce({ user } as never)

    const response = await POST(makeRequest({ type: 'parent', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Only admins can add parent relationships directly' })
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('allows admin to create a parent relationship directly', async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: 'admin@example.com', name: 'Admin', role: 'admin' } })
    mockWrite.mockResolvedValue([{ unionId: '@F12345678@', created: true }])

    const response = await POST(makeRequest({ type: 'parent', targetId: 'I002' }), makeParams('I001'))

    expect(response.status).toBe(201)
    expect(mockWrite).toHaveBeenCalled()
  })

  it('does not restrict non-admin from creating spouse relationships', async () => {
    mockWrite.mockResolvedValue([{ unionId: '@F12345678@', created: true }])

    const response = await POST(makeRequest({ type: 'spouse', targetId: 'I002' }), makeParams('I001'))

    expect(response.status).toBe(201)
  })

  it('does not restrict non-admin from creating child relationships', async () => {
    mockWrite.mockResolvedValue([{ unionId: '@F12345678@', created: true }])

    const response = await POST(makeRequest({ type: 'child', targetId: 'I002' }), makeParams('I001'))

    expect(response.status).toBe(201)
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
    mockAuth.mockResolvedValueOnce({ user: { email: 'admin@example.com', name: 'Admin', role: 'admin' } })
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

  it.each(['spouse', 'child'] as const)(
    'returns 404 when write returns null unionId (%s relationship)',
    async (type) => {
      mockWrite.mockResolvedValue([{ unionId: null as unknown as string }])

      const response = await POST(makeRequest({ type, targetId: 'I002' }), makeParams('I001'))

      expect(response.status).toBe(404)
    }
  )

  it('returns 404 when admin creates parent relationship but write returns null unionId', async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: 'admin@example.com', name: 'Admin', role: 'admin' } })
    mockWrite.mockResolvedValue([{ unionId: null as unknown as string }])

    const response = await POST(makeRequest({ type: 'parent', targetId: 'I002' }), makeParams('I001'))

    expect(response.status).toBe(404)
  })

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
    mockWrite.mockResolvedValue([{ unionId: '@Fexisting1@', existed: true }])

    const response = await POST(makeRequest({ type: 'spouse', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Relationship already exists', unionId: '@Fexisting1@' })
  })

  it('returns 409 when a parent-child union already exists', async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: 'admin@example.com', name: 'Admin', role: 'admin' } })
    mockWrite.mockResolvedValue([{ unionId: '@Fexisting2@', existed: true }])

    const response = await POST(makeRequest({ type: 'parent', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Relationship already exists', unionId: '@Fexisting2@' })
  })

  it('returns 409 when a child union already exists', async () => {
    mockWrite.mockResolvedValue([{ unionId: '@Fexisting3@', existed: true }])

    const response = await POST(makeRequest({ type: 'child', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Relationship already exists', unionId: '@Fexisting3@' })
  })

})
