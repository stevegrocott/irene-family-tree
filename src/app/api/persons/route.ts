/**
 * @module api/persons
 * @description REST endpoint that returns a paginated list of all persons in the Neo4j graph,
 * ordered alphabetically by name. Capped at 2 000 results per request.
 * Route: GET /api/persons
 */

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { read, write } from '@/lib/neo4j'

/** Forces the route to run in the Node.js runtime (required for Neo4j driver). */
export const runtime = 'nodejs'

/**
 * Summary record for a single person as returned by the persons list endpoint.
 */
interface Person {
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
  /** Place name of birth, or null if unknown. */
  birthPlace: string | null
}

/**
 * Handles GET /api/persons.
 *
 * Returns up to 2 000 persons from the Neo4j graph, sorted alphabetically by name.
 *
 * @returns A JSON response containing an array of {@link Person} objects on success,
 *          or `{ error: "Failed to query graph database" }` (500) on a Neo4j error.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')

  let persons: Person[]
  try {
    if (q) {
      persons = await read<Person>(
        'MATCH (p:Person) WHERE p.name CONTAINS $q RETURN p.gedcomId AS gedcomId, p.name AS name, p.sex AS sex, p.birthYear AS birthYear, p.deathYear AS deathYear, p.birthPlace AS birthPlace ORDER BY p.name LIMIT 2000',
        { q }
      )
    } else {
      persons = await read<Person>(
        'MATCH (p:Person) RETURN p.gedcomId AS gedcomId, p.name AS name, p.sex AS sex, p.birthYear AS birthYear, p.deathYear AS deathYear, p.birthPlace AS birthPlace ORDER BY p.name LIMIT 2000'
      )
    }
  } catch (err) {
    console.error('Neo4j query failed', err)
    return NextResponse.json({ error: 'Failed to query graph database' }, { status: 500 })
  }
  return NextResponse.json(persons)
}

interface CreatedPerson {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  birthPlace: string | null
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const gedcomId = '@U' + randomUUID().slice(0, 8) + '@'
  const { name, sex = null, birthYear = null, birthPlace = null } = body as {
    name: string
    sex?: string | null
    birthYear?: string | null
    birthPlace?: string | null
  }

  let rows: CreatedPerson[]
  try {
    rows = await write<CreatedPerson>(
      `CREATE (p:Person {gedcomId: $gedcomId, name: $name, sex: $sex, birthYear: $birthYear, birthPlace: $birthPlace})
       RETURN p.gedcomId AS gedcomId, p.name AS name, p.sex AS sex, p.birthYear AS birthYear, p.birthPlace AS birthPlace`,
      { gedcomId, name, sex, birthYear, birthPlace }
    )
  } catch (err) {
    console.error('Neo4j write failed', err)
    return NextResponse.json({ error: 'Failed to write to graph database' }, { status: 500 })
  }

  return NextResponse.json(rows[0], { status: 201 })
}
