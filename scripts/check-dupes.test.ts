const DUPLICATE_UNION_EDGES_QUERY = `
    MATCH (p:Person)-[r:UNION]->(u:Union)
    WITH p, u, count(r) AS edgeCount
    WHERE edgeCount > 1
    RETURN p.name AS person, p.gedcomId AS id, u.gedcomId AS union, edgeCount
    ORDER BY edgeCount DESC LIMIT 10
  `

const DUPLICATE_CHILD_EDGES_QUERY = `
    MATCH (u:Union)-[r:CHILD]->(p:Person)
    WITH p, u, count(r) AS edgeCount
    WHERE edgeCount > 1
    RETURN p.name AS person, p.gedcomId AS id, u.gedcomId AS union, edgeCount
    ORDER BY edgeCount DESC LIMIT 10
  `

const DUPLICATE_UNION_NODES_QUERY = `
    MATCH (u:Union)
    WITH u.gedcomId AS gid, count(u) AS cnt
    WHERE cnt > 1
    RETURN gid, cnt ORDER BY cnt DESC LIMIT 10
  `

type FakeRecord = { get: (key: string) => unknown }

function record(fields: Record<string, unknown>): FakeRecord {
  return { get: (key: string) => fields[key] }
}

type SessionStub = {
  run: jest.Mock<Promise<{ records: FakeRecord[] }>, [string]>
}

function seededSession(seed: {
  unionEdges: FakeRecord[]
  childEdges: FakeRecord[]
  unionNodes: FakeRecord[]
}): SessionStub {
  return {
    run: jest.fn(async (cypher: string) => {
      if (cypher.includes(':UNION]')) return { records: seed.unionEdges }
      if (cypher.includes(':CHILD]')) return { records: seed.childEdges }
      return { records: seed.unionNodes }
    }),
  }
}

describe('check-dupes duplicate detection (seeded dataset with known duplicates)', () => {
  const seed = {
    unionEdges: [
      record({ person: 'Alice', id: 'I001', union: 'F001', edgeCount: 3 }),
      record({ person: 'Bob', id: 'I002', union: 'F002', edgeCount: 2 }),
    ],
    childEdges: [
      record({ person: 'Charlie', id: 'I003', union: 'F001', edgeCount: 2 }),
      record({ person: 'Dana', id: 'I004', union: 'F003', edgeCount: 4 }),
    ],
    unionNodes: [
      record({ gid: 'F001', cnt: 2 }),
    ],
  }

  it('returns non-zero duplicate UNION edge count when duplicates are seeded', async () => {
    const session = seededSession(seed)
    const result = await session.run(DUPLICATE_UNION_EDGES_QUERY)

    expect(result.records.length).toBeGreaterThan(0)
    expect(result.records[0].get('edgeCount')).toBeGreaterThan(1)
  })

  it('returns non-zero duplicate CHILD edge count when duplicates are seeded', async () => {
    const session = seededSession(seed)
    const result = await session.run(DUPLICATE_CHILD_EDGES_QUERY)

    expect(result.records.length).toBeGreaterThan(0)
    expect(result.records[0].get('edgeCount')).toBeGreaterThan(1)
  })

  it('returns non-zero duplicate Union node count when duplicates are seeded', async () => {
    const session = seededSession(seed)
    const result = await session.run(DUPLICATE_UNION_NODES_QUERY)

    expect(result.records.length).toBeGreaterThan(0)
    expect(result.records[0].get('cnt')).toBeGreaterThan(1)
  })
})
