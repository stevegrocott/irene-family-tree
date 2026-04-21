import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'

export const runtime = 'nodejs'

interface PersonSummary {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  deathYear: string | null
  birthPlace: string | null
}

export async function GET() {
  const persons = await read<PersonSummary>(
    `MATCH (p:Person)
     RETURN p.gedcomId AS gedcomId,
            coalesce(p.name, '') AS name,
            p.sex AS sex,
            p.birthYear AS birthYear,
            p.deathYear AS deathYear,
            p.birthPlace AS birthPlace
     ORDER BY p.surname, p.givenName, p.name`
  )
  return NextResponse.json(persons)
}
