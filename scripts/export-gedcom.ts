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
import { loadLocalEnv, validateRequiredEnv } from '../src/lib/env'

loadLocalEnv()

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

interface PersonUnionRel {
  personId: string
  unionId: string
}

const GEDCOM_TYPES = {
  INDIVIDUAL: 'INDI',
  FAMILY: 'FAM',
  NAME: 'NAME',
  GIVEN_NAME: 'GIVN',
  SURNAME: 'SURN',
  SEX: 'SEX',
  BIRTH: 'BIRT',
  DEATH: 'DEAT',
  DATE: 'DATE',
  PLACE: 'PLAC',
  OCCUPATION: 'OCCU',
  NOTE: 'NOTE',
  MARRIAGE: 'MARR',
  HEAD: 'HEAD',
  GEDC: 'GEDC',
  VERS: 'VERS',
  FORM: 'FORM',
  CHAR: 'CHAR',
  SOUR: 'SOUR',
  HUSB: 'HUSB',
  WIFE: 'WIFE',
  CHIL: 'CHIL',
  TRLR: 'TRLR',
} as const

function groupByUnionId(rels: PersonUnionRel[]): Map<string, PersonUnionRel[]> {
  const map = new Map<string, PersonUnionRel[]>()
  for (const rel of rels) {
    if (!map.has(rel.unionId)) map.set(rel.unionId, [])
    map.get(rel.unionId)!.push(rel)
  }
  return map
}

// In GEDCOM 5.5.1, a bare @ in a value field must be written as @@. Never call this on pointer IDs.
function escapeGedcomValue(value: string): string {
  return value.replace(/@/g, '@@')
}

function buildIndiRecord(person: PersonNode): string {
  const lines: string[] = []

  lines.push(`0 ${person.gedcomId} ${GEDCOM_TYPES.INDIVIDUAL}`)

  const isUnknown = !person.name || person.name === '[Unknown]'
  if (isUnknown) {
    lines.push(`1 ${GEDCOM_TYPES.NAME} [Unknown]`)
  } else {
    const parts = person.name.trim().split(' ')
    const surname = parts.length > 1 ? parts[parts.length - 1] : ''
    const givenName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]
    const gedcomName = surname
      ? `${escapeGedcomValue(givenName)} /${escapeGedcomValue(surname)}/`
      : escapeGedcomValue(givenName)
    lines.push(`1 ${GEDCOM_TYPES.NAME} ${gedcomName}`)
    if (givenName) lines.push(`2 ${GEDCOM_TYPES.GIVEN_NAME} ${escapeGedcomValue(givenName)}`)
    if (surname) lines.push(`2 ${GEDCOM_TYPES.SURNAME} ${escapeGedcomValue(surname)}`)
  }

  if (person.sex) {
    lines.push(`1 ${GEDCOM_TYPES.SEX} ${person.sex}`)
  }

  if (person.birthYear || person.birthPlace) {
    lines.push(`1 ${GEDCOM_TYPES.BIRTH}`)
    if (person.birthYear) lines.push(`2 ${GEDCOM_TYPES.DATE} ${person.birthYear}`)
    if (person.birthPlace) lines.push(`2 ${GEDCOM_TYPES.PLACE} ${escapeGedcomValue(person.birthPlace)}`)
  }

  if (person.deathYear || person.deathPlace) {
    lines.push(`1 ${GEDCOM_TYPES.DEATH}`)
    if (person.deathYear) lines.push(`2 ${GEDCOM_TYPES.DATE} ${person.deathYear}`)
    if (person.deathPlace) lines.push(`2 ${GEDCOM_TYPES.PLACE} ${escapeGedcomValue(person.deathPlace)}`)
  }

  if (person.occupation) {
    lines.push(`1 ${GEDCOM_TYPES.OCCUPATION} ${escapeGedcomValue(person.occupation)}`)
  }

  if (person.notes) {
    lines.push(`1 ${GEDCOM_TYPES.NOTE} ${escapeGedcomValue(person.notes)}`)
  }

  return lines.join('\n')
}

