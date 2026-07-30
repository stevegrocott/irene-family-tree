/**
 * Unit tests for GET /api/relationship.
 *
 * The Neo4j `read` helper is mocked so tests verify the route's own
 * responsibilities in isolation: query-parameter validation, the
 * fromExists/toExists/no-path 404 branches, walking a shortest-path row into
 * kinship steps, and the computed label — without needing a real database.
 */
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

const makeRequest = (query: string) => new Request(`http://localhost/api/relationship${query}`)

const personNode = (gedcomId: string, name: string, sex: string | null) => ({
  _id: `node:${gedcomId}`,
  _labels: ['Person'],
  gedcomId,
  name,
  sex,
})

const unionNode = (gedcomId: string) => ({
  _id: `node:${gedcomId}`,
  _labels: ['Union'],
  gedcomId,
})

describe('GET /api/relationship', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('invalid params', () => {
    it('returns 400 when the from param is missing', async () => {
      const response = await GET(makeRequest('?to=I002'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toEqual({ error: 'from and to query parameters are required' })
      expect(mockRead).not.toHaveBeenCalled()
    })

    it('returns 400 when the to param is missing', async () => {
      const response = await GET(makeRequest('?from=I001'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toEqual({ error: 'from and to query parameters are required' })
      expect(mockRead).not.toHaveBeenCalled()
    })

    it('returns 400 when both params are missing', async () => {
      const response = await GET(makeRequest(''))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body).toEqual({ error: 'from and to query parameters are required' })
    })
  })

  describe('unknown person', () => {
    it('returns 404 when the from person does not exist', async () => {
      mockRead.mockResolvedValue([{ fromExists: false, toExists: true, nodes: null, rels: null }])

      const response = await GET(makeRequest('?from=MISSING&to=I002'))
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toEqual({ error: 'Person not found' })
    })

    it('returns 404 when the to person does not exist', async () => {
      mockRead.mockResolvedValue([{ fromExists: true, toExists: false, nodes: null, rels: null }])

      const response = await GET(makeRequest('?from=I001&to=MISSING'))
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toEqual({ error: 'Person not found' })
    })

    it('returns 404 when neither person exists', async () => {
      mockRead.mockResolvedValue([{ fromExists: false, toExists: false, nodes: null, rels: null }])

      const response = await GET(makeRequest('?from=MISSING1&to=MISSING2'))
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toEqual({ error: 'Person not found' })
    })
  })

  describe('same person', () => {
    it('returns a self label with no steps when from and to are the same existing person', async () => {
      mockRead.mockResolvedValue([{ exists: true }])

      const response = await GET(makeRequest('?from=I001&to=I001'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ from: 'I001', to: 'I001', steps: [], label: 'self' })
    })

    it('returns 404 when from and to are the same but the person does not exist', async () => {
      mockRead.mockResolvedValue([{ exists: false }])

      const response = await GET(makeRequest('?from=MISSING&to=MISSING'))
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toEqual({ error: 'Person not found' })
    })
  })

  describe('no path within bound', () => {
    it('returns 404 when both people exist but no path was found', async () => {
      mockRead.mockResolvedValue([{ fromExists: true, toExists: true, nodes: null, rels: null }])

      const response = await GET(makeRequest('?from=I001&to=I002'))
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toEqual({ error: 'No relationship path found within 20 hops' })
    })
  })

  describe('happy path', () => {
    it('returns 200 with the classified step sequence and computed label for a parent hop', async () => {
      const child = personNode('I001', 'Child', 'M')
      const union = unionNode('F001')
      const father = personNode('I002', 'Father', 'M')

      mockRead.mockResolvedValue([
        {
          fromExists: true,
          toExists: true,
          nodes: [child, union, father],
          // child is born of the union; father is a partner in the union
          rels: [
            { type: 'CHILD', start: union._id, end: child._id },
            { type: 'UNION', start: father._id, end: union._id },
          ],
        },
      ])

      const response = await GET(makeRequest('?from=I001&to=I002'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({
        from: 'I001',
        to: 'I002',
        steps: [{ type: 'parent', name: 'Father', sex: 'M' }],
        label: 'father',
      })
    })

    it('returns 200 with a spouse step and label for a direct union hop', async () => {
      const a = personNode('I001', 'A', 'F')
      const union = unionNode('F001')
      const b = personNode('I002', 'B', 'M')

      mockRead.mockResolvedValue([
        {
          fromExists: true,
          toExists: true,
          nodes: [a, union, b],
          rels: [
            { type: 'UNION', start: a._id, end: union._id },
            { type: 'UNION', start: b._id, end: union._id },
          ],
        },
      ])

      const response = await GET(makeRequest('?from=I001&to=I002'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.steps).toEqual([{ type: 'spouse', name: 'B', sex: 'M' }])
      expect(body.label).toBe('husband')
    })

    it('expands a shared-union sibling crossing into a parent step then a child step', async () => {
      const sister = personNode('I001', 'Sister', 'F')
      const union = unionNode('F001')
      const brother = personNode('I002', 'Brother', 'M')

      mockRead.mockResolvedValue([
        {
          fromExists: true,
          toExists: true,
          nodes: [sister, union, brother],
          // both are children of the same union -> siblings
          rels: [
            { type: 'CHILD', start: union._id, end: sister._id },
            { type: 'CHILD', start: union._id, end: brother._id },
          ],
        },
      ])

      const response = await GET(makeRequest('?from=I001&to=I002'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.steps).toEqual([{ type: 'parent' }, { type: 'child', name: 'Brother', sex: 'M' }])
      expect(body.label).toBe('brother')
    })

    it('passes from and to through to the Neo4j read call', async () => {
      mockRead.mockResolvedValue([{ fromExists: true, toExists: true, nodes: null, rels: null }])

      await GET(makeRequest('?from=I001&to=I002'))

      expect(mockRead).toHaveBeenCalledWith(expect.any(String), { from: 'I001', to: 'I002' })
    })

    it('defaults a missing name and sex to empty string / null on step persons', async () => {
      const child = { _id: 'node:I001', _labels: ['Person'], gedcomId: 'I001' }
      const union = unionNode('F001')
      const father = { _id: 'node:I002', _labels: ['Person'], gedcomId: 'I002' }

      mockRead.mockResolvedValue([
        {
          fromExists: true,
          toExists: true,
          nodes: [child, union, father],
          rels: [
            { type: 'CHILD', start: union._id, end: child._id },
            { type: 'UNION', start: father._id, end: union._id },
          ],
        },
      ])

      const response = await GET(makeRequest('?from=I001&to=I002'))
      const body = await response.json()

      expect(body.steps[0]).toEqual({ type: 'parent', name: '', sex: null })
    })
  })

  describe('error handling', () => {
    it('returns 500 when the Neo4j query throws', async () => {
      mockRead.mockRejectedValue(new Error('Connection refused'))
      jest.spyOn(console, 'error').mockImplementation(() => {})

      const response = await GET(makeRequest('?from=I001&to=I002'))
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body).toEqual({ error: 'Failed to query graph database', detail: 'Connection refused' })
    })

    it('returns 500 when the path cannot be classified into known steps', async () => {
      const a = personNode('I001', 'A', 'F')
      const union = unionNode('F001')
      const b = personNode('I002', 'B', 'M')

      mockRead.mockResolvedValue([
        {
          fromExists: true,
          toExists: true,
          nodes: [a, union, b],
          // Neither relationship matches a partner/child pattern through the union.
          rels: [
            { type: 'CHILD', start: a._id, end: union._id },
            { type: 'CHILD', start: b._id, end: union._id + 'x' },
          ],
        },
      ])
      jest.spyOn(console, 'error').mockImplementation(() => {})

      const response = await GET(makeRequest('?from=I001&to=I002'))
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBe('Failed to classify relationship path')
    })
  })
})
