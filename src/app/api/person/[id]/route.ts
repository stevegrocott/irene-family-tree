import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'

export const runtime = 'nodejs'

interface PersonSummary {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  deathYear: string | null
}

interface MarriageDetail {
  unionId: string
  marriageYear: string | null
  marriagePlace: string | null
  spouse: PersonSummary | null
  children: PersonSummary[]
}

interface PersonDetailRow {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  deathYear: string | null
  birthPlace: string | null
  deathPlace: string | null
  occupation: string | null
  notes: string | null
  parents: PersonSummary[]
  siblings: PersonSummary[]
  marriages: MarriageDetail[]
}

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
