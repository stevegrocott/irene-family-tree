/**
 * Unit tests for GET /api/tree/[rootId].
 *
 * The Neo4j `read` helper is mocked so tests verify the route's response-shaping
 * logic in isolation: HTTP status codes, FlowNode / FlowEdge mapping, default
 * values for optional fields, and the bounce-traversal relationship directions.
 */
import { neo4jErrorResponseMock } from '@/test-utils/neo4jMock'
import { GET } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  ...neo4jErrorResponseMock(),
}))

// The route calls `auth()` to decide whether to redact likely-living persons
// (issue #142). Signed-in is the default so the response-shaping tests below
// observe unredacted data; the redaction tests override it per-case.
jest.mock('@/auth', () => ({
  auth: jest.fn().mockResolvedValue({ user: { email: 'viewer@example.com', name: 'Viewer' } }),
}))

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

import { auth } from '@/auth'
const mockAuth = auth as unknown as jest.MockedFunction<() => Promise<unknown>>

const makeRequest = () => new Request('http://localhost/api/tree/I001')
const makeParams = (rootId: string) => ({ params: Promise.resolve({ rootId }) })

const personNode = {
  _id: 'node:1',
  _labels: ['Person'],
  gedcomId: 'I001',
  name: 'John Doe',
  sex: 'M',
  birthYear: '1900',
  deathYear: '1980',
  photoUrl: 'https://example.com/john.jpg',
}

const unionNode = {
  _id: 'node:2',
  _labels: ['Union'],
  gedcomId: 'F001',
}

const rel = {
  _id: 'rel:1',
  type: 'CHILD',
  start: 'node:1',
  end: 'node:2',
}

