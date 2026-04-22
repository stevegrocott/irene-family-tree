/**
 * GEDCOM Family Tree Exporter
 *
 * Exports family tree data from Neo4j to a GEDCOM 5.5.1 file.
 * Queries Person and Union nodes, serialises to INDI and FAM records,
 * and writes the result to family-tree.ged.
 *
 * Environment variables required:
 * - NEO4J_URI: URL of Neo4j database instance
 * - NEO4J_USER: Neo4j username
 * - NEO4J_PASSWORD: Neo4j password
 */

import * as fs from 'fs'
import * as path from 'path'
import neo4j from 'neo4j-driver'

// Load .env.local for local dev (no dotenv dependency needed)
const envPath = path.join(__dirname, '../.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2]
  }
}

interface PersonNode {
  gedcomId: string
  name: string
  sex: string
  birthYear: string | null
  deathYear: string | null
  birthPlace: string | null
  deathPlace: string | null
  occupation: string | null
  notes: string | null
}

interface UnionNode {
  gedcomId: string
  marriageYear: string | null
  marriagePlace: string | null
}

interface SpouseRel {
  personId: string
  unionId: string
}

interface ChildRel {
  personId: string
  unionId: string
}

/**
 * Escapes @ signs in GEDCOM text values.
 * In GEDCOM 5.5.1, a bare @ in a value field must be written as @@.
 * This function is only called for plain text fields, never for pointer IDs.
 */
function escapeGedcomValue(value: string): string {
  return value.replace(/@/g, '@@')
}

/**
 * Builds a GEDCOM INDI record string for a single person.
 */
function buildIndiRecord(person: PersonNode): string {
  const lines: string[] = []

  lines.push(`0 ${person.gedcomId} INDI`)

  // NAME record: reconstruct "Given /Surname/" format
  const isUnknown = !person.name || person.name === '[Unknown]'
  if (isUnknown) {
    lines.push('1 NAME [Unknown]')
  } else {
    const parts = person.name.trim().split(' ')
    const surname = parts.length > 1 ? parts[parts.length - 1] : ''
    const givenName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]
    const gedcomName = surname
      ? `${escapeGedcomValue(givenName)} /${escapeGedcomValue(surname)}/`
      : escapeGedcomValue(givenName)
    lines.push(`1 NAME ${gedcomName}`)
    if (givenName) lines.push(`2 GIVN ${escapeGedcomValue(givenName)}`)
    if (surname) lines.push(`2 SURN ${escapeGedcomValue(surname)}`)
  }

  // SEX
  if (person.sex) {
    lines.push(`1 SEX ${person.sex}`)
  }

  // BIRT
  if (person.birthYear || person.birthPlace) {
    lines.push('1 BIRT')
    if (person.birthYear) lines.push(`2 DATE ${person.birthYear}`)
    if (person.birthPlace) lines.push(`2 PLAC ${escapeGedcomValue(person.birthPlace)}`)
  }

  // DEAT
  if (person.deathYear || person.deathPlace) {
    lines.push('1 DEAT')
    if (person.deathYear) lines.push(`2 DATE ${person.deathYear}`)
    if (person.deathPlace) lines.push(`2 PLAC ${escapeGedcomValue(person.deathPlace)}`)
  }

  // OCCU
  if (person.occupation) {
    lines.push(`1 OCCU ${escapeGedcomValue(person.occupation)}`)
  }

  // NOTE
  if (person.notes) {
    lines.push(`1 NOTE ${escapeGedcomValue(person.notes)}`)
  }

  return lines.join('\n')
}

/**
 * Builds a GEDCOM FAM record string for a single union.
 * Spouse roles (HUSB/WIFE) are inferred from the Person's sex field.
 */
function buildFamRecord(
  union: UnionNode,
  spouses: SpouseRel[],
  children: ChildRel[],
  personSexMap: Map<string, string>
): string {
  const lines: string[] = []

  lines.push(`0 ${union.gedcomId} FAM`)

  // Determine husband and wife from sex; fall back to insertion order
  const unionSpouses = spouses.filter(s => s.unionId === union.gedcomId)
  let husb: string | null = null
  let wife: string | null = null
  const unassigned: string[] = []

  for (const s of unionSpouses) {
    const sex = personSexMap.get(s.personId) ?? ''
    if (sex === 'M' && husb === null) {
      husb = s.personId
    } else if (sex === 'F' && wife === null) {
      wife = s.personId
    } else {
      unassigned.push(s.personId)
    }
  }

  // Assign any remaining spouses whose sex did not match
  for (const pid of unassigned) {
    if (husb === null) husb = pid
    else if (wife === null) wife = pid
  }

  if (husb !== null) lines.push(`1 HUSB ${husb}`)
  if (wife !== null) lines.push(`1 WIFE ${wife}`)

  // CHIL records
  const unionChildren = children.filter(c => c.unionId === union.gedcomId)
  for (const c of unionChildren) {
    lines.push(`1 CHIL ${c.personId}`)
  }

  // MARR
  if (union.marriageYear || union.marriagePlace) {
    lines.push('1 MARR')
    if (union.marriageYear) lines.push(`2 DATE ${union.marriageYear}`)
    if (union.marriagePlace) {
      lines.push(`2 PLAC ${escapeGedcomValue(union.marriagePlace)}`)
    }
  }

  return lines.join('\n')
}

