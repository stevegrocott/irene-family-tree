/**
 * @module api/person/[id]
 * @description REST endpoint for retrieving a single person's full detail from the Neo4j graph,
 * including parents, siblings, and all marriage/family-unit relationships.
 * Route: GET /api/person/[id]
 */

import { NextResponse } from 'next/server'
import { read, write } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { auth } from '@/auth'
import type { PersonSummary, MarriageDetail } from '@/types/tree'

/** Forces the route to run in the Node.js runtime (required for Neo4j driver). */
export const runtime = 'nodejs'

/**
 * Full detail row returned by the Cypher query for a single person.
 */
interface PersonDetailRow {
  /** GEDCOM identifier for this person. */
  gedcomId: string
  /** Full display name. */
  name: string
  /** Biological sex recorded in GEDCOM ("M", "F", or null). */
  sex: string | null
  /** Four-digit birth year, or null if unknown. */
  birthYear: string | null
  /** Four-digit death year, or null if still living or unknown. */
  deathYear: string | null
  /** Place name of birth, or null if unknown. */
  birthPlace: string | null
  /** Place name of death, or null if unknown. */
  deathPlace: string | null
  /** Recorded occupation(s), or null if none. */
  occupation: string | null
  /** Free-text notes from the GEDCOM record, or null if none. */
  notes: string | null
  /** Biological or adoptive parents identified in the graph. */
  parents: PersonSummary[]
  /** Siblings sharing at least one common parent union. */
  siblings: PersonSummary[]
  /** All recorded marriages/unions with spouse and children for each. */
  marriages: MarriageDetail[]
}

