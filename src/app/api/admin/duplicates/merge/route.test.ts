import { POST } from './route'

jest.mock('@/lib/merge-person', () => ({
  mergePersons: jest.fn(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

import { mergePersons } from '@/lib/merge-person'
const mockMerge = mergePersons as jest.MockedFunction<typeof mergePersons>

import { auth } from '@/auth'
const mockAuth = auth as jest.MockedFunction<typeof auth>

const ADMIN_SESSION = { user: { email: 'admin@example.com', name: 'Admin', role: 'admin' } }
const USER_SESSION = { user: { email: 'user@example.com', name: 'User', role: 'user' } }

const makeRequest = (body: unknown) =>
  new Request('http://localhost/api/admin/duplicates/merge', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

describe('POST /api/admin/duplicates/merge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)

    const response = await POST(makeRequest({ survivorId: 'I001', duplicateId: 'I002' }))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('returns 403 when the authenticated user is not an admin', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)

    const response = await POST(makeRequest({ survivorId: 'I001', duplicateId: 'I002' }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({ error: 'Forbidden' })
    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('returns 400 when the request body is not valid JSON', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    const request = new Request('http://localhost/api/admin/duplicates/merge', {
      method: 'POST',
      body: 'not-json',
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Invalid JSON body' })
  })

  it('returns 400 when survivorId is missing', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)

    const response = await POST(makeRequest({ duplicateId: 'I002' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'survivorId and duplicateId are required strings' })
    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('returns 400 when duplicateId is missing', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)

    const response = await POST(makeRequest({ survivorId: 'I001' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'survivorId and duplicateId are required strings' })
    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('returns 400 when survivorId or duplicateId is not a string', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)

    const response = await POST(makeRequest({ survivorId: 42, duplicateId: 'I002' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'survivorId and duplicateId are required strings' })
    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('delegates to mergePersons with the ids and admin derived from the session', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockMerge.mockResolvedValue({ ok: true, survivorId: 'I001' })

    const response = await POST(makeRequest({ survivorId: 'I001', duplicateId: 'I002' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, survivorId: 'I001' })
    expect(mockMerge).toHaveBeenCalledWith('I001', 'I002', {
      email: 'admin@example.com',
      name: 'Admin',
    })
  })

  it('falls back to email for name when session has no name', async () => {
    mockAuth.mockResolvedValue({
      user: { email: 'noname@example.com', role: 'admin' },
    } as never)
    mockMerge.mockResolvedValue({ ok: true, survivorId: 'I001' })

    await POST(makeRequest({ survivorId: 'I001', duplicateId: 'I002' }))

    expect(mockMerge).toHaveBeenCalledWith('I001', 'I002', {
      email: 'noname@example.com',
      name: 'noname@example.com',
    })
  })

  it('returns 400 from mergePersons when survivorId and duplicateId are the same', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockMerge.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Cannot merge a person into itself',
    })

    const response = await POST(makeRequest({ survivorId: 'I001', duplicateId: 'I001' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Cannot merge a person into itself' })
  })

  it('returns 404 from mergePersons when the survivor does not exist', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockMerge.mockResolvedValue({ ok: false, status: 404, error: 'Survivor not found' })

    const response = await POST(makeRequest({ survivorId: 'I001', duplicateId: 'I002' }))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Survivor not found' })
  })

  it('returns 404 from mergePersons when the duplicate does not exist', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockMerge.mockResolvedValue({ ok: false, status: 404, error: 'Duplicate not found' })

    const response = await POST(makeRequest({ survivorId: 'I001', duplicateId: 'I002' }))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Duplicate not found' })
  })
})
