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
const mockAuth = auth as unknown as jest.MockedFunction<() => Promise<unknown>>

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
    mockAuth.mockResolvedValue({ user: { name: 'Anon' } })

    const response = await GET(makeRequest(), makeParams('I001'))

    expect(response.status).toBe(401)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('returns empty result when the user has no changes for this person', async () => {
    mockAuth.mockResolvedValue(USER_SESSION)
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
    mockAuth.mockResolvedValue(USER_SESSION)
    mockRead.mockResolvedValueOnce([])
    mockRead.mockResolvedValueOnce([])

    await GET(makeRequest(), makeParams('I001'))

    // Second call is the changes query
    const secondCall = mockRead.mock.calls[1]
    expect(secondCall[0]).toMatch(/status:\s*'live'/)
    expect(secondCall[0]).toMatch(/toLower\(c\.authorEmail\)\s*=\s*toLower\(\$email\)/)
    expect(secondCall[1]).toEqual(
      expect.objectContaining({ email: 'user@example.com', id: 'I001' })
    )
  })

  it('splits changes by changeType into the correct categories', async () => {
    mockAuth.mockResolvedValue(USER_SESSION)
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
    mockAuth.mockResolvedValue(USER_SESSION)
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

  // Issue #308. Every other test here stubs the union rows, so none of them can tell
  // whether the query would actually have returned a parent union — which is exactly
  // how the bug survived: the client matched connections by union id against a set
  // that never contained a parent union, so every parent read as foreign and delete
  // stayed permanently disabled. Asserting on the query text is the only way to pin
  // this at the unit level.
  it('collects parent unions as well as spouse unions', async () => {
    mockAuth.mockResolvedValue(USER_SESSION)
    mockRead.mockResolvedValueOnce([])
    mockRead.mockResolvedValueOnce([])

    await GET(makeRequest(), makeParams('I001'))

    const unionQuery = mockRead.mock.calls[0][0] as string
    // Spouse unions: the person points at the union.
    expect(unionQuery).toMatch(/\(p:Person \{gedcomId: \$id\}\)-\[:UNION\]->\(/)
    // Parent unions: the parents' union points at the person as a child.
    expect(unionQuery).toMatch(/\(p:Person \{gedcomId: \$id\}\)<-\[:CHILD\]-\(/)
  })

  it('keeps an ADD_RELATIONSHIP change against a parent union', async () => {
    mockAuth.mockResolvedValue(USER_SESSION)
    // 'UPARENT' is the union the person hangs off as a child; 'U100' is their marriage.
    mockRead.mockResolvedValueOnce([{ unionId: 'U100' }, { unionId: 'UPARENT' }])
    mockRead.mockResolvedValueOnce([
      {
        id: 'c-rel-parent',
        changeType: 'ADD_RELATIONSHIP',
        targetId: 'I001',
        newValue: JSON.stringify({ unionId: 'UPARENT', type: 'parent' }),
        previousValue: null,
        appliedAt: '2026-04-21T10:00:00Z',
      },
    ])

    const response = await GET(makeRequest(), makeParams('I001'))
    const body = await response.json()

    expect(body.relationshipChanges).toHaveLength(1)
    expect(body.relationshipChanges[0].id).toBe('c-rel-parent')
  })

  it('returns updateChanges in newest-first order', async () => {
    mockAuth.mockResolvedValue(USER_SESSION)
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
    mockAuth.mockResolvedValue(USER_SESSION)
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

  it('returns createChange when session email case differs from stored author email', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'USER@EXAMPLE.COM', name: 'User', role: 'user' } })
    mockRead.mockResolvedValueOnce([])
    mockRead.mockResolvedValueOnce([
      {
        id: 'c-create-case',
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
    expect(body.createChange).not.toBeNull()
    expect(body.createChange.id).toBe('c-create-case')
    // Cypher must use toLower on both sides for case-insensitive email matching
    const changeQueryCypher = mockRead.mock.calls[1][0] as string
    expect(changeQueryCypher).toMatch(/toLower\(c\.authorEmail\)\s*=\s*toLower\(\$email\)/)
  })

  it('returns only the newest when multiple CREATE_PERSON rows exist', async () => {
    mockAuth.mockResolvedValue(USER_SESSION)
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