async function main() {
  const missingEnv = ['NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD'].filter(
    k => !process.env[k]
  )
  if (missingEnv.length) {
    throw new Error(
      `Missing required environment variables: ${missingEnv.join(', ')}`
    )
  }

  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true }
  )
  const session = driver.session()

  try {
    // Query all Person nodes
    const personResult = await session.run(
      `MATCH (p:Person)
       RETURN p.gedcomId   AS gedcomId,
              p.name       AS name,
              p.sex        AS sex,
              p.birthYear  AS birthYear,
              p.deathYear  AS deathYear,
              p.birthPlace AS birthPlace,
              p.deathPlace AS deathPlace,
              p.occupation AS occupation,
              p.notes      AS notes
       ORDER BY p.gedcomId`
    )

    const persons: PersonNode[] = personResult.records.map(r => ({
      gedcomId: r.get('gedcomId') as string,
      name: (r.get('name') as string | null) ?? '[Unknown]',
      sex: (r.get('sex') as string | null) ?? '',
      birthYear: r.get('birthYear') as string | null,
      deathYear: r.get('deathYear') as string | null,
      birthPlace: r.get('birthPlace') as string | null,
      deathPlace: r.get('deathPlace') as string | null,
      occupation: r.get('occupation') as string | null,
      notes: r.get('notes') as string | null,
    }))

    // Query all Union nodes
    const unionResult = await session.run(
      `MATCH (u:Union)
       RETURN u.gedcomId      AS gedcomId,
              u.marriageYear  AS marriageYear,
              u.marriagePlace AS marriagePlace
       ORDER BY u.gedcomId`
    )

    const unions: UnionNode[] = unionResult.records.map(r => ({
      gedcomId: r.get('gedcomId') as string,
      marriageYear: r.get('marriageYear') as string | null,
      marriagePlace: r.get('marriagePlace') as string | null,
    }))

    // Query spouse (UNION) relationships
    const spouseResult = await session.run(
      `MATCH (p:Person)-[:UNION]->(u:Union)
       RETURN p.gedcomId AS personId, u.gedcomId AS unionId`
    )

    const spouses: SpouseRel[] = spouseResult.records.map(r => ({
      personId: r.get('personId') as string,
      unionId: r.get('unionId') as string,
    }))

    // Query child (CHILD) relationships
    const childResult = await session.run(
      `MATCH (p:Person)-[:CHILD]->(u:Union)
       RETURN p.gedcomId AS personId, u.gedcomId AS unionId`
    )

    const children: ChildRel[] = childResult.records.map(r => ({
      personId: r.get('personId') as string,
      unionId: r.get('unionId') as string,
    }))

    // Build a sex lookup map for spouse-role determination
    const personSexMap = new Map<string, string>()
    for (const p of persons) {
      personSexMap.set(p.gedcomId, p.sex)
    }

    // Assemble GEDCOM sections
    const sections: string[] = []

    // HEAD block
    sections.push(
      [
        '0 HEAD',
        '1 SOUR FamilyTree',
        '1 GEDC',
        '2 VERS 5.5.1',
        '2 FORM LINEAGE-LINKED',
        '1 CHAR UTF-8',
      ].join('\n')
    )

    // INDI records
    for (const person of persons) {
      sections.push(buildIndiRecord(person))
    }

    // FAM records
    for (const union of unions) {
      sections.push(buildFamRecord(union, spouses, children, personSexMap))
    }

    // TRLR
    sections.push('0 TRLR')

    const output = sections.join('\n') + '\n'
    const outPath = path.join(__dirname, '../family-tree.ged')
    fs.writeFileSync(outPath, output, 'utf-8')

    console.log(
      `Exported ${persons.length} people and ${unions.length} unions to ${outPath}`
    )
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
