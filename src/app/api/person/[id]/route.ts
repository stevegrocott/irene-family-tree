/**
 * @module api/person/[id]
 * @description REST endpoint for retrieving a single person's full detail from the Neo4j graph,
 * including parents, siblings, and all marriage/family-unit relationships.
 * Route: GET /api/person/[id]
 */

import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'

/** Forces the route to run in the Node.js runtime (required for Neo4j driver). */
export const runtime = 'nodejs'

/**
 * Lightweight summary of a related person, used in parent, sibling, spouse, and child lists.
 */
interface PersonSummary {
  /** GEDCOM identifier for the person (e.g. "I0001"). */
  gedcomId: string
  /** Full display name. */
  name: string
  /** Biological sex recorded in GEDCOM ("M", "F", or null). */
  sex: string | null
  /** Four-digit birth year, or null if unknown. */
  birthYear: string | null
  /** Four-digit death year, or null if still living or unknown. */
  deathYear: string | null
}

/**
 * Details of a single marriage/union, including the spouse and children of that union.
 */
interface MarriageDetail {
  /** GEDCOM identifier for the Union node. */
  unionId: string
  /** Four-digit year the marriage took place, or null if unknown. */
  marriageYear: string | null
  /** Place name where the marriage occurred, or null if unknown. */
  marriagePlace: string | null
  /** The other partner in this union, or null if no spouse is recorded. */
  spouse: PersonSummary | null
  /** Children born of this union. */
  children: PersonSummary[]
}

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
