import { POST } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
  write: jest.fn(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

jest.mock('@/lib/revert', () => ({
  revertChange: jest.fn(),
}))

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

import { auth } from '@/auth'
const mockAuth = auth as jest.MockedFunction<typeof auth>

import { revertChange } from '@/lib/revert'
const mockRevert = revertChange as jest.MockedFunction<typeof revertChange>

const AUTHOR_SESSION = {
  user: { email: 'author@example.com', name: 'Author', role: 'user' },
}
const OTHER_USER_SESSION = {
  user: { email: 'user@example.com', name: 'User', role: 'user' },
}
const ADMIN_SESSION = {
  user: { email: 'admin@example.com', name: 'Admin', role: 'admin' },
}

const makeRequest = () =>
  new Request('http://localhost/api/changes/change-1/revert', {
    method: 'POST',
  })

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('POST /api/changes/[id]/revert', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)

    const response = await POST(makeRequest(), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockRead).not.toHaveBeenCalled()
    expect(mockRevert).not.toHaveBeenCalled()
  })

  it('returns 404 when the change does not exist', async () => {
    mockAuth.mockResolvedValue(AUTHOR_SESSION as never)
    mockRead.mockResolvedValue([])

    const response = await POST(makeRequest(), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Change not found' })
    expect(mockRevert).not.toHaveBeenCalled()
  })

  it('returns 403 when signed-in user is neither author nor admin', async () => {
    mockAuth.mockResolvedValue(OTHER_USER_SESSION as never)
    mockRead.mockResolvedValue([{ authorEmail: 'other@example.com' }])

    const response = await POST(makeRequest(), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Forbidden' })
    expect(mockRevert).not.toHaveBeenCalled()
  })

  it('returns 200 when the signed-in user is the author', async () => {
    mockAuth.mockResolvedValue(AUTHOR_SESSION as never)
    mockRead.mockResolvedValue([{ authorEmail: 'author@example.com' }])
    mockRevert.mockResolvedValue({ ok: true })

    const response = await POST(makeRequest(), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockRevert).toHaveBeenCalledWith('change-1', {
      email: 'author@example.com',
      name: 'Author',
    })
  })

  it('returns 200 when signed-in user is admin acting on someone else\'s change', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([{ authorEmail: 'author@example.com' }])
    mockRevert.mockResolvedValue({ ok: true })

    const response = await POST(makeRequest(), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockRevert).toHaveBeenCalledWith('change-1', {
      email: 'admin@example.com',
      name: 'Admin',
    })
  })

  it('returns 409 with conflictingChange when revertChange returns a conflict', async () => {
    mockAuth.mockResolvedValue(AUTHOR_SESSION as never)
    mockRead.mockResolvedValue([{ authorEmail: 'author@example.com' }])
    const conflict = {
      kind: 'has-relationships' as const,
      detail: 'Person has 2 relationship(s); remove them before reverting.',
    }
    mockRevert.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Cannot revert: person has relationships',
      conflict,
    })

    const response = await POST(makeRequest(), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({
      error: 'Cannot revert: person has relationships',
      conflictingChange: conflict,
    })
  })

  it('surfaces 404 from revertChange as a 404 response', async () => {
    mockAuth.mockResolvedValue(AUTHOR_SESSION as never)
    mockRead.mockResolvedValue([{ authorEmail: 'author@example.com' }])
    mockRevert.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Change not found',
    })

    const response = await POST(makeRequest(), makeParams('change-1'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({
      error: 'Change not found',
      conflictingChange: undefined,
    })
  })

  it('falls back to the session email when name is missing', async () => {
    mockAuth.mockResolvedValue({
      user: { email: 'noname@example.com', role: 'user' },
    } as never)
    mockRead.mockResolvedValue([{ authorEmail: 'noname@example.com' }])
    mockRevert.mockResolvedValue({ ok: true })

    await POST(makeRequest(), makeParams('change-1'))

    expect(mockRevert).toHaveBeenCalledWith('change-1', {
      email: 'noname@example.com',
      name: 'noname@example.com',
    })
  })
})
