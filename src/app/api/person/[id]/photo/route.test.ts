/**
 * Unit tests for POST /api/person/[id]/photo.
 *
 * Verifies auth gating, multipart validation (missing file, disallowed type,
 * oversized file), the successful upload path, and cleanup of the person's
 * previous photo blob. `@vercel/blob`'s `put`/`del`, `@/lib/neo4j`'s `read`,
 * and `@/auth`'s `auth` are fully mocked so no real network calls are made.
 */
import { POST } from './route'

jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
  del: jest.fn(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn().mockResolvedValue({ user: { email: 'editor@example.com', name: 'Editor User' } }),
}))

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn().mockResolvedValue([{ photoUrl: null }]),
}))

import { put, del } from '@vercel/blob'
const mockPut = put as jest.MockedFunction<typeof put>
const mockDel = del as jest.MockedFunction<typeof del>

import { auth } from '@/auth'
const mockAuth = auth as unknown as jest.MockedFunction<() => Promise<unknown>>

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

/**
 * Constructs the route segment params object expected by the Next.js handler.
 */
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

/**
 * Builds a multipart/form-data POST request carrying an optional `file` field.
 */
const makeRequest = (file?: File) => {
  const formData = new FormData()
  if (file) formData.set('file', file)
  return new Request('http://localhost/api/person/I001/photo', {
    method: 'POST',
    body: formData,
  })
}

const makeFile = (name: string, type: string, sizeBytes: number) =>
  new File([new Uint8Array(sizeBytes)], name, { type })

describe('POST /api/person/[id]/photo', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRead.mockResolvedValue([{ photoUrl: null }])
  })

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null)

    const response = await POST(makeRequest(makeFile('photo.jpg', 'image/jpeg', 100)), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('returns 400 when no file is provided', async () => {
    const response = await POST(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'No file provided' })
  })

  it('returns 400 when the request body is not valid multipart form data', async () => {
    const request = new Request('http://localhost/api/person/I001/photo', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=broken' },
      body: 'not actually multipart',
    })

    const response = await POST(request, makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Invalid multipart form data' })
  })

  it('returns 400 for a disallowed file type', async () => {
    const response = await POST(
      makeRequest(makeFile('doc.pdf', 'application/pdf', 100)),
      makeParams('I001')
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'File must be a JPEG, PNG, or WebP image' })
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('returns 400 when the file exceeds 5 MB', async () => {
    const response = await POST(
      makeRequest(makeFile('big.png', 'image/png', 5 * 1024 * 1024 + 1)),
      makeParams('I001')
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'File must be 5 MB or smaller' })
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('accepts a file exactly at the 5 MB limit', async () => {
    mockPut.mockResolvedValue({ url: 'https://blob.vercel-storage.com/person-photos/I001-abc.png' } as never)

    const response = await POST(
      makeRequest(makeFile('exact.png', 'image/png', 5 * 1024 * 1024)),
      makeParams('I001')
    )

    expect(response.status).toBe(200)
    expect(mockPut).toHaveBeenCalled()
  })

  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'uploads a %s file via put() and returns its url',
    async (mimeType) => {
      mockPut.mockResolvedValue({ url: 'https://blob.vercel-storage.com/person-photos/I001-abc.jpg' } as never)

      const response = await POST(
        makeRequest(makeFile('photo', mimeType, 1024)),
        makeParams('I001')
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ url: 'https://blob.vercel-storage.com/person-photos/I001-abc.jpg' })
    }
  )

  it('uploads to a pathname namespaced by person id with public access', async () => {
    mockPut.mockResolvedValue({ url: 'https://blob.vercel-storage.com/person-photos/I001-abc.jpg' } as never)

    await POST(makeRequest(makeFile('photo.jpg', 'image/jpeg', 1024)), makeParams('I001'))

    expect(mockPut).toHaveBeenCalledWith(
      expect.stringMatching(/^person-photos\/I001-.+\.jpg$/),
      expect.any(File),
      { access: 'public' }
    )
  })

  it('returns 500 when the blob upload fails', async () => {
    mockPut.mockRejectedValue(new Error('Blob store unavailable'))

    const response = await POST(
      makeRequest(makeFile('photo.jpg', 'image/jpeg', 1024)),
      makeParams('I001')
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to upload photo', detail: 'Blob store unavailable' })
    expect(mockDel).not.toHaveBeenCalled()
  })

  it("deletes the person's previous photo blob after a successful upload", async () => {
    mockRead.mockResolvedValue([
      { photoUrl: 'https://blob.vercel-storage.com/person-photos/I001-old.jpg' },
    ])
    mockPut.mockResolvedValue({ url: 'https://blob.vercel-storage.com/person-photos/I001-new.jpg' } as never)

    const response = await POST(
      makeRequest(makeFile('photo.jpg', 'image/jpeg', 1024)),
      makeParams('I001')
    )

    expect(response.status).toBe(200)
    expect(mockDel).toHaveBeenCalledWith('https://blob.vercel-storage.com/person-photos/I001-old.jpg')
  })

  it('does not attempt deletion when the person has no previous photo', async () => {
    mockRead.mockResolvedValue([{ photoUrl: null }])
    mockPut.mockResolvedValue({ url: 'https://blob.vercel-storage.com/person-photos/I001-new.jpg' } as never)

    const response = await POST(
      makeRequest(makeFile('photo.jpg', 'image/jpeg', 1024)),
      makeParams('I001')
    )

    expect(response.status).toBe(200)
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('succeeds even when the previous-photo lookup fails', async () => {
    mockRead.mockRejectedValue(new Error('Neo4j unavailable'))
    mockPut.mockResolvedValue({ url: 'https://blob.vercel-storage.com/person-photos/I001-new.jpg' } as never)

    const response = await POST(
      makeRequest(makeFile('photo.jpg', 'image/jpeg', 1024)),
      makeParams('I001')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ url: 'https://blob.vercel-storage.com/person-photos/I001-new.jpg' })
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('succeeds even when deleting the previous photo blob fails', async () => {
    mockRead.mockResolvedValue([
      { photoUrl: 'https://blob.vercel-storage.com/person-photos/I001-old.jpg' },
    ])
    mockPut.mockResolvedValue({ url: 'https://blob.vercel-storage.com/person-photos/I001-new.jpg' } as never)
    mockDel.mockRejectedValue(new Error('Blob not found'))

    const response = await POST(
      makeRequest(makeFile('photo.jpg', 'image/jpeg', 1024)),
      makeParams('I001')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ url: 'https://blob.vercel-storage.com/person-photos/I001-new.jpg' })
  })
})
