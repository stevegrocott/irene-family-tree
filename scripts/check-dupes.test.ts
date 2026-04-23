import {
  DUPLICATE_CHILD_EDGES_QUERY,
  DUPLICATE_UNION_EDGES_QUERY,
  DUPLICATE_UNION_NODES_QUERY,
  findDuplicates,
  type QueryableSession,
} from './check-dupes'

type FakeRecord = { get: (key: string) => unknown }

function record(fields: Record<string, unknown>): FakeRecord {
  return { get: (key: string) => fields[key] }
}

function seededSession(seed: {
  unionEdges: FakeRecord[]
  childEdges: FakeRecord[]
  unionNodes: FakeRecord[]
}): QueryableSession {
  return {
    run: jest.fn(async (cypher: string) => {
      if (cypher === DUPLICATE_UNION_EDGES_QUERY) return { records: seed.unionEdges }
      if (cypher === DUPLICATE_CHILD_EDGES_QUERY) return { records: seed.childEdges }
      if (cypher === DUPLICATE_UNION_NODES_QUERY) return { records: seed.unionNodes }
      return { records: [] }
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

  it('exports CHILD edge query using canonical direction (u:Union)-[:CHILD]->(p:Person)', () => {
    expect(DUPLICATE_CHILD_EDGES_QUERY).toContain('(u:Union)-[r:CHILD]->(p:Person)')
  })

  it('findDuplicates returns non-zero duplicate UNION edge count when duplicates are seeded', async () => {
    const session = seededSession(seed)
    const result = await findDuplicates(session)

    expect(result.unionEdges.length).toBeGreaterThan(0)
    expect(result.unionEdges[0].get('edgeCount')).toBeGreaterThan(1)
  })

  it('findDuplicates returns non-zero duplicate CHILD edge count when duplicates are seeded', async () => {
    const session = seededSession(seed)
    const result = await findDuplicates(session)

    expect(result.childEdges.length).toBeGreaterThan(0)
    expect(result.childEdges[0].get('edgeCount')).toBeGreaterThan(1)
  })

  it('findDuplicates returns non-zero duplicate Union node count when duplicates are seeded', async () => {
    const session = seededSession(seed)
    const result = await findDuplicates(session)

    expect(result.unionNodes.length).toBeGreaterThan(0)
    expect(result.unionNodes[0].get('cnt')).toBeGreaterThan(1)
  })
})
