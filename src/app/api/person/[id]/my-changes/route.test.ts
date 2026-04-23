import { GET } from './route'

jest.mock('@/lib/neo4j', () => ({
  read: jest.fn(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

import { read } from '@/lib/neo4j'
const mockRead = read as jest.MockedFunction<typeof read>

import { auth } from '@/auth'
const mockAuth = auth as jest.MockedFunction<typeof auth>

const USER_SESSION = {
  user: { email: 'user@example.com', name: 'User', role: 'user' },
}

const makeRequest = () =>
  new Request('http://localhost/api/person/I001/my-changes')

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/person/[id]/my-changes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('returns 401 when session has no email', async () => {
    mockAuth.mockResolvedValue({ user: { name: 'Anon' } } as never)

    const response = await GET(makeRequest(), makeParams('I001'))

    expect(response.status).toBe(401)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('returns empty result when the user has no changes for this person', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    // First read: unions. Second read: changes.
    mockRead.mockResolvedValueOnce([])
    mockRead.mockResolvedValueOnce([])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      createChange: null,
      relationshipChanges: [],
      updateChanges: [],
    })
  })

  it('filters by authorEmail and status=live in the change query', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    mockRead.mockResolvedValueOnce([])
    mockRead.mockResolvedValueOnce([])

    await GET(makeRequest(), makeParams('I001'))

    // Second call is the changes query
    const secondCall = mockRead.mock.calls[1]
    expect(secondCall[0]).toMatch(/status:\s*'live'/)
    expect(secondCall[0]).toMatch(/authorEmail:\s*\$email/)
    expect(secondCall[1]).toEqual(
      expect.objectContaining({ email: 'user@example.com', id: 'I001' })
    )
  })

  it('splits changes by changeType into the correct categories', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    // Person has one union U100
    mockRead.mockResolvedValueOnce([{ unionId: 'U100' }])
    // Three rows: one of each type
    mockRead.mockResolvedValueOnce([
      {
        id: 'c-update',
        changeType: 'UPDATE_PERSON',
        targetId: 'I001',
        newValue: JSON.stringify({ name: 'New Name' }),
        previousValue: JSON.stringify({ name: 'Old Name' }),
        appliedAt: '2026-04-22T10:00:00Z',
      },
      {
        id: 'c-rel',
        changeType: 'ADD_RELATIONSHIP',
        targetId: 'I001',
        newValue: JSON.stringify({ unionId: 'U100', type: 'spouse' }),
        previousValue: null,
        appliedAt: '2026-04-21T10:00:00Z',
      },
      {
        id: 'c-create',
        changeType: 'CREATE_PERSON',
        targetId: 'I001',
        newValue: JSON.stringify({ name: 'X', sex: 'M' }),
        previousValue: null,
        appliedAt: '2026-04-20T10:00:00Z',
      },
    ])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.createChange).toEqual({
      id: 'c-create',
      changeType: 'CREATE_PERSON',
      targetId: 'I001',
      newValue: { name: 'X', sex: 'M' },
      previousValue: null,
      appliedAt: '2026-04-20T10:00:00Z',
    })
    expect(body.relationshipChanges).toEqual([
      {
        id: 'c-rel',
        changeType: 'ADD_RELATIONSHIP',
        targetId: 'I001',
        newValue: { unionId: 'U100', type: 'spouse' },
        previousValue: null,
        appliedAt: '2026-04-21T10:00:00Z',
      },
    ])
    expect(body.updateChanges).toEqual([
      {
        id: 'c-update',
        changeType: 'UPDATE_PERSON',
        targetId: 'I001',
        newValue: { name: 'New Name' },
        previousValue: { name: 'Old Name' },
        appliedAt: '2026-04-22T10:00:00Z',
      },
    ])
  })

  it('filters out ADD_RELATIONSHIP rows whose unionId is not in this person\'s unions', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    mockRead.mockResolvedValueOnce([{ unionId: 'U100' }])
    mockRead.mockResolvedValueOnce([
      {
        id: 'c-rel-in',
        changeType: 'ADD_RELATIONSHIP',
        targetId: 'I001',
        newValue: JSON.stringify({ unionId: 'U100' }),
        previousValue: null,
        appliedAt: '2026-04-21T10:00:00Z',
      },
      {
        id: 'c-rel-out',
        changeType: 'ADD_RELATIONSHIP',
        targetId: 'I002',
        newValue: JSON.stringify({ unionId: 'U999' }),
        previousValue: null,
        appliedAt: '2026-04-20T10:00:00Z',
      },
    ])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.relationshipChanges).toHaveLength(1)
    expect(body.relationshipChanges[0].id).toBe('c-rel-in')
  })

  it('returns updateChanges in newest-first order', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    mockRead.mockResolvedValueOnce([])
    mockRead.mockResolvedValueOnce([
      {
        id: 'c-update-new',
        changeType: 'UPDATE_PERSON',
        targetId: 'I001',
        newValue: JSON.stringify({ name: 'Newer' }),
        previousValue: null,
        appliedAt: '2026-04-22T10:00:00Z',
      },
      {
        id: 'c-update-old',
        changeType: 'UPDATE_PERSON',
        targetId: 'I001',
        newValue: JSON.stringify({ name: 'Older' }),
        previousValue: null,
        appliedAt: '2026-04-20T10:00:00Z',
      },
    ])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.updateChanges.map((c: { id: string }) => c.id)).toEqual([
      'c-update-new',
      'c-update-old',
    ])
  })

  it('does not crash on malformed JSON in newValue; returns newValue: {}', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    mockRead.mockResolvedValueOnce([])
    mockRead.mockResolvedValueOnce([
      {
        id: 'c-bad',
        changeType: 'UPDATE_PERSON',
        targetId: 'I001',
        newValue: '{not valid json',
        previousValue: null,
        appliedAt: '2026-04-22T10:00:00Z',
      },
    ])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.updateChanges).toHaveLength(1)
    expect(body.updateChanges[0].newValue).toEqual({})
  })

  it('returns only the newest when multiple CREATE_PERSON rows exist', async () => {
    mockAuth.mockResolvedValue(USER_SESSION as never)
    mockRead.mockResolvedValueOnce([])
    // Rows come back ordered newest-first by the Cypher ORDER BY
    mockRead.mockResolvedValueOnce([
      {
        id: 'c-create-new',
        changeType: 'CREATE_PERSON',
        targetId: 'I001',
        newValue: JSON.stringify({ name: 'Newer' }),
        previousValue: null,
        appliedAt: '2026-04-22T10:00:00Z',
      },
      {
        id: 'c-create-old',
        changeType: 'CREATE_PERSON',
        targetId: 'I001',
        newValue: JSON.stringify({ name: 'Older' }),
        previousValue: null,
        appliedAt: '2026-04-20T10:00:00Z',
      },
    ])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.createChange).not.toBeNull()
    expect(body.createChange.id).toBe('c-create-new')
  })
})
