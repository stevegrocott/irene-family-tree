jest.mock('@/lib/neo4j', () => ({ read: jest.fn(), write: jest.fn() }))
jest.mock('@/lib/changes', () => ({ recordChange: jest.fn() }))

import { read, write } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { revertChange } from './revert'

const mockRead = read as jest.MockedFunction<typeof read>
const mockWrite = write as jest.MockedFunction<typeof write>
const mockRecord = recordChange as jest.MockedFunction<typeof recordChange>

const REVERTER = { email: 'alice@example.com', name: 'Alice' }

beforeEach(() => {
  jest.clearAllMocks()
  mockWrite.mockResolvedValue([])
})

describe('revertChange — CREATE_PERSON', () => {
  it('deletes the Person, flips status=reverted, writes DELETE_PERSON audit', async () => {
    mockRead
      // 1st read: fetch change row
      .mockResolvedValueOnce([
        {
          id: 'c1',
          changeType: 'CREATE_PERSON',
          targetId: 'I001',
          previousValue: null,
          newValue: JSON.stringify({ name: 'X' }),
          status: 'live',
          authorEmail: 'a@b',
          authorName: 'A',
          appliedAt: '2026-01-01',
        },
      ])
      // 2nd read: edge count for CREATE_PERSON block check
      .mockResolvedValueOnce([{ edges: 0 }])

    const result = await revertChange('c1', REVERTER)

    expect(result).toEqual({ ok: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('DETACH DELETE'),
      expect.objectContaining({ targetId: 'I001' })
    )
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'reverted'"),
      expect.objectContaining({ id: 'c1' })
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

  it('returns 409 has-relationships when person has UNION or CHILD edges', async () => {
    mockRead
      // 1st read: fetch change row
      .mockResolvedValueOnce([
        {
          id: 'c1',
          changeType: 'CREATE_PERSON',
          targetId: 'I001',
          previousValue: null,
          newValue: '{}',
          status: 'live',
          authorEmail: 'a@b',
          authorName: 'A',
          appliedAt: '2026-01-01',
        },
      ])
      // 2nd read: edge count for CREATE_PERSON block check
      .mockResolvedValueOnce([{ edges: 2 }])

    const result = await revertChange('c1', REVERTER)

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 409,
        conflict: { kind: 'has-relationships', detail: expect.stringContaining('relationship') },
      })
    )
    expect(mockWrite).not.toHaveBeenCalled()
  })
})

describe('revertChange — ADD_RELATIONSHIP', () => {
  it('spouse happy path: deletes union when unionEdges=2 and childEdges=0', async () => {
    mockRead
      // 1st read: fetch change row
      .mockResolvedValueOnce([
        {
          id: 'c2',
          changeType: 'ADD_RELATIONSHIP',
          targetId: 'I001',
          previousValue: null,
          newValue: JSON.stringify({ type: 'spouse', targetId: 'I002', unionId: 'U001' }),
          status: 'live',
          authorEmail: 'a@b',
          authorName: 'A',
          appliedAt: '2026-01-01',
        },
      ])
      // 2nd read: union edge counts (spouse/child) for pristine check
      .mockResolvedValueOnce([{ unionEdges: 2, childEdges: 0 }])

    const result = await revertChange('c2', REVERTER)

    expect(result).toEqual({ ok: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (u:Union {gedcomId: $unionId}) DETACH DELETE u'),
      expect.objectContaining({ unionId: 'U001' })
    )
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'reverted'"),
      expect.objectContaining({ id: 'c2' })
    )
  })

  it('parent/child happy path: deletes union when unionEdges=1 and childEdges=1', async () => {
    mockRead
      // 1st read: fetch change row
      .mockResolvedValueOnce([
        {
          id: 'c3',
          changeType: 'ADD_RELATIONSHIP',
          targetId: 'I001',
          previousValue: null,
          newValue: JSON.stringify({ type: 'parent', targetId: 'I003', unionId: 'U002' }),
          status: 'live',
          authorEmail: 'a@b',
          authorName: 'A',
          appliedAt: '2026-01-01',
        },
      ])
      // 2nd read: union edge counts (spouse/child) for pristine check
      .mockResolvedValueOnce([{ unionEdges: 1, childEdges: 1 }])

    const result = await revertChange('c3', REVERTER)

    expect(result).toEqual({ ok: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (u:Union {gedcomId: $unionId}) DETACH DELETE u'),
      expect.objectContaining({ unionId: 'U002' })
    )
  })

  it('spouse block: returns 409 union-touched when union has a CHILD edge', async () => {
    mockRead
      // 1st read: fetch change row
      .mockResolvedValueOnce([
        {
          id: 'c4',
          changeType: 'ADD_RELATIONSHIP',
          targetId: 'I001',
          previousValue: null,
          newValue: JSON.stringify({ type: 'spouse', targetId: 'I002', unionId: 'U003' }),
          status: 'live',
          authorEmail: 'a@b',
          authorName: 'A',
          appliedAt: '2026-01-01',
        },
      ])
      // 2nd read: union edge counts (spouse/child) for pristine check
      .mockResolvedValueOnce([{ unionEdges: 2, childEdges: 1 }])

    const result = await revertChange('c4', REVERTER)

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 409,
        conflict: expect.objectContaining({ kind: 'union-touched' }),
      })
    )
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('parent/child block: returns 409 union-touched when union has extra UNION or CHILD', async () => {
    mockRead
      // 1st read: fetch change row
      .mockResolvedValueOnce([
        {
          id: 'c5',
          changeType: 'ADD_RELATIONSHIP',
          targetId: 'I001',
          previousValue: null,
          newValue: JSON.stringify({ type: 'child', targetId: 'I004', unionId: 'U004' }),
          status: 'live',
          authorEmail: 'a@b',
          authorName: 'A',
          appliedAt: '2026-01-01',
        },
      ])
      // 2nd read: union edge counts (spouse/child) for pristine check
      .mockResolvedValueOnce([{ unionEdges: 2, childEdges: 1 }])

    const result = await revertChange('c5', REVERTER)

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 409,
        conflict: expect.objectContaining({ kind: 'union-touched' }),
      })
    )
    expect(mockWrite).not.toHaveBeenCalled()
  })
})

