import { GET } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
}))

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

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
    expect(body).toEqual({ error: 'Failed to query graph database' })
  })

  it('returns 200 with nodes and edges arrays on success', async () => {
    mockRead.mockResolvedValue([{ nodes: [], rels: [] }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveProperty('nodes')
    expect(body).toHaveProperty('edges')
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(Array.isArray(body.edges)).toBe(true)
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
    const root    = { _id: 'n:1', _labels: ['Person'], gedcomId: 'I001', name: 'Root', sex: 'M', birthYear: '1950', deathYear: null }
    const father  = { _id: 'n:2', _labels: ['Person'], gedcomId: 'I002', name: 'Father', sex: 'M', birthYear: '1920', deathYear: null }
    const mother  = { _id: 'n:3', _labels: ['Person'], gedcomId: 'I003', name: 'Mother', sex: 'F', birthYear: '1922', deathYear: null }
    const birth   = { _id: 'n:4', _labels: ['Union'], gedcomId: 'F001' }
    const spouse  = { _id: 'n:5', _labels: ['Person'], gedcomId: 'I004', name: 'Spouse', sex: 'F', birthYear: '1952', deathYear: null }
    const marriage= { _id: 'n:6', _labels: ['Union'], gedcomId: 'F002' }
    const child   = { _id: 'n:7', _labels: ['Person'], gedcomId: 'I005', name: 'Child', sex: 'M', birthYear: '1975', deathYear: null }

    mockRead.mockResolvedValue([{
      nodes: [root, father, mother, birth, spouse, marriage, child],
      rels: [],
    }])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    const gedcomIds = body.nodes.map((n: { data: { gedcomId: string } }) => n.data.gedcomId)
    expect(gedcomIds).toContain('I001')
    expect(gedcomIds).toContain('I002')
    expect(gedcomIds).toContain('I003')
    expect(gedcomIds).toContain('I004')
    expect(gedcomIds).toContain('I005')
    expect(gedcomIds).toContain('F001')
    expect(gedcomIds).toContain('F002')
  })
})
