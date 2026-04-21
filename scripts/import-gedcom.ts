/**
 * GEDCOM Family Tree Importer
 *
 * Imports family tree data from a GEDCOM file into a Neo4j database.
 * Parses individual and family records, creating Person and Union nodes
 * with UNION and CHILD relationships representing spouse and parent-child connections.
 *
 * Environment variables required:
 * - NEO4J_URI: URL of Neo4j database instance
 * - NEO4J_USER: Neo4j username
 * - NEO4J_PASSWORD: Neo4j password
 *
 * The script clears all existing data before importing to ensure a clean state.
 */

import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'parse-gedcom'
import neo4j from 'neo4j-driver'

// Load .env.local for local dev (no dotenv dependency needed)
const envPath = path.join(__dirname, '../.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2]
  }
}

/**
 * Represents a node in the parsed GEDCOM structure.
 *
 * @interface GedNode
 * @property {string} type - The GEDCOM record type (e.g., 'INDI', 'FAM', 'NAME', 'BIRT')
 * @property {string} [xref_id] - Cross-reference identifier, direct property on INDI/FAM records
 * @property {string} [data] - For pointer records (HUSB/WIFE/CHIL), this IS the pointer string
 * @property {string} [value] - The value associated with this node
 * @property {GedNode[]} children - Child nodes in the GEDCOM hierarchy
 */
interface GedNode {
  type: string
  xref_id?: string
  data?: string
  value?: string
  children: GedNode[]
}

/**
 * Finds the first child node with the specified type.
 */
function findChild(nodes: GedNode[], type: string): GedNode | undefined {
  return nodes.find(n => n.type === type)
}

/**
 * Extracts the value of a child node with the specified type.
 */
function childValue(nodes: GedNode[], type: string): string {
  return findChild(nodes, type)?.value ?? ''
}

/**
 * Main entry point for the GEDCOM import process.
 *
 * @async
 * @returns {Promise<void>}
 * @throws {Error} If database connection fails or Neo4j operations error
 */
async function main() {
  const filePath = path.join(__dirname, '../family-tree.ged')
  const content = fs.readFileSync(filePath, 'utf-8')
  const root = parse(content) as unknown as { type: string; children: GedNode[] }

  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true }
  )
  const session = driver.session()

  try {
    await session.run('MATCH (n) DETACH DELETE n')
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (p:Person) REQUIRE p.gedcomId IS UNIQUE')
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (u:Union) REQUIRE u.gedcomId IS UNIQUE')

    // Batch-build person rows
    const personRows: { gedcomId: string; name: string; sex: string; birthYear: string | null; deathYear: string | null }[] = []
    for (const indi of root.children.filter(r => r.type === 'INDI')) {
      if (!indi.xref_id) {
        console.warn('Skipping INDI record without xref_id')
        continue
      }
      const nameNode = findChild(indi.children, 'NAME')
      const birthNode = findChild(indi.children, 'BIRT')
      const deathNode = findChild(indi.children, 'DEAT')
      const givenName = childValue(nameNode?.children ?? [], 'GIVN')
      const surname = childValue(nameNode?.children ?? [], 'SURN')
      personRows.push({
        gedcomId: indi.xref_id,
        name: [givenName, surname].filter(Boolean).join(' '),
        sex: childValue(indi.children, 'SEX'),
        birthYear: childValue(birthNode?.children ?? [], 'DATE').match(/\d{4}/)?.[0] ?? null,
        deathYear: childValue(deathNode?.children ?? [], 'DATE').match(/\d{4}/)?.[0] ?? null,
      })
    }

    await session.executeWrite(tx =>
      tx.run(
        `UNWIND $rows AS row
         MERGE (p:Person {gedcomId: row.gedcomId})
         SET p.name = row.name,
             p.sex = row.sex,
             p.birthYear = row.birthYear,
             p.deathYear = row.deathYear`,
        { rows: personRows }
      )
    )

    // Batch-build union rows and relationship rows
    const families = root.children.filter(r => r.type === 'FAM')
    const unionRows: { gedcomId: string }[] = []
    const spouseRows: { pid: string; uid: string }[] = []
    const childRows: { pid: string; uid: string }[] = []

    for (const fam of families) {
      if (!fam.xref_id) {
        console.warn('Skipping FAM record without xref_id')
        continue
      }
      const uid = fam.xref_id
      unionRows.push({ gedcomId: uid })
      const husb = findChild(fam.children, 'HUSB')?.data
      const wife = findChild(fam.children, 'WIFE')?.data
      if (husb) spouseRows.push({ pid: husb, uid })
      if (wife) spouseRows.push({ pid: wife, uid })
      for (const chil of fam.children.filter(n => n.type === 'CHIL')) {
        if (chil.data) childRows.push({ pid: chil.data, uid })
      }
    }

    await session.executeWrite(tx =>
      tx.run(
        'UNWIND $rows AS row MERGE (u:Union {gedcomId: row.gedcomId})',
        { rows: unionRows }
      )
    )

    if (spouseRows.length > 0) {
      await session.executeWrite(tx =>
        tx.run(
          `UNWIND $rows AS row
           MATCH (p:Person {gedcomId: row.pid}), (u:Union {gedcomId: row.uid})
           MERGE (p)-[:UNION]->(u)`,
          { rows: spouseRows }
        )
      )
    }

    if (childRows.length > 0) {
      await session.executeWrite(tx =>
        tx.run(
          `UNWIND $rows AS row
           MATCH (p:Person {gedcomId: row.pid}), (u:Union {gedcomId: row.uid})
           MERGE (p)-[:CHILD]->(u)`,
          { rows: childRows }
        )
      )
    }

    const personResult = await session.run('MATCH (p:Person) RETURN count(p) AS n')
    const unionResult = await session.run('MATCH (u:Union) RETURN count(u) AS n')
    const personCount = personResult.records[0].get('n')
    const unionCount = unionResult.records[0].get('n')
    console.log(`Imported ${personCount} people and ${unionCount} unions`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
