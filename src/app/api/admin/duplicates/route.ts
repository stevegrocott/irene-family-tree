import { NextResponse } from 'next/server'
import { read, neo4jErrorResponse } from '@/lib/neo4j'
import { auth } from '@/auth'

export const runtime = 'nodejs'

/** Maximum number of duplicate pairs returned in a single response. */
const LIMIT = 50

/** Birth years must match this pattern before being compared numerically. */
const YEAR_PATTERN = '[0-9]{3,4}'

/**
 * Cypher query that finds candidate duplicate Person pairs:
 * - Names match after trimming and case-folding.
 * - Birth years are either both absent, or both present, well-formed, and
 *   within 2 years of each other.
 * - `p1.gedcomId < p2.gedcomId` guarantees each unordered pair appears once.
 */
const QUERY_DUPLICATES = `MATCH (p1:Person), (p2:Person)
WHERE p1.gedcomId < p2.gedcomId
  AND p1.name IS NOT NULL AND p2.name IS NOT NULL
  AND trim(toLower(p1.name)) <> ''
  AND trim(toLower(p1.name)) = trim(toLower(p2.name))
  AND (
    (p1.birthYear IS NULL AND p2.birthYear IS NULL)
    OR (
      p1.birthYear IS NOT NULL AND p2.birthYear IS NOT NULL
      AND p1.birthYear =~ $yearPattern AND p2.birthYear =~ $yearPattern
      AND abs(toInteger(p1.birthYear) - toInteger(p2.birthYear)) <= 2
    )
  )
RETURN p1.gedcomId    AS gedcomId1,
       p1.name        AS name1,
       p1.sex         AS sex1,
       p1.birthYear   AS birthYear1,
       p1.deathYear   AS deathYear1,
       p1.birthPlace  AS birthPlace1,
       p1.deathPlace  AS deathPlace1,
       p1.occupation  AS occupation1,
       p1.notes       AS notes1,
       p2.gedcomId    AS gedcomId2,
       p2.name        AS name2,
       p2.sex         AS sex2,
       p2.birthYear   AS birthYear2,
       p2.deathYear   AS deathYear2,
       p2.birthPlace  AS birthPlace2,
       p2.deathPlace  AS deathPlace2,
       p2.occupation  AS occupation2,
       p2.notes       AS notes2
LIMIT $limit`

/** Scalar Person fields returned for each side of a duplicate pair. */
interface DuplicatePersonSide {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  deathYear: string | null
  birthPlace: string | null
  deathPlace: string | null
  occupation: string | null
  notes: string | null
}

/** Raw row shape returned by {@link QUERY_DUPLICATES}. */
interface DuplicatePairRow {
  gedcomId1: string
  name1: string
  sex1: string | null
  birthYear1: string | null
  deathYear1: string | null
  birthPlace1: string | null
  deathPlace1: string | null
  occupation1: string | null
  notes1: string | null
  gedcomId2: string
  name2: string
  sex2: string | null
  birthYear2: string | null
  deathYear2: string | null
  birthPlace2: string | null
  deathPlace2: string | null
  occupation2: string | null
  notes2: string | null
}

/**
 * Fetches candidate duplicate person pairs for admin review.
 *
 * Requires admin authentication. Two Person records are considered a
 * candidate duplicate when their names match (case- and whitespace-
 * insensitive) and their birth years are either both unknown or within 2
 * years of each other. Results are capped at {@link LIMIT} pairs.
 *
 * @async
 * @returns {Promise<NextResponse<{duplicates: Object[]}>>} JSON response with an array of `{ person1, person2 }` pairs
 */
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let rows: DuplicatePairRow[]
  try {
    rows = await read<DuplicatePairRow>(QUERY_DUPLICATES, {
      yearPattern: YEAR_PATTERN,
      limit: LIMIT,
    })
  } catch (err) {
    return neo4jErrorResponse(err, 'Failed to query graph database')
  }

  const duplicates = rows.map(row => ({
    person1: {
      gedcomId: row.gedcomId1,
      name: row.name1,
      sex: row.sex1,
      birthYear: row.birthYear1,
      deathYear: row.deathYear1,
      birthPlace: row.birthPlace1,
      deathPlace: row.deathPlace1,
      occupation: row.occupation1,
      notes: row.notes1,
    } satisfies DuplicatePersonSide,
    person2: {
      gedcomId: row.gedcomId2,
      name: row.name2,
      sex: row.sex2,
      birthYear: row.birthYear2,
      deathYear: row.deathYear2,
      birthPlace: row.birthPlace2,
      deathPlace: row.deathPlace2,
      occupation: row.occupation2,
      notes: row.notes2,
    } satisfies DuplicatePersonSide,
  }))

  return NextResponse.json({ duplicates })
}
