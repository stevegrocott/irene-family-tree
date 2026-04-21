/**
 * @module api/persons
 * @description REST endpoint that returns a paginated list of all persons in the Neo4j graph,
 * ordered alphabetically by name. Capped at 2 000 results per request.
 * Route: GET /api/persons
 */

import { NextResponse } from 'next/server'
import { read } from '@/lib/neo4j'

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