describe('revertChange — UPDATE_PERSON', () => {
  it('happy path: applies previousValue to Person, flips status=reverted', async () => {
    mockRead
      // 1st read: fetch change row
      .mockResolvedValueOnce([
        {
          id: 'c6',
          changeType: 'UPDATE_PERSON',
          targetId: 'I001',
          previousValue: JSON.stringify({ name: 'Old', birthYear: 1900, bogusField: 'ignore' }),
          newValue: JSON.stringify({ name: 'New', birthYear: 1901 }),
          status: 'live',
          authorEmail: 'a@b',
          authorName: 'A',
          appliedAt: '2026-01-01',
        },
      ])
      // 2nd read: later-change lookup for field-updated-later conflict (empty = no later edits)
      .mockResolvedValueOnce([])

    const result = await revertChange('c6', REVERTER)

    expect(result).toEqual({ ok: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('SET p += $prevValue'),
      expect.objectContaining({
        targetId: 'I001',
        prevValue: expect.objectContaining({ name: 'Old', birthYear: 1900 }),
      })
    )
    // The bogus field must be filtered out
    const setCall = mockWrite.mock.calls.find(([cypher]) =>
      typeof cypher === 'string' && cypher.includes('SET p += $prevValue')
    )
    expect(setCall).toBeDefined()
    const prevValueArg = (setCall![1] as { prevValue: Record<string, unknown> }).prevValue
    expect(prevValueArg).not.toHaveProperty('bogusField')

    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'reverted'"),
      expect.objectContaining({ id: 'c6' })
    )
  })

  it('block: returns 409 field-updated-later when a later UPDATE_PERSON touches an overlapping field', async () => {
    mockRead
      // 1st read: fetch change row
      .mockResolvedValueOnce([
        {
          id: 'c7',
          changeType: 'UPDATE_PERSON',
          targetId: 'I001',
          previousValue: JSON.stringify({ name: 'Old', birthYear: 1900 }),
          newValue: JSON.stringify({ name: 'Mid' }),
          status: 'live',
          authorEmail: 'a@b',
          authorName: 'A',
          appliedAt: '2026-01-01',
        },
      ])
      // 2nd read: later-change lookup (one later UPDATE_PERSON touching 'name')
      .mockResolvedValueOnce([
        { id: 'c8', newValue: JSON.stringify({ name: 'Newer' }) },
      ])

    const result = await revertChange('c7', REVERTER)

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 409,
        conflict: expect.objectContaining({ kind: 'field-updated-later' }),
      })
    )
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('no false-positive block: later UPDATE_PERSON with only disallowed keys does not conflict', async () => {
    mockRead
      // 1st read: fetch change row
      .mockResolvedValueOnce([
        {
          id: 'c10',
          changeType: 'UPDATE_PERSON',
          targetId: 'I001',
          previousValue: JSON.stringify({ name: 'Old', birthYear: 1900 }),
          newValue: JSON.stringify({ name: 'Mid' }),
          status: 'live',
          authorEmail: 'a@b',
          authorName: 'A',
          appliedAt: '2026-01-01',
        },
      ])
      // 2nd read: later-change lookup returns a change whose newValue contains ONLY
      // disallowed keys (not in ALLOWED_PATCH_FIELDS). The revert-keys set is filtered
      // through ALLOWED_PATCH_FIELDS, so overlap must be empty and revert must succeed.
      .mockResolvedValueOnce([
        { id: 'c11', newValue: JSON.stringify({ bogusField: 'x', anotherJunk: 42 }) },
      ])

    const result = await revertChange('c10', REVERTER)

    expect(result).toEqual({ ok: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('SET p += $prevValue'),
      expect.objectContaining({ targetId: 'I001' })
    )
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'reverted'"),
      expect.objectContaining({ id: 'c10' })
    )
  })
})

describe('revertChange — edge cases', () => {
  it('returns 404 when the change id does not match', async () => {
    // 1st read: fetch change row (empty = not found)
    mockRead.mockResolvedValueOnce([])

    const result = await revertChange('missing', REVERTER)

    expect(result).toEqual({ ok: false, status: 404, error: 'Change not found' })
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('returns 409 Change is not live when status !== live', async () => {
    // 1st read: fetch change row (already reverted)
    mockRead.mockResolvedValueOnce([
      {
        id: 'c9',
        changeType: 'CREATE_PERSON',
        targetId: 'I001',
        previousValue: null,
        newValue: '{}',
        status: 'reverted',
        authorEmail: 'a@b',
        authorName: 'A',
        appliedAt: '2026-01-01',
      },
    ])

    const result = await revertChange('c9', REVERTER)

    expect(result).toEqual({ ok: false, status: 409, error: 'Change is not live' })
    expect(mockWrite).not.toHaveBeenCalled()
  })
})
