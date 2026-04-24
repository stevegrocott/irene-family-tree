jest.mock('@/lib/neo4j', () => ({ read: jest.fn(), writeTransaction: jest.fn() }))
jest.mock('@/lib/changes', () => ({ recordChange: jest.fn() }))

import { read, writeTransaction } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { cascadeRevertPerson } from './cascade-revert'

const mockRead = read as jest.MockedFunction<typeof read>
const mockWriteTransaction = writeTransaction as jest.MockedFunction<typeof writeTransaction>
const mockRecord = recordChange as jest.MockedFunction<typeof recordChange>

const AUTHOR = { email: 'alice@example.com', name: 'Alice', isAdmin: false }
const ADMIN = { email: 'admin@example.com', name: 'Admin', isAdmin: true }

const CREATE_ROW = {
  id: 'c1',
  authorEmail: 'alice@example.com',
  authorName: 'Alice',
  newValue: JSON.stringify({ name: 'Alice' }),
}

const PERSON_EXISTS = [{ exists: true }]

beforeEach(() => {
  jest.clearAllMocks()
  mockWriteTransaction.mockResolvedValue(undefined as never)
  mockRecord.mockResolvedValue(undefined as never)
})

describe('cascadeRevertPerson — person not found', () => {
  it('returns 404 with "Person not found" when the person node does not exist', async () => {
    mockRead
      .mockResolvedValueOnce([]) // createRows
      .mockResolvedValueOnce([]) // unionRows
      .mockResolvedValueOnce([]) // personRows — not found

    const result = await cascadeRevertPerson('I001', AUTHOR)
    expect(result).toEqual({ ok: false, status: 404, error: 'Person not found' })
    expect(mockWriteTransaction).not.toHaveBeenCalled()
  })
})

describe('cascadeRevertPerson — not found', () => {
  it('returns 404 when no CREATE_PERSON change exists for the requester', async () => {
    mockRead
      .mockResolvedValueOnce([]) // createRows — none found
      .mockResolvedValueOnce([]) // unionRows
      .mockResolvedValueOnce(PERSON_EXISTS) // person exists

    const result = await cascadeRevertPerson('I001', AUTHOR)
    expect(result).toEqual({ ok: false, status: 404, error: expect.any(String) })
    expect(mockWriteTransaction).not.toHaveBeenCalled()
  })
})

describe('cascadeRevertPerson — no unions', () => {
  it('deletes person and marks change reverted', async () => {
    mockRead
      .mockResolvedValueOnce([CREATE_ROW])
      .mockResolvedValueOnce([]) // no unions
      .mockResolvedValueOnce(PERSON_EXISTS)

    const result = await cascadeRevertPerson('I001', AUTHOR)
    expect(result).toEqual({ ok: true, unionsReverted: 0 })
    expect(mockWriteTransaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ cypher: expect.stringContaining('DETACH DELETE p') }),
        expect.objectContaining({ cypher: expect.stringContaining('SET c.status') }),
      ])
    )
    expect(mockRecord).toHaveBeenCalledWith(
      'alice@example.com',
      'Alice',
      'DELETE_PERSON',
      'I001',
      expect.any(Object),
      expect.any(Object)
    )
  })
})

