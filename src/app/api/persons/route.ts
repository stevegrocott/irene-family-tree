import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'

export const runtime = 'nodejs'

interface Person {
  gedcomId: string
  name: string
}

export async function GET() {
  const persons = await read<Person>(
    'MATCH (p:Person) RETURN p.gedcomId AS gedcomId, p.name AS name ORDER BY p.name'
  )
  return NextResponse.json(persons)
}
