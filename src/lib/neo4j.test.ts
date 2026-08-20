const mockRun = jest.fn().mockResolvedValue({
  records: [{ toObject: () => ({ n: 1 }) }],
})
const mockSession = {
  executeRead: jest.fn((work: (tx: { run: typeof mockRun }) => unknown) => work({ run: mockRun })),
  executeWrite: jest.fn((work: (tx: { run: typeof mockRun }) => unknown) => work({ run: mockRun })),
  close: jest.fn().mockResolvedValue(undefined),
}
const mockDriver = {
  session: jest.fn(() => mockSession),
  close: jest.fn().mockResolvedValue(undefined),
}

jest.mock('neo4j-driver', () => ({
  __esModule: true,
  default: {
    driver: jest.fn(() => mockDriver),
    auth: { basic: jest.fn() },
    session: { READ: 'READ', WRITE: 'WRITE' },
  },
}))

import neo4j from 'neo4j-driver'
import { read, closeDriver } from './neo4j'

describe('neo4j connection', () => {
  afterAll(async () => {
    await closeDriver()
  })

  it('runs RETURN 1 AS n and returns 1', async () => {
    const rows = await read<{ n: number }>('RETURN 1 AS n')
    expect(rows[0].n).toBe(1)
  })

  it('caps maxTransactionRetryTime and connectionAcquisitionTimeout well under the 30s driver default', async () => {
    await read('RETURN 1 AS n')
    const [, , config] = (neo4j.driver as jest.Mock).mock.calls[0]
    expect(config.maxTransactionRetryTime).toBeGreaterThan(0)
    expect(config.maxTransactionRetryTime).toBeLessThanOrEqual(10_000)
    expect(config.connectionAcquisitionTimeout).toBeGreaterThan(0)
    expect(config.connectionAcquisitionTimeout).toBeLessThanOrEqual(10_000)
  })
})
