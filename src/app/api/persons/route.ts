import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'

export const runtime = 'nodejs'

interface Person {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  deathYear: string | null
  birthPlace: string | null
}

export async function GET() {
  let persons: Person[]
  try {
    persons = await read<Person>(
      'MATCH (p:Person) RETURN p.gedcomId AS gedcomId, p.name AS name, p.sex AS sex, p.birthYear AS birthYear, p.deathYear AS deathYear, p.birthPlace AS birthPlace ORDER BY p.name LIMIT 2000'
    )
  } catch (err) {
    console.error('Neo4j query failed', err)
    return NextResponse.json({ error: 'Failed to query graph database' }, { status: 500 })
  }
  return NextResponse.json(persons)
}
