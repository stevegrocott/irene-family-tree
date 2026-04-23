import { NextRequest } from 'next/server'

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

import { auth } from '@/auth'
const mockAuth = auth as jest.MockedFunction<typeof auth>

import { proxy, config } from './proxy'

describe('proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('redirects unauthenticated requests to /admin to sign-in', async () => {
    mockAuth.mockResolvedValue(null as never)
    const request = new NextRequest('http://localhost:3000/admin')
    const response = await proxy(request)
    expect(response?.status).toBe(307)
    expect(response?.headers.get('location')).toContain('/api/auth/signin')
  })

  it('returns 401 for unauthenticated requests to /api/admin', async () => {
    mockAuth.mockResolvedValue(null as never)
    const request = new NextRequest('http://localhost:3000/api/admin/test')
    const response = await proxy(request)
    expect(response?.status).toBe(401)
  })

  it('redirects non-admin authenticated requests to sign-in', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'user@example.com', role: 'user' }, expires: '2099-01-01' } as never)
    const request = new NextRequest('http://localhost:3000/admin')
    const response = await proxy(request)
    expect(response?.status).toBe(307)
    expect(response?.headers.get('location')).toContain('/api/auth/signin')
  })

  it('allows admin authenticated requests through', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'admin@example.com', role: 'admin' }, expires: '2099-01-01' } as never)
    const request = new NextRequest('http://localhost:3000/admin')
    const response = await proxy(request)
    expect(response).toBeUndefined()
  })
})

describe('proxy config matcher', () => {
  it('includes /admin paths', () => {
    expect(config.matcher).toContain('/admin/:path*')
  })

  it('includes /api/admin paths', () => {
    expect(config.matcher).toContain('/api/admin/:path*')
  })
})
