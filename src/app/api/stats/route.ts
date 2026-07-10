/**
 * @module api/stats
 * @description Public REST endpoint that returns aggregate statistics for the whole
 * GEDCOM dataset — totals, trends, and superlatives — computed server-side with a
 * handful of read-only Cypher aggregations.
 * Route: GET /api/stats
 */

import { NextResponse } from 'next/server'
import { read, neo4jErrorResponse } from '@/lib/neo4j'

/** Forces the route to run in the Node.js runtime (required for Neo4j driver). */
export const runtime = 'nodejs'

/** Breakdown of persons by recorded biological sex. */
interface SexBreakdown {
  male: number
  female: number
  unknown: number
}

/** Number of births recorded in a given decade (e.g. `1950` covers 1950-1959). */
interface DecadeCount {
  decade: number
  count: number
}

/** Number of persons sharing a derived surname. */
interface SurnameCount {
  surname: string
  count: number
}

/** Number of persons sharing a recorded birthplace. */
interface BirthplaceCount {
  birthPlace: string
  count: number
}

/** The earliest-born person with a known birth year. */
interface OldestAncestor {
  gedcomId: string
  name: string
  birthYear: string
}

/** The union (marriage/partnership) with the most recorded children. */
interface LargestUnion {
  unionId: string
  childCount: number
  parents: string[]
}

/**
 * Aggregate statistics payload returned by `GET /api/stats`.
 */
interface StatsResponse {
  /** Total number of persons in the graph. */
  totalPeople: number
  /** Count of persons by recorded sex. */
  sexBreakdown: SexBreakdown
  /** Total number of unions (marriages/partnerships) in the graph. */
  unionCount: number
  /** Births bucketed by decade, ordered chronologically. Excludes persons with missing/non-numeric birth years. */
  birthsByDecade: DecadeCount[]
  /** Top 10 surnames by frequency, derived as the last whitespace-separated token of `name`. */
  topSurnames: SurnameCount[]
  /** Top 10 birthplaces by frequency. */
  topBirthplaces: BirthplaceCount[]
  /** Average lifespan in years across persons with both a known birth and death year, or `null` if none qualify. */
  averageLifespan: number | null
  /** The person with the earliest known birth year, or `null` if no birth years are recorded. */
  oldestAncestor: OldestAncestor | null
  /** The union with the most recorded children, or `null` if no unions have children. */
  largestUnion: LargestUnion | null
}

/** Regex fragment matching a plausible 3-4 digit year string (Cypher performs a full-string match). */
const YEAR_PATTERN = '[0-9]{3,4}'

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
          `MATCH (p:Person)
           RETURN count(p) AS totalPeople,
                  sum(CASE WHEN p.sex = 'M' THEN 1 ELSE 0 END) AS male,
                  sum(CASE WHEN p.sex = 'F' THEN 1 ELSE 0 END) AS female,
                  sum(CASE WHEN p.sex IS NULL OR NOT p.sex IN ['M', 'F'] THEN 1 ELSE 0 END) AS unknown`
        ),
        read<{ unionCount: number }>('MATCH (u:Union) RETURN count(u) AS unionCount'),
        read<DecadeCount>(
          `MATCH (p:Person)
           WHERE p.birthYear IS NOT NULL AND p.birthYear =~ $yearPattern
           WITH (toInteger(p.birthYear) / 10) * 10 AS decade
           RETURN decade, count(*) AS count
           ORDER BY decade ASC`,
          { yearPattern: YEAR_PATTERN }
        ),
        read<SurnameCount>(
          `MATCH (p:Person)
           WHERE p.name IS NOT NULL AND trim(p.name) <> '' AND p.name <> '[Unknown]'
           WITH split(trim(p.name), ' ') AS parts
           WHERE size(parts) > 1
           WITH last(parts) AS surname
           WHERE surname <> ''
           RETURN surname, count(*) AS count
           ORDER BY count DESC, surname ASC
           LIMIT 10`
        ),
        read<BirthplaceCount>(
          `MATCH (p:Person)
           WHERE p.birthPlace IS NOT NULL AND trim(p.birthPlace) <> ''
           RETURN p.birthPlace AS birthPlace, count(*) AS count
           ORDER BY count DESC, birthPlace ASC
           LIMIT 10`
        ),
        read<{ averageLifespan: number | null }>(
          `MATCH (p:Person)
           WHERE p.birthYear IS NOT NULL AND p.birthYear =~ $yearPattern
             AND p.deathYear IS NOT NULL AND p.deathYear =~ $yearPattern
           WITH toInteger(p.deathYear) - toInteger(p.birthYear) AS lifespan
           WHERE lifespan >= 0
           RETURN avg(lifespan) AS averageLifespan`,
          { yearPattern: YEAR_PATTERN }
        ),
        read<OldestAncestor>(
          `MATCH (p:Person)
           WHERE p.birthYear IS NOT NULL AND p.birthYear =~ $yearPattern
           RETURN p.gedcomId AS gedcomId, p.name AS name, p.birthYear AS birthYear
           ORDER BY toInteger(p.birthYear) ASC
           LIMIT 1`,
          { yearPattern: YEAR_PATTERN }
        ),
        read<{ unionId: string; childCount: number; parents: string[] }>(
          `MATCH (u:Union)-[:CHILD]->(c:Person)
           WITH u, count(c) AS childCount
           ORDER BY childCount DESC
           LIMIT 1
           OPTIONAL MATCH (parent:Person)-[:UNION]->(u)
           RETURN u.gedcomId AS unionId, childCount, collect(parent.name) AS parents`
        ),
      ])

    const totals = totalsRows[0] ?? { totalPeople: 0, male: 0, female: 0, unknown: 0 }

    const response: StatsResponse = {
      totalPeople: totals.totalPeople,
      sexBreakdown: { male: totals.male, female: totals.female, unknown: totals.unknown },
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