describe('cascadeRevertPerson — with unions', () => {
  it('returns 403 with "Blocked by foreign connection" when non-admin has a union authored by another user', async () => {
    mockRead
      .mockResolvedValueOnce([CREATE_ROW])
      .mockResolvedValueOnce([{ unionId: 'U001' }])
      .mockResolvedValueOnce(PERSON_EXISTS)
      .mockResolvedValueOnce([
        { id: 'rel1', authorEmail: 'bob@example.com', authorName: 'Bob', newValue: JSON.stringify({ unionId: 'U001' }) },
      ])

    const result = await cascadeRevertPerson('I001', AUTHOR)
    expect(result).toMatchObject({ ok: false, status: 403, error: 'Blocked by foreign connection' })
    const blocked = (result as Extract<typeof result, { ok: false }>).blockedBy
    expect(blocked).toHaveLength(1)
    expect(blocked![0]).toMatchObject({ unionId: 'U001', authorEmail: 'bob@example.com' })
    expect(mockWriteTransaction).not.toHaveBeenCalled()
  })

  it('admin bypasses authorship check and reverts person with other-authored unions', async () => {
    mockRead
      .mockResolvedValueOnce([{ ...CREATE_ROW, authorEmail: 'admin@example.com' }])
      .mockResolvedValueOnce([{ unionId: 'U001' }])
      .mockResolvedValueOnce(PERSON_EXISTS)
      .mockResolvedValueOnce([
        { id: 'rel1', authorEmail: 'bob@example.com', authorName: 'Bob', newValue: JSON.stringify({ unionId: 'U001' }) },
      ])

    const result = await cascadeRevertPerson('I001', ADMIN)
    expect(result).toEqual({ ok: true, unionsReverted: 1 })
    expect(mockWriteTransaction).toHaveBeenCalled()
  })

  it('non-admin successfully deletes person with own-authored union', async () => {
    mockRead
      .mockResolvedValueOnce([CREATE_ROW])
      .mockResolvedValueOnce([{ unionId: 'U001' }])
      .mockResolvedValueOnce(PERSON_EXISTS)
      .mockResolvedValueOnce([
        { id: 'rel1', authorEmail: 'alice@example.com', authorName: 'Alice', newValue: JSON.stringify({ unionId: 'U001' }) },
      ])

    const result = await cascadeRevertPerson('I001', AUTHOR)
    expect(result).toEqual({ ok: true, unionsReverted: 1 })
  })
})

describe('cascadeRevertPerson — child-edge union discovery', () => {
  it('discovers unions where person is a child (incoming CHILD edge)', async () => {
    // The union query now uses OR (u)-[:CHILD]->(p); this test verifies the
    // result is processed correctly when the DB returns a union from that path.
    mockRead
      .mockResolvedValueOnce([CREATE_ROW])
      .mockResolvedValueOnce([{ unionId: 'U_CHILD' }]) // returned by the fixed query
      .mockResolvedValueOnce(PERSON_EXISTS)
      .mockResolvedValueOnce([
        { id: 'rel2', authorEmail: 'alice@example.com', authorName: 'Alice', newValue: JSON.stringify({ unionId: 'U_CHILD' }) },
      ])

    const result = await cascadeRevertPerson('I001', AUTHOR)
    expect(result).toEqual({ ok: true, unionsReverted: 1 })
    expect(mockWriteTransaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ cypher: expect.stringContaining('DETACH DELETE u'), params: expect.objectContaining({ unionIds: ['U_CHILD'] }) }),
      ])
    )
  })
})

describe('cascadeRevertPerson — malformed change record', () => {
  it('returns 409 when newValue cannot be parsed as JSON', async () => {
    mockRead
      .mockResolvedValueOnce([{ ...CREATE_ROW, newValue: 'not-json' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(PERSON_EXISTS)

    const result = await cascadeRevertPerson('I001', AUTHOR)
    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) })
    expect(mockWriteTransaction).not.toHaveBeenCalled()
  })
})

describe('cascadeRevertPerson — database errors', () => {
  it('returns 500 with "Database error" when the initial reads throw', async () => {
    mockRead.mockRejectedValueOnce(new Error('Neo4j unreachable'))

    const result = await cascadeRevertPerson('I001', AUTHOR)
    expect(result).toEqual({ ok: false, status: 500, error: 'Database error' })
    expect(mockWriteTransaction).not.toHaveBeenCalled()
  })

  it('returns 500 with "Database error" when writeTransaction throws', async () => {
    mockRead
      .mockResolvedValueOnce([CREATE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(PERSON_EXISTS)
    mockWriteTransaction.mockRejectedValueOnce(new Error('transaction failed'))

    const result = await cascadeRevertPerson('I001', AUTHOR)
    expect(result).toEqual({ ok: false, status: 500, error: 'Database error' })
  })

  it('returns 500 with "Database error" when the union relation read throws', async () => {
    mockRead
      .mockResolvedValueOnce([CREATE_ROW])
      .mockResolvedValueOnce([{ unionId: 'U001' }])
      .mockResolvedValueOnce(PERSON_EXISTS)
      .mockRejectedValueOnce(new Error('Neo4j unreachable'))

    const result = await cascadeRevertPerson('I001', AUTHOR)
    expect(result).toEqual({ ok: false, status: 500, error: 'Database error' })
    expect(mockWriteTransaction).not.toHaveBeenCalled()
  })
})
