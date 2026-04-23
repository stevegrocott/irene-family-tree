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
