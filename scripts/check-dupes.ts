import neo4j from 'neo4j-driver'
import { loadLocalEnv } from '../src/lib/env'

export const DUPLICATE_UNION_EDGES_QUERY = `
    MATCH (p:Person)-[r:UNION]->(u:Union)
    WITH p, u, count(r) AS edgeCount
    WHERE edgeCount > 1
    RETURN p.name AS person, p.gedcomId AS id, u.gedcomId AS union, edgeCount
    ORDER BY edgeCount DESC LIMIT 10
  `

export const DUPLICATE_CHILD_EDGES_QUERY = `
    MATCH (u:Union)-[r:CHILD]->(p:Person)
    WITH p, u, count(r) AS edgeCount
    WHERE edgeCount > 1
    RETURN p.name AS person, p.gedcomId AS id, u.gedcomId AS union, edgeCount
    ORDER BY edgeCount DESC LIMIT 10
  `

export const DUPLICATE_UNION_NODES_QUERY = `
    MATCH (u:Union)
    WITH u.gedcomId AS gid, count(u) AS cnt
    WHERE cnt > 1
    RETURN gid, cnt ORDER BY cnt DESC LIMIT 10
  `

export type QueryableSession = {
  run(cypher: string): Promise<{ records: Array<{ get(key: string): unknown }> }>
}

export async function findDuplicates(session: QueryableSession) {
  const [unionEdgesResult, childEdgesResult, unionNodesResult] = await Promise.all([
    session.run(DUPLICATE_UNION_EDGES_QUERY),
    session.run(DUPLICATE_CHILD_EDGES_QUERY),
    session.run(DUPLICATE_UNION_NODES_QUERY),
  ])
  return {
    unionEdges: unionEdgesResult.records,
    childEdges: childEdgesResult.records,
    unionNodes: unionNodesResult.records,
  }
}

async function main() {
  loadLocalEnv()
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true }
  )
  const session = driver.session()
  try {
    const { unionEdges, childEdges, unionNodes } = await findDuplicates(session)
    console.log('Duplicate UNION edges:')
    for (const r of unionEdges) console.log(` ${r.get('person')} -> ${r.get('union')}: ${r.get('edgeCount')} edges`)
    console.log('\nDuplicate CHILD edges:')
    for (const r of childEdges) console.log(` ${r.get('person')} -> ${r.get('union')}: ${r.get('edgeCount')} edges`)
    console.log('\nDuplicate Union nodes (same gedcomId):')
    for (const r of unionNodes) console.log(` ${r.get('gid')}: ${r.get('cnt')} nodes`)
  } finally {
    await session.close()
    await driver.close()
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
