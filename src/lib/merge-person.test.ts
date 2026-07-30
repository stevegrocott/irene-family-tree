jest.mock('@/lib/neo4j', () => ({ read: jest.fn(), writeTransaction: jest.fn() }))
jest.mock('@/lib/changes', () => ({ recordChange: jest.fn() }))

import { read, writeTransaction } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { mergePersons } from './merge-person'

const mockRead = read as jest.MockedFunction<typeof read>
const mockWriteTx = writeTransaction as jest.MockedFunction<typeof writeTransaction>
const mockRecord = recordChange as jest.MockedFunction<typeof recordChange>

const ADMIN = { email: 'admin@example.com', name: 'Admin' }

// Helper: queue survivor props then duplicate props for the two reads.
function queuePersons(
  survivor: Record<string, unknown> | null,
  duplicate: Record<string, unknown> | null
) {
  mockRead
    .mockResolvedValueOnce(survivor === null ? [] : [{ props: survivor }])
    .mockResolvedValueOnce(duplicate === null ? [] : [{ props: duplicate }])
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so the mockResolvedValueOnce queue is
  // cleared between tests — a test that reads only once must not leak its
  // second queued value into the next test.
  jest.resetAllMocks()
  mockRead.mockResolvedValue([])
  mockWriteTx.mockResolvedValue(undefined)
  mockRecord.mockResolvedValue(undefined)
})

describe('mergePersons — happy path', () => {
  it('coalesces null survivor scalars from the duplicate', async () => {
    // Arrange
    queuePersons(
      { gedcomId: 'I001', name: 'Jane Doe', birthYear: '1900', deathYear: null, occupation: null },
      { gedcomId: 'I002', name: 'Jane D', birthYear: '1899', deathYear: '1980', occupation: 'Nurse' }
    )

    // Act
    const result = await mergePersons('I001', 'I002', ADMIN)

    // Assert
    expect(result).toEqual({ ok: true, survivorId: 'I001' })
    const statements = mockWriteTx.mock.calls[0][0]
    const setStmt = statements.find(s => s.cypher.includes('SET surv += $props'))
    expect(setStmt).toBeDefined()
    // survivor keeps its own non-null values; only null fields are filled from duplicate
    expect(setStmt!.params).toEqual(
      expect.objectContaining({
        survivorId: 'I001',
        props: { deathYear: '1980', occupation: 'Nurse' },
      })
    )
  })

  it('runs SET, UNION rewire, CHILD rewire, and DETACH DELETE in one transaction', async () => {
    // Arrange
    queuePersons({ gedcomId: 'I001', name: 'A' }, { gedcomId: 'I002', name: 'B' })

    // Act
    await mergePersons('I001', 'I002', ADMIN)

    // Assert
    expect(mockWriteTx).toHaveBeenCalledTimes(1)
    const statements = mockWriteTx.mock.calls[0][0]
    const joined = statements.map(s => s.cypher).join('\n---\n')
    expect(joined).toContain('SET surv += $props')
    expect(joined).toMatch(/\[:UNION\]->\(u[\s\S]*MERGE \(surv\)-\[:UNION\]->\(u\)/)
    expect(joined).toMatch(/\[:CHILD\]->\(dup[\s\S]*MERGE \(u\)-\[:CHILD\]->\(surv\)/)
    expect(joined).toContain('DETACH DELETE dup')
    // DETACH DELETE must be the final statement so edges are rewired first
    expect(statements[statements.length - 1].cypher).toContain('DETACH DELETE dup')
  })

  it('records MERGE_PERSON with both prior states as previousValue', async () => {
    // Arrange
    const survivor = { gedcomId: 'I001', name: 'A', birthYear: null }
    const duplicate = { gedcomId: 'I002', name: 'B', birthYear: '1900' }
    queuePersons(survivor, duplicate)

    // Act
    await mergePersons('I001', 'I002', ADMIN)

    // Assert
    expect(mockRecord).toHaveBeenCalledWith(
      'admin@example.com',
      'Admin',
      'MERGE_PERSON',
      'I001',
      { survivor, duplicate },
      expect.objectContaining({ gedcomId: 'I001', birthYear: '1900' })
    )
  })
})

describe('mergePersons — validation', () => {
  it('returns 400 when survivor and duplicate are the same id', async () => {
    // Act
    const result = await mergePersons('I001', 'I001', ADMIN)

    // Assert
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 400 }))
    expect(mockRead).not.toHaveBeenCalled()
    expect(mockWriteTx).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('returns 404 when the survivor does not exist', async () => {
    // Arrange
    queuePersons(null, { gedcomId: 'I002' })

    // Act
    const result = await mergePersons('I001', 'I002', ADMIN)

    // Assert
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 404 }))
    expect(mockWriteTx).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('returns 404 when the duplicate does not exist', async () => {
    // Arrange
    queuePersons({ gedcomId: 'I001' }, null)

    // Act
    const result = await mergePersons('I001', 'I002', ADMIN)

    // Assert
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 404 }))
    expect(mockWriteTx).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })
})
