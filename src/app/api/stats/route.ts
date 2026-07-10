/**
 * @module api/stats
 * @description Public REST endpoint that returns aggregate statistics for the whole
 * GEDCOM dataset — totals, trends, and superlatives — computed server-side with a
 * handful of read-only Cypher aggregations.
 * Route: GET /api/stats
 */

import { NextResponse } from 'next/server'
import { read, neo4jErrorResponse } from '@/lib/neo4j'
import type {
  SexBreakdown,
  DecadeCount,
  SurnameCount,
  BirthplaceCount,
  OldestAncestor,
  LargestUnion,
  StatsResponse,
} from '@/types/stats'

/** Forces the route to run in the Node.js runtime (required for Neo4j driver). */
export const runtime = 'nodejs'

const YEAR_PATTERN = '[0-9]{3,4}'

const QUERY_TOTALS = `MATCH (p:Person)
RETURN count(p) AS totalPeople,
       sum(CASE WHEN p.sex = 'M' THEN 1 ELSE 0 END) AS male,
       sum(CASE WHEN p.sex = 'F' THEN 1 ELSE 0 END) AS female,
       sum(CASE WHEN p.sex IS NULL OR NOT p.sex IN ['M', 'F'] THEN 1 ELSE 0 END) AS unknown`

const QUERY_UNIONS = 'MATCH (u:Union) RETURN count(u) AS unionCount'

const QUERY_DECADES = `MATCH (p:Person)
WHERE p.birthYear IS NOT NULL AND p.birthYear =~ $yearPattern
WITH (toInteger(p.birthYear) / 10) * 10 AS decade
RETURN decade, count(*) AS count
ORDER BY decade ASC`

const QUERY_SURNAMES = `MATCH (p:Person)
WHERE p.name IS NOT NULL
WITH trim(p.name) AS cleanName
WHERE cleanName <> '' AND cleanName <> '[Unknown]'
WITH split(cleanName, ' ') AS parts
WHERE size(parts) > 1
WITH last(parts) AS surname
WHERE surname <> ''
RETURN surname, count(*) AS count
ORDER BY count DESC, surname ASC
LIMIT 10`

const QUERY_BIRTHPLACES = `MATCH (p:Person)
WHERE p.birthPlace IS NOT NULL AND trim(p.birthPlace) <> ''
RETURN p.birthPlace AS birthPlace, count(*) AS count
ORDER BY count DESC, birthPlace ASC
LIMIT 10`

const QUERY_LIFESPAN = `MATCH (p:Person)
WHERE p.birthYear IS NOT NULL AND p.birthYear =~ $yearPattern
  AND p.deathYear IS NOT NULL AND p.deathYear =~ $yearPattern
WITH toInteger(p.deathYear) - toInteger(p.birthYear) AS lifespan
WHERE lifespan >= 0
RETURN avg(lifespan) AS averageLifespan`

const QUERY_OLDEST = `MATCH (p:Person)
WHERE p.birthYear IS NOT NULL AND p.birthYear =~ $yearPattern
WITH p, toInteger(p.birthYear) AS birthYearInt
RETURN p.gedcomId AS gedcomId, p.name AS name, p.birthYear AS birthYear
ORDER BY birthYearInt ASC
LIMIT 1`

const QUERY_LARGEST_UNION = `MATCH (u:Union)-[:CHILD]->(c:Person)
WITH u, count(c) AS childCount
ORDER BY childCount DESC
LIMIT 1
OPTIONAL MATCH (parent:Person)-[:UNION]->(u)
RETURN u.gedcomId AS unionId, childCount, collect(parent.name) AS parents`

/**
 * Handles GET /api/stats.
 *
 * Returns a single aggregate snapshot of the whole dataset: totals, sex breakdown,
 * union count, births per decade, top surnames/birthplaces, average lifespan, the
 * oldest known ancestor, and the union with the most children.
 *
 * Public read access mirrors `GET /api/persons` (see issue #123): only aggregate
 * counts are exposed, no per-person detail beyond what a superlative requires.
 *
 * @returns A JSON {@link StatsResponse} on success, or the standard
 *          `neo4jErrorResponse` shape (500) on a Neo4j error.
 */
export async function GET() {
  try {
    const [totalsRows, unionRows, decadeRows, surnameRows, birthplaceRows, lifespanRows, oldestRows, largestUnionRows] =
      await Promise.all([
        read<{ totalPeople: number; male: number; female: number; unknown: number }>(
          QUERY_TOTALS
        ),
        read<{ unionCount: number }>(QUERY_UNIONS),
        read<DecadeCount>(QUERY_DECADES, { yearPattern: YEAR_PATTERN }),
        read<SurnameCount>(QUERY_SURNAMES),
        read<BirthplaceCount>(QUERY_BIRTHPLACES),
        read<{ averageLifespan: number | null }>(QUERY_LIFESPAN, { yearPattern: YEAR_PATTERN }),
        read<OldestAncestor>(QUERY_OLDEST, { yearPattern: YEAR_PATTERN }),
        read<{ unionId: string; childCount: number; parents: string[] }>(QUERY_LARGEST_UNION),
      ])

    const totals = totalsRows[0] ?? { totalPeople: 0, male: 0, female: 0, unknown: 0 }
    const { male, female, unknown } = totals

    const response: StatsResponse = {
      totalPeople: totals.totalPeople,
      sexBreakdown: { male, female, unknown },
      unionCount: unionRows[0]?.unionCount ?? 0,
      birthsByDecade: decadeRows,
      topSurnames: surnameRows,
      topBirthplaces: birthplaceRows,
      averageLifespan: lifespanRows[0]?.averageLifespan ?? null,
      oldestAncestor: oldestRows[0] ?? null,
      largestUnion: largestUnionRows[0] ?? null,
    }

    return NextResponse.json(response)
  } catch (err) {
    return neo4jErrorResponse(err, 'Failed to query graph database')
  }
}
