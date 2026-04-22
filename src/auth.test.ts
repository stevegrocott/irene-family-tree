import { jwtCallback, sessionCallback } from './auth'

describe('jwtCallback', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('sets token.role to admin when email is in ADMIN_EMAILS on google sign-in', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com,other@example.com'
    const token = await jwtCallback({
      token: {},
      user: { id: '1', email: 'admin@example.com' },
      account: { provider: 'google', type: 'oauth', providerAccountId: '123' },
    })
    expect(token.role).toBe('admin')
  })

  it('sets token.role to user when email is not in ADMIN_EMAILS on google sign-in', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com'
    const token = await jwtCallback({
      token: {},
      user: { id: '1', email: 'regular@example.com' },
      account: { provider: 'google', type: 'oauth', providerAccountId: '123' },
    })
    expect(token.role).toBe('user')
  })

  it('defaults to user role when ADMIN_EMAILS is not set', async () => {
    delete process.env.ADMIN_EMAILS
    const token = await jwtCallback({
      token: {},
      user: { id: '1', email: 'someone@example.com' },
      account: { provider: 'google', type: 'oauth', providerAccountId: '123' },
    })
    expect(token.role).toBe('user')
  })

  it('does not override role on subsequent requests (no account)', async () => {
    const token = await jwtCallback({
      token: { role: 'admin' },
      user: undefined as never,
      account: null,
    })
    expect(token.role).toBe('admin')
  })
})

describe('sessionCallback', () => {
  it('exposes token.role as session.user.role', async () => {
    const session = await sessionCallback({
      session: { user: { name: 'Test', email: 'test@example.com', image: null }, expires: '2099-01-01' } as never,
      token: { role: 'admin', sub: '1' },
    })
    expect(session.user.role).toBe('admin')
  })

  it('exposes user role when role is user', async () => {
    const session = await sessionCallback({
      session: { user: { name: 'Test', email: 'test@example.com', image: null }, expires: '2099-01-01' } as never,
      token: { role: 'user', sub: '1' },
    })
    expect(session.user.role).toBe('user')
  })
})
