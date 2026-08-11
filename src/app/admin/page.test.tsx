import type { Session } from 'next-auth'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}))

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

import { auth } from '@/auth'
const mockAuth = auth as unknown as jest.MockedFunction<() => Promise<Session | null>>

import AdminPage from './page'

const ADMIN_SESSION = { user: { email: 'admin@example.com', name: 'Admin', role: 'admin' } }

describe('AdminPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('executes the pending-changes query with the SKIP/LIMIT params cast to integer', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never)
    mockRead.mockResolvedValue([])

    await AdminPage()

    expect(mockRead).toHaveBeenCalledWith(
      expect.stringContaining('SKIP toInteger($skip) LIMIT toInteger($limit)'),
      { skip: 0, limit: 20 }
    )
  })
})
