import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'

interface Person {
  gedcomId: string
  name: string
  sex: string
  birthYear: string | null
  deathYear: string | null
}

export async function GET() {
  const persons = await read<Person>(
    'MATCH (p:Person) RETURN p.gedcomId AS gedcomId, p.name AS name, p.sex AS sex, p.birthYear AS birthYear, p.deathYear AS deathYear ORDER BY p.name'
  )
  return NextResponse.json(persons)
}
