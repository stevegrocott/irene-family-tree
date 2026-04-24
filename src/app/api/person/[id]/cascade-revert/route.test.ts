import { POST } from './route'

jest.mock('@/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/cascade-revert', () => ({ cascadeRevertPerson: jest.fn() }))

import { auth } from '@/auth'
import { cascadeRevertPerson } from '@/lib/cascade-revert'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockCascade = cascadeRevertPerson as jest.MockedFunction<typeof cascadeRevertPerson>

const USER_SESSION = { user: { email: 'alice@example.com', name: 'Alice', role: 'user' } }
const ADMIN_SESSION = { user: { email: 'admin@example.com', name: 'Admin', role: 'admin' } }

const makeRequest = () =>
  new Request('http://localhost/api/person/I001/cascade-revert', { method: 'POST' })

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('POST /api/person/[id]/cascade-revert', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as never)

    const res = await POST(makeRequest(), makeParams('I001'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(mockCascade).not.toHaveBeenCalled()
  })

  it('returns 200 with unionsReverted on success', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    mockCascade.mockResolvedValue({ ok: true, unionsReverted: 3 })

    const res = await POST(makeRequest(), makeParams('I001'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, unionsReverted: 3 })
    expect(mockCascade).toHaveBeenCalledWith('I001', {
      email: 'alice@example.com',
      name: 'Alice',
      isAdmin: false,
    })
  })

  it('passes isAdmin: true for admin session', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockCascade.mockResolvedValue({ ok: true, unionsReverted: 0 })

    await POST(makeRequest(), makeParams('I001'))
    expect(mockCascade).toHaveBeenCalledWith('I001', expect.objectContaining({ isAdmin: true }))
  })

  it('returns 404 when person or change not found', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    mockCascade.mockResolvedValue({ ok: false, status: 404, error: 'No CREATE_PERSON change found' })

    const res = await POST(makeRequest(), makeParams('I001'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/CREATE_PERSON/i)
  })

  it('returns 403 with blockedBy when non-author connections block deletion', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    mockCascade.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'blocked',
      blockedBy: [{ unionId: 'U001', authorEmail: 'bob@example.com', authorName: 'Bob' }],
    })

    const res = await POST(makeRequest(), makeParams('I001'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('blocked')
    expect(body.blockedBy).toHaveLength(1)
    expect(body.blockedBy[0]).toMatchObject({ authorEmail: 'bob@example.com' })
  })

  it('returns 500 when cascadeRevertPerson throws', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    mockCascade.mockRejectedValue(new Error('DB unreachable'))

    const res = await POST(makeRequest(), makeParams('I001'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to revert person' })
  })
})
