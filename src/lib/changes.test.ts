jest.mock('@/lib/neo4j', () => ({
  write: jest.fn().mockResolvedValue([]),
}))

import { write } from '@/lib/neo4j'
const mockWrite = write as jest.MockedFunction<typeof write>

import { recordChange } from './changes'

describe('recordChange', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockWrite.mockResolvedValue([])
  })

  it('creates a Change node with author, changeType, targetId, and serialized values', async () => {
    await recordChange('alice@example.com', 'Alice', 'UPDATE_PERSON', 'I001', { name: 'Old' }, { name: 'New' })

    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('CREATE (c:Change'),
      expect.objectContaining({
        authorEmail: 'alice@example.com',
        authorName: 'Alice',
        changeType: 'UPDATE_PERSON',
        targetId: 'I001',
        previousValue: JSON.stringify({ name: 'Old' }),
        newValue: JSON.stringify({ name: 'New' }),
      })
    )
  })

  it('stores null when previousValue is null', async () => {
    await recordChange('alice@example.com', 'Alice', 'CREATE_PERSON', 'I001', null, { name: 'New Person' })

    expect(mockWrite).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        previousValue: null,
        newValue: JSON.stringify({ name: 'New Person' }),
      })
    )
  })

  it('includes appliedAt string and id in the write parameters', async () => {
    await recordChange('alice@example.com', 'Alice', 'CREATE_PERSON', 'I001', null, {})

    expect(mockWrite).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        appliedAt: expect.any(String),
        id: expect.any(String),
      })
    )
  })

  it('resolves without returning a value', async () => {
    await expect(
      recordChange('alice@example.com', 'Alice', 'UPDATE_PERSON', 'I001', null, {})
    ).resolves.toBeUndefined()
  })
})
