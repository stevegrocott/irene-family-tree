import { GEDCOM_TYPES, escapeGedcomValue, buildIndiRecord, type PersonNode } from './gedcom'

export const PERSON_QUERY = `MATCH (p:Person)
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

export const UNION_QUERY = `MATCH (u:Union)
         RETURN u.gedcomId      AS gedcomId,
                u.marriageYear  AS marriageYear,
                u.marriagePlace AS marriagePlace
         ORDER BY u.gedcomId`

export const SPOUSE_EDGES_QUERY = `MATCH (p:Person)-[:UNION]->(u:Union)
         RETURN p.gedcomId AS personId, u.gedcomId AS unionId`

export const CHILD_EDGES_QUERY = `MATCH (u:Union)-[:CHILD]->(p:Person)
         RETURN p.gedcomId AS personId, u.gedcomId AS unionId`

export interface UnionNode {
  gedcomId: string
  marriageYear: string | null
  marriagePlace: string | null
}

export interface PersonUnionRel {
  personId: string
  unionId: string
}

export interface QueryRecord {
  get(key: string): unknown
}

export function mapPersonRecord(r: QueryRecord): PersonNode {
  return {
    gedcomId: r.get('gedcomId') as string,
    name: (r.get('name') as string | null) ?? '[Unknown]',
    sex: (r.get('sex') as string | null) ?? '',
    birthYear: r.get('birthYear') as string | null,
    deathYear: r.get('deathYear') as string | null,
    birthPlace: r.get('birthPlace') as string | null,
    deathPlace: r.get('deathPlace') as string | null,
    occupation: r.get('occupation') as string | null,
    notes: r.get('notes') as string | null,
  }
}

export function mapUnionRecord(r: QueryRecord): UnionNode {
  return {
    gedcomId: r.get('gedcomId') as string,
    marriageYear: r.get('marriageYear') as string | null,
    marriagePlace: r.get('marriagePlace') as string | null,
  }
}

export function mapRelRecord(r: QueryRecord): PersonUnionRel {
  return {
    personId: r.get('personId') as string,
    unionId: r.get('unionId') as string,
  }
}

export function groupByUnionId(rels: PersonUnionRel[]): Map<string, PersonUnionRel[]> {
  const map = new Map<string, PersonUnionRel[]>()
  for (const rel of rels) {
    if (!map.has(rel.unionId)) map.set(rel.unionId, [])
    map.get(rel.unionId)!.push(rel)
  }
  return map
}

export interface FamilyBuildContext {
  union: UnionNode
  spouses: PersonUnionRel[]
  children: PersonUnionRel[]
  personSexMap: Map<string, string>
}

export function buildFamRecord(ctx: FamilyBuildContext): string {
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

export interface GedcomExportData {
  persons: PersonNode[]
  unions: UnionNode[]
  spouseRels: PersonUnionRel[]
  childRels: PersonUnionRel[]
}

export function buildGedcomDocument(data: GedcomExportData): string {
  const { persons, unions, spouseRels, childRels } = data

  const spousesByUnion = groupByUnionId(spouseRels)
  const childrenByUnion = groupByUnionId(childRels)

  const personSexMap = new Map<string, string>()
  for (const p of persons) {
    personSexMap.set(p.gedcomId, p.sex)
  }

  const famsByPerson = new Map<string, string[]>()
  const famcByPerson = new Map<string, string[]>()
  for (const rel of spouseRels) {
    if (!famsByPerson.has(rel.personId)) famsByPerson.set(rel.personId, [])
    famsByPerson.get(rel.personId)!.push(rel.unionId)
  }
  for (const rel of childRels) {
    if (!famcByPerson.has(rel.personId)) famcByPerson.set(rel.personId, [])
    famcByPerson.get(rel.personId)!.push(rel.unionId)
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

  return sections.join('\n') + '\n'
}