/**
 * Handles GET /api/person/[id].
 *
 * Fetches a person's full detail from Neo4j by their GEDCOM ID, including
 * parents, siblings, and all marriage unions with spouses and children.
 *
 * @param _request - The incoming HTTP request (unused).
 * @param params - Route parameters containing the person's GEDCOM `id`.
 * @returns A JSON response with a {@link PersonDetailRow} on success,
 *          `{ error: "Person not found" }` (404) if the ID does not exist,
 *          or `{ error: "Failed to query graph database" }` (500) on a Neo4j error.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let rows: PersonDetailRow[]
  try {
    rows = await read<PersonDetailRow>(
    `MATCH (p:Person {gedcomId: $id})

     // Parents: unions where p is a child, then find persons connected via UNION to those unions
     OPTIONAL MATCH (p)-[:CHILD]->(pu:Union)<-[:UNION]-(parent:Person)

     // Siblings: unions where p is a child, then other children of those same unions
     OPTIONAL MATCH (p)-[:CHILD]->(su:Union)<-[:CHILD]-(sib:Person)
     WHERE sib <> p

     WITH p,
       collect(DISTINCT CASE WHEN parent IS NOT NULL THEN {
         gedcomId: parent.gedcomId, name: parent.name, sex: parent.sex,
         birthYear: parent.birthYear, deathYear: parent.deathYear
       } END) AS parents,
       collect(DISTINCT CASE WHEN sib IS NOT NULL THEN {
         gedcomId: sib.gedcomId, name: sib.name, sex: sib.sex,
         birthYear: sib.birthYear, deathYear: sib.deathYear
       } END) AS siblings

     // Collect all marriage union nodes for this person
     OPTIONAL MATCH (p)-[:UNION]->(m:Union)
     WITH p, parents, siblings, collect(DISTINCT m) AS marriages

     // UNWIND each marriage to independently collect spouse and children
     UNWIND CASE WHEN size(marriages) > 0 THEN marriages ELSE [null] END AS m

     OPTIONAL MATCH (sp:Person)-[:UNION]->(m)
     WHERE sp <> p
     OPTIONAL MATCH (ch:Person)-[:CHILD]->(m)

     WITH p, parents, siblings, m,
       collect(DISTINCT CASE WHEN sp IS NOT NULL THEN {
         gedcomId: sp.gedcomId, name: sp.name, sex: sp.sex,
         birthYear: sp.birthYear, deathYear: sp.deathYear
       } END) AS spouses,
       collect(DISTINCT CASE WHEN ch IS NOT NULL THEN {
         gedcomId: ch.gedcomId, name: ch.name, sex: ch.sex,
         birthYear: ch.birthYear, deathYear: ch.deathYear
       } END) AS children

     WITH p, parents, siblings,
       collect(DISTINCT CASE WHEN m IS NOT NULL THEN {
         unionId: m.gedcomId,
         marriageYear: m.marriageYear,
         marriagePlace: m.marriagePlace,
         spouse: CASE WHEN size(spouses) > 0 THEN spouses[0] ELSE null END,
         children: [c IN children WHERE c IS NOT NULL]
       } END) AS marriages

     RETURN
       p.gedcomId    AS gedcomId,
       p.name        AS name,
       p.sex         AS sex,
       p.birthYear   AS birthYear,
       p.deathYear   AS deathYear,
       p.birthPlace  AS birthPlace,
       p.deathPlace  AS deathPlace,
       p.occupation  AS occupation,
       p.notes       AS notes,
       [x IN parents  WHERE x IS NOT NULL] AS parents,
       [x IN siblings WHERE x IS NOT NULL] AS siblings,
       [x IN marriages WHERE x IS NOT NULL] AS marriages`,
    { id }
    )
  } catch (err) {
    console.error('Neo4j query failed', err)
    return NextResponse.json({ error: 'Failed to query graph database' }, { status: 500 })
  }

  if (!rows.length || rows[0].gedcomId == null) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  return NextResponse.json(rows[0])
}

const ALLOWED_PATCH_FIELDS = [
  'name', 'sex', 'birthYear', 'birthDate', 'birthPlace',
  'deathYear', 'deathDate', 'deathPlace', 'occupation', 'notes',
] as const

interface UpdatedPerson {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  birthDate: string | null
  birthPlace: string | null
  deathYear: string | null
  deathDate: string | null
  deathPlace: string | null
  occupation: string | null
  notes: string | null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const fields: Record<string, unknown> = {}
  for (const key of ALLOWED_PATCH_FIELDS) {
    if (key in body) fields[key] = body[key]
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  let previousPerson: UpdatedPerson | null = null
  try {
    const previousRows = await read<UpdatedPerson>(
      `MATCH (p:Person {gedcomId: $id})
       RETURN p.gedcomId AS gedcomId, p.name AS name, p.sex AS sex,
              p.birthYear AS birthYear, p.birthDate AS birthDate,
              p.birthPlace AS birthPlace, p.deathYear AS deathYear,
              p.deathDate AS deathDate, p.deathPlace AS deathPlace,
              p.occupation AS occupation, p.notes AS notes`,
      { id }
    )
    previousPerson = previousRows?.[0] ?? null
  } catch (err) {
    console.error('Neo4j pre-update read failed', err)
  }

  let rows: UpdatedPerson[]
  try {
    rows = await write<UpdatedPerson>(
      `MATCH (p:Person {gedcomId: $id})
       SET p += $fields
       RETURN p.gedcomId AS gedcomId, p.name AS name, p.sex AS sex,
              p.birthYear AS birthYear, p.birthDate AS birthDate,
              p.birthPlace AS birthPlace, p.deathYear AS deathYear,
              p.deathDate AS deathDate, p.deathPlace AS deathPlace,
              p.occupation AS occupation, p.notes AS notes`,
      { id, fields }
    )
  } catch (err) {
    console.error('Neo4j write failed', err)
    return NextResponse.json({ error: 'Failed to update graph database' }, { status: 500 })
  }

  if (!rows.length || rows[0].gedcomId == null) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  const session = await auth()
  const authorEmail = session?.user?.email ?? 'anonymous'
  const authorName = session?.user?.name ?? 'anonymous'
  await recordChange(authorEmail, authorName, 'UPDATE_PERSON', id, previousPerson, rows[0])

  return NextResponse.json(rows[0])
}