describe('GET /api/tree/[rootId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 404 when the rootId does not match any person', async () => {
    mockRead.mockResolvedValue([])

    const response = await GET(makeRequest(), makeParams('MISSING'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Person not found' })
  })

  it('returns 500 when the Neo4j query throws', async () => {
    mockRead.mockRejectedValue(new Error('Connection refused'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to query graph database', detail: 'Connection refused' })
  })

  it('returns 200 with nodes and edges arrays on success', async () => {
    mockRead.mockResolvedValue([{ nodes: [], rels: [], totalNodes: 0 }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveProperty('nodes')
    expect(body).toHaveProperty('edges')
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(Array.isArray(body.edges)).toBe(true)
  })

  describe('totalNodes and truncated', () => {
    it('reports totalNodes and truncated: false when under the MAX_NODES cap', async () => {
      mockRead.mockResolvedValue([{ nodes: [personNode], rels: [], totalNodes: 1 }])

      const response = await GET(makeRequest(), makeParams('I001'))
      const body = await response.json()

      expect(body.totalNodes).toBe(1)
      expect(body.truncated).toBe(false)
    })

    it('reports truncated: true when totalNodes exceeds the MAX_NODES cap', async () => {
      mockRead.mockResolvedValue([{ nodes: [personNode], rels: [], totalNodes: 501 }])

      const response = await GET(makeRequest(), makeParams('I001'))
      const body = await response.json()

      expect(body.totalNodes).toBe(501)
      expect(body.truncated).toBe(true)
    })

    it('substitutes maxNodes into the Cypher query params', async () => {
      mockRead.mockResolvedValue([{ nodes: [], rels: [], totalNodes: 0 }])

      await GET(makeRequest(), makeParams('I001'))

      expect(mockRead).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxNodes: 500 })
      )
    })
  })

  it('maps Person nodes to the correct FlowNode shape', async () => {
    mockRead.mockResolvedValue([{ nodes: [personNode], rels: [] }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.nodes[0]).toMatchObject({
      id: 'node:1',
      type: 'person',
      data: {
        gedcomId: 'I001',
        name: 'John Doe',
        sex: 'M',
        birthYear: '1900',
        deathYear: '1980',
        photoUrl: 'https://example.com/john.jpg',
      },
    })
  })

  it('maps Union nodes to the correct FlowNode shape', async () => {
    mockRead.mockResolvedValue([{ nodes: [unionNode], rels: [] }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.nodes[0]).toMatchObject({
      id: 'node:2',
      type: 'union',
      data: { gedcomId: 'F001' },
    })
  })

  it('maps relationships to the correct FlowEdge shape', async () => {
    mockRead.mockResolvedValue([{ nodes: [personNode], rels: [rel] }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.edges[0]).toMatchObject({
      id: 'rel:1',
      source: 'node:1',
      target: 'node:2',
      label: 'CHILD',
    })
  })

  it('defaults missing name and sex to empty string on person nodes', async () => {
    const sparse = { _id: 'node:3', _labels: ['Person'], gedcomId: 'I003' }
    mockRead.mockResolvedValue([{ nodes: [sparse], rels: [] }])

    const response = await GET(makeRequest(), makeParams('I003'))
    const body = await response.json()

    expect(body.nodes[0].data.name).toBe('')
    expect(body.nodes[0].data.sex).toBe('')
    expect(body.nodes[0].data.photoUrl).toBeNull()
  })

  it('preserves null birthYear and deathYear on person nodes', async () => {
    const noYears = { ...personNode, birthYear: null, deathYear: null }
    mockRead.mockResolvedValue([{ nodes: [noYears], rels: [] }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.nodes[0].data.birthYear).toBeNull()
    expect(body.nodes[0].data.deathYear).toBeNull()
  })

  it('returns parents and children for a root with known family connections', async () => {
    const root    = { _id: 'n:1', _labels: ['Person'], gedcomId: 'I001', name: 'Root',   sex: 'M', birthYear: '1950', deathYear: null }
    const father  = { _id: 'n:2', _labels: ['Person'], gedcomId: 'I002', name: 'Father', sex: 'M', birthYear: '1920', deathYear: null }
    const mother  = { _id: 'n:3', _labels: ['Person'], gedcomId: 'I003', name: 'Mother', sex: 'F', birthYear: '1922', deathYear: null }
    const birth   = { _id: 'n:4', _labels: ['Union'],  gedcomId: 'F001' }
    const spouse  = { _id: 'n:5', _labels: ['Person'], gedcomId: 'I004', name: 'Spouse', sex: 'F', birthYear: '1952', deathYear: null }
    const marriage = { _id: 'n:6', _labels: ['Union'], gedcomId: 'F002' }
    const child   = { _id: 'n:7', _labels: ['Person'], gedcomId: 'I005', name: 'Child',  sex: 'M', birthYear: '1975', deathYear: null }

    // Relationships reflecting the bounce-traversal query structure:
    // Person -[CHILD]-> Union  (person was born into this union)
    // Person -[UNION]-> Union  (person is a parent/spouse in this union)
    const rels = [
      { _id: 'rel:1', type: 'CHILD', start: 'n:1', end: 'n:4' },  // root -CHILD-> birthUnion
      { _id: 'rel:2', type: 'UNION', start: 'n:2', end: 'n:4' },  // father -UNION-> birthUnion
      { _id: 'rel:3', type: 'UNION', start: 'n:3', end: 'n:4' },  // mother -UNION-> birthUnion
      { _id: 'rel:4', type: 'UNION', start: 'n:1', end: 'n:6' },  // root -UNION-> marriageUnion
      { _id: 'rel:5', type: 'UNION', start: 'n:5', end: 'n:6' },  // spouse -UNION-> marriageUnion
      { _id: 'rel:6', type: 'CHILD', start: 'n:7', end: 'n:6' },  // child -CHILD-> marriageUnion
    ]

    mockRead.mockResolvedValue([{
      nodes: [root, father, mother, birth, spouse, marriage, child],
      rels,
    }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)

    // All seven nodes (4 people + 2 unions + root) must be present
    expect(
      body.nodes.map((n: { data: { gedcomId: string } }) => n.data.gedcomId)
    ).toEqual(expect.arrayContaining(['I001', 'I002', 'I003', 'I004', 'I005', 'F001', 'F002']))

    // Six edges must be present with correct directions
    expect(body.edges).toHaveLength(6)
    expect(body.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'rel:1', source: 'n:1', target: 'n:4', label: 'CHILD' }),
      expect.objectContaining({ id: 'rel:2', source: 'n:2', target: 'n:4', label: 'UNION' }),
      expect.objectContaining({ id: 'rel:3', source: 'n:3', target: 'n:4', label: 'UNION' }),
      expect.objectContaining({ id: 'rel:4', source: 'n:1', target: 'n:6', label: 'UNION' }),
      expect.objectContaining({ id: 'rel:5', source: 'n:5', target: 'n:6', label: 'UNION' }),
      expect.objectContaining({ id: 'rel:6', source: 'n:7', target: 'n:6', label: 'CHILD' }),
    ]))
  })

  describe('hops query parameter', () => {
    it('uses default hops of 60 when no hops param is provided', async () => {
      mockRead.mockResolvedValue([{ nodes: [], rels: [] }])

      const request = new Request('http://localhost/api/tree/I001')
      await GET(request, makeParams('I001'))

      expect(mockRead).toHaveBeenCalledWith(
        expect.stringContaining('*1..60'),
        expect.any(Object)
      )
    })

    it('substitutes the provided hops value into the Cypher query', async () => {
      mockRead.mockResolvedValue([{ nodes: [], rels: [] }])

      const request = new Request('http://localhost/api/tree/I001?hops=4')
      await GET(request, makeParams('I001'))

      expect(mockRead).toHaveBeenCalledWith(
        expect.stringContaining('*1..4'),
        expect.any(Object)
      )
    })

    it('clamps hops to 60 when a value greater than 60 is provided', async () => {
      mockRead.mockResolvedValue([{ nodes: [], rels: [] }])

      const request = new Request('http://localhost/api/tree/I001?hops=70')
      await GET(request, makeParams('I001'))

      expect(mockRead).toHaveBeenCalledWith(
        expect.stringContaining('*1..60'),
        expect.any(Object)
      )
    })

    it('falls back to default hops of 60 when hops is not a valid integer string', async () => {
      mockRead.mockResolvedValue([{ nodes: [], rels: [] }])

      const request = new Request('http://localhost/api/tree/I001?hops=abc')
      await GET(request, makeParams('I001'))

      expect(mockRead).toHaveBeenCalledWith(
        expect.stringContaining('*1..60'),
        expect.any(Object)
      )
    })

    it('falls back to default hops of 60 when hops is a float', async () => {
      mockRead.mockResolvedValue([{ nodes: [], rels: [] }])

      const request = new Request('http://localhost/api/tree/I001?hops=2.5')
      await GET(request, makeParams('I001'))

      expect(mockRead).toHaveBeenCalledWith(
        expect.stringContaining('*1..60'),
        expect.any(Object)
      )
    })

    it('falls back to default hops of 60 when hops is less than 1', async () => {
      mockRead.mockResolvedValue([{ nodes: [], rels: [] }])

      const request = new Request('http://localhost/api/tree/I001?hops=0')
      await GET(request, makeParams('I001'))

      expect(mockRead).toHaveBeenCalledWith(
        expect.stringContaining('*1..60'),
        expect.any(Object)
      )
    })
  })

  // Issue #181: the traversal caps at MAX_NODES (500) nodes per request. The
  // response must say so via `truncated`/`totalNodes` rather than silently
  // dropping relatives, so both the API contract and the UI can be honest
  // about a partial tree. The mocked Neo4j row carries `totalNodes` alongside
  // `nodes`/`rels` — the count of all nodes reachable by the traversal before
  // the `[0..$maxNodes]` cap is applied.
  describe('truncation reporting (issue #181)', () => {
    const makeNodes = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        _id: `node:${i}`,
        _labels: ['Person'],
        gedcomId: `I${i}`,
      }))

    it('reports truncated: true and the full totalNodes count when the traversal exceeds MAX_NODES (500)', async () => {
      mockRead.mockResolvedValue([{ nodes: makeNodes(500), rels: [], totalNodes: 650 }])

      const response = await GET(makeRequest(), makeParams('I001'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.truncated).toBe(true)
      expect(body.totalNodes).toBe(650)
      expect(body.nodes).toHaveLength(500)
    })

    it('reports truncated: false when exactly MAX_NODES are reachable and none are left out', async () => {
      mockRead.mockResolvedValue([{ nodes: makeNodes(500), rels: [], totalNodes: 500 }])

      const response = await GET(makeRequest(), makeParams('I001'))
      const body = await response.json()

      expect(body.truncated).toBe(false)
      expect(body.totalNodes).toBe(500)
    })

    it('reports truncated: false when the traversal is well under MAX_NODES', async () => {
      mockRead.mockResolvedValue([{ nodes: makeNodes(10), rels: [], totalNodes: 10 }])

      const response = await GET(makeRequest(), makeParams('I001'))
      const body = await response.json()

      expect(body.truncated).toBe(false)
      expect(body.totalNodes).toBe(10)
    })

    it('still returns nodes and edges arrays when the response is truncated (additive change)', async () => {
      mockRead.mockResolvedValue([{ nodes: makeNodes(500), rels: [], totalNodes: 650 }])

      const response = await GET(makeRequest(), makeParams('I001'))
      const body = await response.json()

      expect(Array.isArray(body.nodes)).toBe(true)
      expect(Array.isArray(body.edges)).toBe(true)
    })
  })

  // Issue #142: anonymous visitors must not see birth/death/occupation/notes
  // for people who are likely still living.
  describe('privacy redaction for likely-living persons', () => {
    const livingNode = {
      _id: 'node:9',
      _labels: ['Person'],
      gedcomId: 'I009',
      name: 'Jane Living',
      sex: 'F',
      birthYear: '1990',
      deathYear: null,
      birthPlace: 'Sheffield',
      deathPlace: null,
      occupation: 'Teacher',
      notes: 'Private note',
      photoUrl: 'https://example.com/jane.jpg',
    }

    it('redacts sensitive fields for anonymous requests', async () => {
      mockAuth.mockResolvedValueOnce(null)
      mockRead.mockResolvedValue([{ nodes: [livingNode], rels: [] }])

      const response = await GET(makeRequest(), makeParams('I009'))
      const body = await response.json()
      const { data } = body.nodes[0]

      expect(data.living).toBe(true)
      expect(data.gedcomId).toBe('I009')
      expect(data.name).toBe('Jane Living')
      expect(data.birthYear).toBeNull()
      expect(data.deathYear).toBeNull()
      expect(data.birthPlace).toBeNull()
      expect(data.deathPlace).toBeNull()
      expect(data.occupation).toBeNull()
      expect(data.notes).toBeNull()
      expect(data.photoUrl).toBeNull()
    })

    it('returns full data for the same person when signed in', async () => {
      mockRead.mockResolvedValue([{ nodes: [livingNode], rels: [] }])

      const response = await GET(makeRequest(), makeParams('I009'))
      const body = await response.json()
      const { data } = body.nodes[0]

      expect(data.living).toBeUndefined()
      expect(data.birthYear).toBe('1990')
      expect(data.birthPlace).toBe('Sheffield')
      expect(data.occupation).toBe('Teacher')
      expect(data.notes).toBe('Private note')
      expect(data.photoUrl).toBe('https://example.com/jane.jpg')
    })

    it('leaves deceased persons unredacted for anonymous requests', async () => {
      mockAuth.mockResolvedValueOnce(null)
      mockRead.mockResolvedValue([
        { nodes: [{ ...livingNode, deathYear: '1975', occupation: 'Baker' }], rels: [] },
      ])

      const response = await GET(makeRequest(), makeParams('I009'))
      const body = await response.json()
      const { data } = body.nodes[0]

      expect(data.living).toBeUndefined()
      expect(data.birthYear).toBe('1990')
      expect(data.deathYear).toBe('1975')
      expect(data.occupation).toBe('Baker')
    })

    it('does not add a living marker to union nodes for anonymous requests', async () => {
      mockAuth.mockResolvedValueOnce(null)
      mockRead.mockResolvedValue([{ nodes: [unionNode], rels: [] }])

      const response = await GET(makeRequest(), makeParams('F001'))
      const body = await response.json()

      expect(body.nodes[0].type).toBe('union')
      expect(body.nodes[0].data).toEqual({ gedcomId: 'F001' })
    })
  })
})
