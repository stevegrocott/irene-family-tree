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

/**
 * GEDCOM record and field type constants used for parsing family tree data.
 * Maps human-readable names to their GEDCOM abbreviations.
 */
const GEDCOM_TYPES = {
  INDIVIDUAL: 'INDI',
  FAMILY: 'FAM',
  NAME: 'NAME',
  BIRTH: 'BIRT',
  DEATH: 'DEAT',
  SEX: 'SEX',
  DATE: 'DATE',
  GIVEN_NAME: 'GIVN',
  SURNAME: 'SURN',
  HUSBAND: 'HUSB',
  WIFE: 'WIFE',
  CHILD: 'CHIL',
  PLACE: 'PLAC',
  OCCUPATION: 'OCCU',
  NOTE: 'NOTE',
  MARRIAGE: 'MARR',
}

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
interface GedNodeData {
  xref_id?: string
  pointer?: string
  formal_name?: string
  [key: string]: unknown
}

interface GedNode {
  type: string
  data?: GedNodeData
  value?: string
  children: GedNode[]
}

/**
 * Finds the first child node with the specified type.
 *
 * @param {GedNode[]} nodes - Array of GEDCOM nodes to search
 * @param {string} type - GEDCOM record type to find (e.g., 'NAME', 'BIRT')
 * @returns {GedNode | undefined} The first node matching the type, or undefined if not found
 */
function findChild(nodes: GedNode[], type: string): GedNode | undefined {
  return nodes.find(n => n.type === type)
}

/**
 * Extracts the value of a child node with the specified type.
 * Returns an empty string if the node or its value is not found.
 *
 * @param {GedNode[]} nodes - Array of GEDCOM nodes to search
 * @param {string} type - GEDCOM record type to find (e.g., 'NAME', 'BIRT')
 * @returns {string} The value of the matching node, or empty string if not found
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
    const personRows: {
      gedcomId: string
      name: string
      sex: string
      birthYear: string | null
      deathYear: string | null
      birthPlace: string | null
      deathPlace: string | null
      occupation: string | null
      notes: string | null
    }[] = []
    for (const indi of root.children.filter(r => r.type === GEDCOM_TYPES.INDIVIDUAL)) {
      if (!indi.data?.xref_id) {
        console.warn('Skipping INDI record without xref_id')
        continue
      }
      const nameNode = findChild(indi.children, GEDCOM_TYPES.NAME)
      const birthNode = findChild(indi.children, GEDCOM_TYPES.BIRTH)
      const deathNode = findChild(indi.children, GEDCOM_TYPES.DEATH)
      const givenName = childValue(nameNode?.children ?? [], GEDCOM_TYPES.GIVEN_NAME)
      const surname = childValue(nameNode?.children ?? [], GEDCOM_TYPES.SURNAME)
      const birthPlace = childValue(birthNode?.children ?? [], GEDCOM_TYPES.PLACE) || null
      const deathPlace = childValue(deathNode?.children ?? [], GEDCOM_TYPES.PLACE) || null
      const occupation = childValue(indi.children, GEDCOM_TYPES.OCCUPATION) || null
      const noteNode = findChild(indi.children, GEDCOM_TYPES.NOTE)
      const notes = (noteNode?.value ?? noteNode?.data?.formal_name ?? null) as string | null
      personRows.push({
        gedcomId: indi.data.xref_id,
        name: [givenName, surname].filter(Boolean).join(' '),
        sex: childValue(indi.children, GEDCOM_TYPES.SEX),
        birthYear: childValue(birthNode?.children ?? [], GEDCOM_TYPES.DATE).match(/\d{4}/)?.[0] ?? null,
        deathYear: childValue(deathNode?.children ?? [], GEDCOM_TYPES.DATE).match(/\d{4}/)?.[0] ?? null,
        birthPlace,
        deathPlace,
        occupation,
        notes,
      })
    }

    await session.executeWrite(tx =>
      tx.run(
        `UNWIND $rows AS row
         MERGE (p:Person {gedcomId: row.gedcomId})
         SET p.name = row.name,
             p.sex = row.sex,
             p.birthYear = row.birthYear,
             p.deathYear = row.deathYear,
             p.birthPlace = row.birthPlace,
             p.deathPlace = row.deathPlace,
             p.occupation = row.occupation,
             p.notes = row.notes`,
        { rows: personRows }
      )
    )

    // Batch-build union rows and relationship rows
    const families = root.children.filter(r => r.type === GEDCOM_TYPES.FAMILY)
    const unionRows: { gedcomId: string; marriageDate: string | null; marriagePlace: string | null }[] = []
    const spouseRows: { pid: string; uid: string }[] = []
    const childRows: { pid: string; uid: string }[] = []

    for (const fam of families) {
      if (!fam.data?.xref_id) {
        console.warn('Skipping FAM record without xref_id')
        continue
      }
      const uid = fam.data.xref_id
      const marrNode = findChild(fam.children, GEDCOM_TYPES.MARRIAGE)
      const marriageDate = childValue(marrNode?.children ?? [], GEDCOM_TYPES.DATE) || null
      const marriagePlace = childValue(marrNode?.children ?? [], GEDCOM_TYPES.PLACE) || null
      unionRows.push({ gedcomId: uid, marriageDate, marriagePlace })
      const husb = findChild(fam.children, GEDCOM_TYPES.HUSBAND)?.data?.pointer
      const wife = findChild(fam.children, GEDCOM_TYPES.WIFE)?.data?.pointer
      if (husb) spouseRows.push({ pid: husb, uid })
      if (wife) spouseRows.push({ pid: wife, uid })
      for (const chil of fam.children.filter(n => n.type === GEDCOM_TYPES.CHILD)) {
        if (chil.data?.pointer) childRows.push({ pid: chil.data.pointer, uid })
      }
    }

    await session.executeWrite(tx =>
      tx.run(
        `UNWIND $rows AS row
         MERGE (u:Union {gedcomId: row.gedcomId})
         SET u.marriageDate = row.marriageDate,
             u.marriagePlace = row.marriagePlace`,
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
