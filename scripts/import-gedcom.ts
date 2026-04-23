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
 * Re-import is idempotent: MERGE upserts nodes and relationships so any
 * app-created data (e.g. Suggestion nodes) is preserved across runs.
 */

import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'parse-gedcom'
import neo4j from 'neo4j-driver'
import { loadLocalEnv, validateRequiredEnv } from '../src/lib/env'
import { GEDCOM_TYPES, extractYear } from '../src/lib/gedcom'

loadLocalEnv()

/**
 * Typed metadata attached to a parsed GEDCOM node's `data` property.
 * Fields are optional because not all node types carry all fields.
 *
 * @property {string} [xref_id] - Cross-reference ID present on top-level INDI/FAM records
 * @property {string} [pointer] - Pointer to another record, present on HUSB/WIFE/CHIL nodes
 * @property {string} [formal_name] - Formal name string, used by NOTE nodes
 */
interface GedNodeData {
  xref_id?: string
  pointer?: string
  formal_name?: string
  [key: string]: unknown
}

/**
 * Represents a single node in the parsed GEDCOM tree structure.
 *
 * @property {string} type - GEDCOM tag for this node (e.g. 'INDI', 'FAM', 'NAME', 'BIRT')
 * @property {GedNodeData} [data] - Structured metadata for this node (xref_id, pointer, etc.)
 * @property {string} [value] - Inline text value of the node
 * @property {GedNode[]} children - Subordinate nodes in the GEDCOM hierarchy
 */
interface GedNode {
  type: string
  data?: GedNodeData
  value?: string
  children: GedNode[]
}

/**
 * Finds the first child node with the specified GEDCOM type.
 *
 * @param {GedNode[]} nodes - Array of nodes to search
 * @param {string} type - GEDCOM tag type to find (e.g. 'NAME', 'BIRT', 'DEAT')
 * @returns {GedNode | undefined} The first matching node, or undefined if not found
 */
function findChild(nodes: GedNode[], type: string): GedNode | undefined {
  return nodes.find(n => n.type === type)
}

/**
 * Extracts the value from the first child node matching the specified type.
 *
 * @param {GedNode[]} nodes - Array of nodes to search
 * @param {string} type - GEDCOM tag type to find
 * @returns {string} The node's value, or empty string if not found
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
  validateRequiredEnv(['NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD'])

  const filePath = path.join(__dirname, '../family-tree.ged')
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read GEDCOM input file at ${filePath}: ${(err as Error).message}`)
  }
  const root = parse(content) as unknown as { type: string; children: GedNode[] }

  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true }
  )
  const session = driver.session()

  try {
    await Promise.all([
      session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (p:Person) REQUIRE p.gedcomId IS UNIQUE'),
      session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (u:Union) REQUIRE u.gedcomId IS UNIQUE'),
    ])

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
      const composedName = [givenName, surname].filter(Boolean).join(' ')
      const rawNameFallback = (nameNode?.value ?? '').replace(/\//g, '').trim()
      const name = composedName || rawNameFallback || '[Unknown]'
      personRows.push({
        gedcomId: indi.data.xref_id,
        name,
        sex: childValue(indi.children, GEDCOM_TYPES.SEX),
        birthYear: extractYear(childValue(birthNode?.children ?? [], GEDCOM_TYPES.DATE)),
        deathYear: extractYear(childValue(deathNode?.children ?? [], GEDCOM_TYPES.DATE)),
        birthPlace,
        deathPlace,
        occupation,
        notes,
      })
    }

    await session.executeWrite(async tx => {
      await tx.run(
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
    })

    const families = root.children.filter(r => r.type === GEDCOM_TYPES.FAMILY)
    const unionRows: { gedcomId: string; marriageYear: string | null; marriagePlace: string | null }[] = []
    const spouseRows: { pid: string; uid: string }[] = []
    const childRows: { pid: string; uid: string }[] = []

    for (const fam of families) {
      if (!fam.data?.xref_id) {
        console.warn('Skipping FAM record without xref_id')
        continue
      }
      const uid = fam.data.xref_id
      const marrNode = findChild(fam.children, GEDCOM_TYPES.MARRIAGE)
      const marriageYear = extractYear(childValue(marrNode?.children ?? [], GEDCOM_TYPES.DATE))
      const marriagePlace = childValue(marrNode?.children ?? [], GEDCOM_TYPES.PLACE) || null
      unionRows.push({ gedcomId: uid, marriageYear, marriagePlace })
      const husb = findChild(fam.children, GEDCOM_TYPES.HUSB)?.data?.pointer
      const wife = findChild(fam.children, GEDCOM_TYPES.WIFE)?.data?.pointer
      if (husb) spouseRows.push({ pid: husb, uid })
      if (wife) spouseRows.push({ pid: wife, uid })
      for (const chil of fam.children.filter(n => n.type === GEDCOM_TYPES.CHIL)) {
        if (chil.data?.pointer) childRows.push({ pid: chil.data.pointer, uid })
      }
    }

    await session.executeWrite(tx =>
      tx.run(
        `UNWIND $rows AS row
         MERGE (u:Union {gedcomId: row.gedcomId})
         SET u.marriageYear = row.marriageYear,
             u.marriagePlace = row.marriagePlace`,
        { rows: unionRows }
      )
    )

    await session.executeWrite(tx =>
      tx.run(
        `UNWIND $rows AS row
         MATCH (p:Person {gedcomId: row.pid}), (u:Union {gedcomId: row.uid})
         MERGE (p)-[:UNION]->(u)`,
        { rows: spouseRows }
      )
    )

    await session.executeWrite(tx =>
      tx.run(
        `UNWIND $rows AS row
         MATCH (p:Person {gedcomId: row.pid}), (u:Union {gedcomId: row.uid})
         MERGE (p)-[:CHILD]->(u)`,
        { rows: childRows }
      )
    )

    console.log(`Imported ${personRows.length} people and ${unionRows.length} unions`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
