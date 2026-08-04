import { jwtCallback, sessionCallback } from './auth'

type JwtCallbackArgs = Parameters<typeof jwtCallback>[0]
type SessionCallbackArgs = Parameters<typeof sessionCallback>[0]

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
    const args: JwtCallbackArgs = {
      token: {},
      user: { id: '1', email: 'admin@example.com' },
      account: { provider: 'google', type: 'oauth', providerAccountId: '123' },
    }
    const token = await jwtCallback(args)
    expect(token.role).toBe('admin')
  })

  it('sets token.role to user when email is not in ADMIN_EMAILS on google sign-in', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com'
    const args: JwtCallbackArgs = {
      token: {},
      user: { id: '1', email: 'regular@example.com' },
      account: { provider: 'google', type: 'oauth', providerAccountId: '123' },
    }
    const token = await jwtCallback(args)
    expect(token.role).toBe('user')
  })

  it('defaults to user role when ADMIN_EMAILS is not set', async () => {
    delete process.env.ADMIN_EMAILS
    const args: JwtCallbackArgs = {
      token: {},
      user: { id: '1', email: 'someone@example.com' },
      account: { provider: 'google', type: 'oauth', providerAccountId: '123' },
    }
    const token = await jwtCallback(args)
    expect(token.role).toBe('user')
  })

  it('does not override role on subsequent requests (no account)', async () => {
    // `user` is absent on non-sign-in jwt calls even though the upstream type marks it required.
    const args = { token: { role: 'admin' }, account: null } as JwtCallbackArgs
    const token = await jwtCallback(args)
    expect(token.role).toBe('admin')
  })
})

describe('sessionCallback', () => {
  it('exposes token.role as session.user.role', async () => {
    // Upstream param type also demands database-strategy-only fields (`user`, `newSession`)
    // that never apply to this jwt-strategy config, so the jwt-strategy shape is asserted.
    const args = {
      session: { user: { name: 'Test', email: 'test@example.com', image: null }, expires: '2099-01-01' },
      token: { role: 'admin', sub: '1' },
    } as SessionCallbackArgs
    const session = await sessionCallback(args)
    expect(session.user.role).toBe('admin')
  })

  it('exposes user role when role is user', async () => {
    const args = {
      session: { user: { name: 'Test', email: 'test@example.com', image: null }, expires: '2099-01-01' },
      token: { role: 'user', sub: '1' },
    } as SessionCallbackArgs
    const session = await sessionCallback(args)
    expect(session.user.role).toBe('user')
  })
})
