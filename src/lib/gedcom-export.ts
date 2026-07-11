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

function groupBy<T, K extends string | number, V>(
  items: T[],
  keyFn: (item: T) => K,
  valueFn: (item: T) => V
): Map<K, V[]> {
  const map = new Map<K, V[]>()
  for (const item of items) {
    const key = keyFn(item)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(valueFn(item))
  }
  return map
}

export function groupByUnionId(rels: PersonUnionRel[]): Map<string, PersonUnionRel[]> {
  return groupBy(rels, rel => rel.unionId, rel => rel)
}

function groupByPersonId(rels: PersonUnionRel[]): Map<string, string[]> {
  return groupBy(rels, rel => rel.personId, rel => rel.unionId)
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

  for (const personId of unassigned) {
    if (husb === null) {
      husb = personId
    } else if (wife === null) {
      wife = personId
    }
  }

  if (husb !== null) lines.push(`1 ${GEDCOM_TYPES.HUSB} ${husb}`)
  if (wife !== null) lines.push(`1 ${GEDCOM_TYPES.WIFE} ${wife}`)

  for (const c of ctx.children) {
    lines.push(`1 ${GEDCOM_TYPES.CHIL} ${c.personId}`)
  }

  if (ctx.union.marriageYear || ctx.union.marriagePlace) {
    lines.push(`1 ${GEDCOM_TYPES.MARRIAGE}`)
    if (ctx.union.marriageYear) lines.push(`2 ${GEDCOM_TYPES.DATE} ${ctx.union.marriageYear}`)
    if (ctx.union.marriagePlace) lines.push(`2 ${GEDCOM_TYPES.PLACE} ${escapeGedcomValue(ctx.union.marriagePlace)}`)
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

  const personSexMap = new Map(persons.map(p => [p.gedcomId, p.sex]))

  const famsByPerson = groupByPersonId(spouseRels)
  const famcByPerson = groupByPersonId(childRels)

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
