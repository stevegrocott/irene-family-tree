import { read } from '@/lib/neo4j'
import type { PersonDetail, Relative, PersonData } from '@/types/tree'

export const runtime = 'nodejs'

type PersonRow = Omit<PersonData, 'isRoot' | 'generation'>

interface DetailRow {
  person: PersonRow
  parents: Relative[]
  siblings: Relative[]
  marriages: Array<{
    gedcomId: string
    marriageDate: string | null
    marriagePlace: string | null
    spouse: Relative | null
    children: Relative[]
  }>
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let rows: DetailRow[]
  try {
    rows = await read<DetailRow>(
      `MATCH (p:Person {gedcomId: $id})

       // Parent family & parents/siblings
       OPTIONAL MATCH (p)-[:CHILD]->(pf:Union)
       OPTIONAL MATCH (parent:Person)-[:UNION]->(pf)
       WITH p, pf, collect(DISTINCT parent) AS parents
       OPTIONAL MATCH (sib:Person)-[:CHILD]->(pf) WHERE sib <> p
       WITH p, parents, collect(DISTINCT sib) AS siblings

       // Marriages (own) with spouse + children
       OPTIONAL MATCH (p)-[:UNION]->(mf:Union)
       OPTIONAL MATCH (sp:Person)-[:UNION]->(mf) WHERE sp <> p
       WITH p, parents, siblings, mf, head(collect(DISTINCT sp)) AS spouse
       OPTIONAL MATCH (child:Person)-[:CHILD]->(mf)
       WITH p, parents, siblings, mf, spouse, collect(DISTINCT child) AS children

       WITH p, parents, siblings,
            collect(CASE WHEN mf IS NULL THEN NULL ELSE {
              gedcomId: mf.gedcomId,
              marriageDate: mf.marriageDate,
              marriagePlace: mf.marriagePlace,
              spouse: CASE WHEN spouse IS NULL THEN NULL ELSE {
                gedcomId: spouse.gedcomId, name: spouse.name, sex: spouse.sex,
                birthYear: spouse.birthYear, deathYear: spouse.deathYear
              } END,
              children: [c IN children | {
                gedcomId: c.gedcomId, name: c.name, sex: c.sex,
                birthYear: c.birthYear, deathYear: c.deathYear
              }]
            } END) AS marriages

       RETURN {
         gedcomId: p.gedcomId, name: p.name,
         givenName: p.givenName, surname: p.surname, sex: p.sex,
         birthDate: p.birthDate, birthYear: p.birthYear, birthPlace: p.birthPlace,
         deathDate: p.deathDate, deathYear: p.deathYear, deathPlace: p.deathPlace,
         occupation: p.occupation, notes: p.notes
       } AS person,
       [pr IN parents | {gedcomId: pr.gedcomId, name: pr.name, sex: pr.sex, birthYear: pr.birthYear, deathYear: pr.deathYear}] AS parents,
       [s IN siblings | {gedcomId: s.gedcomId, name: s.name, sex: s.sex, birthYear: s.birthYear, deathYear: s.deathYear}] AS siblings,
       [m IN marriages WHERE m IS NOT NULL] AS marriages`,
      { id }
    )
  } catch (err) {
    console.error('Neo4j person detail query failed', err)
    return Response.json({ error: 'Failed to query graph database' }, { status: 500 })
  }

  if (!rows.length) {
    return Response.json({ error: 'Person not found' }, { status: 404 })
  }

  const row = rows[0]
  const spouses: Relative[] = row.marriages
    .map((m) => m.spouse)
    .filter((s): s is Relative => Boolean(s))
  const children: Relative[] = row.marriages.flatMap((m) => m.children)

  const detail: PersonDetail = {
    person: row.person as PersonData,
    parents: row.parents,
    siblings: row.siblings,
    spouses,
    children,
    marriages: row.marriages,
  }

  return Response.json(detail)
}