// Spouse roles (HUSB/WIFE) are inferred from Person.sex; falls back to insertion order for unrecognised values.
function buildFamRecord(
  union: UnionNode,
  spousesForUnion: PersonUnionRel[],
  childrenForUnion: PersonUnionRel[],
  personSexMap: Map<string, string>
): string {
  const lines: string[] = []

  lines.push(`0 ${union.gedcomId} ${GEDCOM_TYPES.FAMILY}`)

  let husb: string | null = null
  let wife: string | null = null
  const unassigned: string[] = []

  for (const s of spousesForUnion) {
    const sex = personSexMap.get(s.personId) ?? ''
    if (sex === 'M' && husb === null) {
      husb = s.personId
    } else if (sex === 'F' && wife === null) {
      wife = s.personId
    } else {
      unassigned.push(s.personId)
    }
  }

  for (const pid of unassigned) {
    if (husb === null) husb = pid
    else if (wife === null) wife = pid
  }

  if (husb !== null) lines.push(`1 ${GEDCOM_TYPES.HUSB} ${husb}`)
  if (wife !== null) lines.push(`1 ${GEDCOM_TYPES.WIFE} ${wife}`)

  for (const c of childrenForUnion) {
    lines.push(`1 ${GEDCOM_TYPES.CHIL} ${c.personId}`)
  }

  if (union.marriageYear || union.marriagePlace) {
    lines.push(`1 ${GEDCOM_TYPES.MARRIAGE}`)
    if (union.marriageYear) lines.push(`2 ${GEDCOM_TYPES.DATE} ${union.marriageYear}`)
    if (union.marriagePlace) {
      lines.push(`2 ${GEDCOM_TYPES.PLACE} ${escapeGedcomValue(union.marriagePlace)}`)
    }
  }

  return lines.join('\n')
}

async function main() {
  validateRequiredEnv(['NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD'])

  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true }
  )
  const session = driver.session()

  try {
    const [personResult, unionResult, spouseResult, childResult] = await Promise.all([
      session.run(
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
      ),
      session.run(
        `MATCH (u:Union)
         RETURN u.gedcomId      AS gedcomId,
                u.marriageYear  AS marriageYear,
                u.marriagePlace AS marriagePlace
         ORDER BY u.gedcomId`
      ),
      session.run(
        `MATCH (p:Person)-[:UNION]->(u:Union)
         RETURN p.gedcomId AS personId, u.gedcomId AS unionId`
      ),
      session.run(
        `MATCH (p:Person)-[:CHILD]->(u:Union)
         RETURN p.gedcomId AS personId, u.gedcomId AS unionId`
      ),
    ])

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

    const unions: UnionNode[] = unionResult.records.map(r => ({
      gedcomId: r.get('gedcomId') as string,
      marriageYear: r.get('marriageYear') as string | null,
      marriagePlace: r.get('marriagePlace') as string | null,
    }))

    const toRel = (r: { get(k: string): unknown }) => ({
      personId: r.get('personId') as string,
      unionId: r.get('unionId') as string,
    })
    const spousesByUnion = groupByUnionId(spouseResult.records.map(toRel))
    const childrenByUnion = groupByUnionId(childResult.records.map(toRel))

    const personSexMap = new Map<string, string>()
    for (const p of persons) {
      personSexMap.set(p.gedcomId, p.sex)
    }

    const sections: string[] = []

    sections.push(
      [
        `0 ${GEDCOM_TYPES.HEAD}`,
        `1 ${GEDCOM_TYPES.SOUR} FamilyTree`,
        `1 ${GEDCOM_TYPES.GEDC}`,
        `2 ${GEDCOM_TYPES.VERS} 5.5.1`,
        `2 ${GEDCOM_TYPES.FORM} LINEAGE-LINKED`,
        `1 ${GEDCOM_TYPES.CHAR} UTF-8`,
      ].join('\n')
    )

    for (const person of persons) {
      sections.push(buildIndiRecord(person))
    }

    for (const union of unions) {
      const spouses = spousesByUnion.get(union.gedcomId) ?? []
      const children = childrenByUnion.get(union.gedcomId) ?? []
      sections.push(buildFamRecord(union, spouses, children, personSexMap))
    }

    sections.push(`0 ${GEDCOM_TYPES.TRLR}`)

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
