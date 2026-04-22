import neo4j from 'neo4j-driver'
import { loadLocalEnv } from '../src/lib/env'

loadLocalEnv()
const driver = neo4j.driver(process.env.NEO4J_URI!, neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!), { disableLosslessIntegers: true })
const session = driver.session()

async function main() {
  // Find persons with duplicate UNION edges to the same union node
  const r1 = await session.run(`
    MATCH (p:Person)-[r:UNION]->(u:Union)
    WITH p, u, count(r) AS edgeCount
    WHERE edgeCount > 1
    RETURN p.name AS person, p.gedcomId AS id, u.gedcomId AS union, edgeCount
    ORDER BY edgeCount DESC LIMIT 10
  `)
  console.log('Duplicate UNION edges:')
  for (const r of r1.records) console.log(` ${r.get('person')} -> ${r.get('union')}: ${r.get('edgeCount')} edges`)

  // Also check duplicate CHILD edges
  const r2 = await session.run(`
    MATCH (p:Person)-[r:CHILD]->(u:Union)
    WITH p, u, count(r) AS edgeCount
    WHERE edgeCount > 1
    RETURN p.name AS person, p.gedcomId AS id, u.gedcomId AS union, edgeCount
    ORDER BY edgeCount DESC LIMIT 10
  `)
  console.log('\nDuplicate CHILD edges:')
  for (const r of r2.records) console.log(` ${r.get('person')} -> ${r.get('union')}: ${r.get('edgeCount')} edges`)

  // Check duplicate Union nodes with same gedcomId
  const r3 = await session.run(`
    MATCH (u:Union)
    WITH u.gedcomId AS gid, count(u) AS cnt
    WHERE cnt > 1
    RETURN gid, cnt ORDER BY cnt DESC LIMIT 10
  `)
  console.log('\nDuplicate Union nodes (same gedcomId):')
  for (const r of r3.records) console.log(` ${r.get('gid')}: ${r.get('cnt')} nodes`)
}
main().catch(console.error).finally(() => { session.close(); driver.close() })
