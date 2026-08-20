import { GET, HEALTH_CHECK_TIMEOUT_MS } from './route'

jest.mock('@/lib/neo4j', () => ({
  getDriver: jest.fn(),
}))

import { getDriver } from '@/lib/neo4j'
const mockGetDriver = getDriver as jest.MockedFunction<typeof getDriver>

describe('GET /api/health', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it('returns 200 with status ok when the database is reachable', async () => {
    const verifyConnectivity = jest.fn().mockResolvedValue(undefined)
    mockGetDriver.mockReturnValue({ verifyConnectivity } as never)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.database).toBe('reachable')
    expect(typeof body.latencyMs).toBe('number')
    expect(verifyConnectivity).toHaveBeenCalledTimes(1)
  })

  it('returns 503 with a clear reason when the database rejects the connectivity check', async () => {
    const verifyConnectivity = jest.fn().mockRejectedValue(new Error('ServiceUnavailable: connection refused'))
    mockGetDriver.mockReturnValue({ verifyConnectivity } as never)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.status).toBe('error')
    expect(body.database).toBe('unreachable')
    expect(body.reason).toContain('ServiceUnavailable')
  })

  it('returns 503 within the hard timeout instead of hanging when the database never responds', async () => {
    jest.useFakeTimers()
    // Simulate a driver call that never settles (e.g. a hung connection attempt) —
    // the route must not inherit this and hang; it must fail fast via its own timeout.
    const verifyConnectivity = jest.fn().mockReturnValue(new Promise(() => {}))
    mockGetDriver.mockReturnValue({ verifyConnectivity } as never)

    const responsePromise = GET()
    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS)
    const response = await responsePromise
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.status).toBe('error')
    expect(body.database).toBe('unreachable')
    expect(body.reason).toContain('timed out')

    jest.useRealTimers()
  })
})
