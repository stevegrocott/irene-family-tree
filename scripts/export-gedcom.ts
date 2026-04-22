import * as fs from 'fs'
import * as path from 'path'
import neo4j from 'neo4j-driver'
import { loadLocalEnv, validateRequiredEnv } from '../src/lib/env'
import { GEDCOM_TYPES, escapeGedcomValue } from '../src/lib/gedcom'

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

function groupByUnionId(rels: PersonUnionRel[]): Map<string, PersonUnionRel[]> {
  const map = new Map<string, PersonUnionRel[]>()
  for (const rel of rels) {
    if (!map.has(rel.unionId)) map.set(rel.unionId, [])
    map.get(rel.unionId)!.push(rel)
  }
  return map
}

function addLifeEvent(lines: string[], tag: string, year: string | null, place: string | null): void {
  if (!year && !place) return
  lines.push(`1 ${tag}`)
  if (year) lines.push(`2 ${GEDCOM_TYPES.DATE} ${year}`)
  if (place) lines.push(`2 ${GEDCOM_TYPES.PLACE} ${escapeGedcomValue(place)}`)
}

function buildIndiRecord(person: PersonNode, famsIds: string[], famcIds: string[]): string {
  const lines: string[] = []

  lines.push(`0 ${person.gedcomId} ${GEDCOM_TYPES.INDIVIDUAL}`)

  if (!person.name || person.name === '[Unknown]') {
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

  addLifeEvent(lines, GEDCOM_TYPES.BIRTH, person.birthYear, person.birthPlace)
  addLifeEvent(lines, GEDCOM_TYPES.DEATH, person.deathYear, person.deathPlace)

  if (person.occupation) {
    lines.push(`1 ${GEDCOM_TYPES.OCCUPATION} ${escapeGedcomValue(person.occupation)}`)
  }

  if (person.notes) {
    const noteLines = person.notes.split('\n')
    lines.push(`1 ${GEDCOM_TYPES.NOTE} ${escapeGedcomValue(noteLines[0])}`)
    for (const cont of noteLines.slice(1)) {
      lines.push(`2 ${GEDCOM_TYPES.CONT} ${escapeGedcomValue(cont)}`)
    }
  }

  for (const uid of famsIds) {
    lines.push(`1 ${GEDCOM_TYPES.FAMS} ${uid}`)
  }
  for (const uid of famcIds) {
    lines.push(`1 ${GEDCOM_TYPES.FAMC} ${uid}`)
  }

  return lines.join('\n')
}

interface FamilyBuildContext {
  union: UnionNode
  spouses: PersonUnionRel[]
  children: PersonUnionRel[]
  personSexMap: Map<string, string>
}

function buildFamRecord(ctx: FamilyBuildContext): string {
  const lines: string[] = []

  lines.push(`0 ${ctx.union.gedcomId} ${GEDCOM_TYPES.FAMILY}`)

  let husb: string | null = null
  let wife: string | null = null
  const unassigned: string[] = []

  for (const s of ctx.spouses) {
    const sex = ctx.personSexMap.get(s.personId) ?? ''
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

  for (const c of ctx.children) {
    lines.push(`1 ${GEDCOM_TYPES.CHIL} ${c.personId}`)
  }

  if (ctx.union.marriageYear || ctx.union.marriagePlace) {
    lines.push(`1 ${GEDCOM_TYPES.MARRIAGE}`)
    if (ctx.union.marriageYear) lines.push(`2 ${GEDCOM_TYPES.DATE} ${ctx.union.marriageYear}`)
    if (ctx.union.marriagePlace) {
      lines.push(`2 ${GEDCOM_TYPES.PLACE} ${escapeGedcomValue(ctx.union.marriagePlace)}`)
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

    const famsByPerson = new Map<string, string[]>()
    const famcByPerson = new Map<string, string[]>()
    for (const r of spouseResult.records) {
      const pid = r.get('personId') as string
      const uid = r.get('unionId') as string
      if (!famsByPerson.has(pid)) famsByPerson.set(pid, [])
      famsByPerson.get(pid)!.push(uid)
    }
    for (const r of childResult.records) {
      const pid = r.get('personId') as string
      const uid = r.get('unionId') as string
      if (!famcByPerson.has(pid)) famcByPerson.set(pid, [])
      famcByPerson.get(pid)!.push(uid)
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
      const famsIds = famsByPerson.get(person.gedcomId) ?? []
      const famcIds = famcByPerson.get(person.gedcomId) ?? []
      sections.push(buildIndiRecord(person, famsIds, famcIds))
    }

    for (const union of unions) {
      const spouses = spousesByUnion.get(union.gedcomId) ?? []
      const children = childrenByUnion.get(union.gedcomId) ?? []
      sections.push(buildFamRecord({ union, spouses, children, personSexMap }))
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
