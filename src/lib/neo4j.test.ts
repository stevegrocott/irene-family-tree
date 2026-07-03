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

import { read, closeDriver } from './neo4j'

describe('neo4j connection', () => {
  afterAll(async () => {
    await closeDriver()
  })

  it('runs RETURN 1 AS n and returns 1', async () => {
    const rows = await read<{ n: number }>('RETURN 1 AS n')
    expect(rows[0].n).toBe(1)
  })
})
