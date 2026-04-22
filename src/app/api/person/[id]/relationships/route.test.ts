import { POST } from './route'

jest.mock('@/lib/neo4j', () => ({
  write: jest.fn(),
}))

import { write } from '@/lib/neo4j'
const mockWrite = write as jest.MockedFunction<typeof write>

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

  it('creates a parent relationship with UNION for target and CHILD for id', async () => {
    mockWrite.mockResolvedValue([{ unionId: '@F12345678@' }])

    const response = await POST(makeRequest({ type: 'parent', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('CHILD'),
      expect.objectContaining({ id: 'I001', targetId: 'I002' })
    )
  })

  it('creates a child relationship with UNION for id and CHILD for target', async () => {
    mockWrite.mockResolvedValue([{ unionId: '@F12345678@' }])

    const response = await POST(makeRequest({ type: 'child', targetId: 'I002' }), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('CHILD'),
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
})
