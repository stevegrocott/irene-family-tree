import { NextResponse } from 'next/server'
import { read, neo4jErrorResponse } from '@/lib/neo4j'
import { auth } from '@/auth'
import {
  PERSON_QUERY,
  UNION_QUERY,
  SPOUSE_EDGES_QUERY,
  CHILD_EDGES_QUERY,
  mapPersonRecord,
  mapUnionRecord,
  mapRelRecord,
  buildGedcomDocument,
  type QueryRecord,
} from '@/lib/gedcom-export'

export const runtime = 'nodejs'

/**
 * Wraps a plain row object (as returned by `read()`) in the `.get(key)` interface
 * that the shared gedcom-export mappers expect, so the same mapper functions used
 * by the CLI's driver-session rows can be reused here without duplicating logic.
 */
function toQueryRecord(row: Record<string, unknown>): QueryRecord {
  return { get: key => row[key] }
}

/**
 * Streams the full family tree as a GEDCOM (.ged) file for admin download.
 *
 * Reuses the same query definitions, row mappers, and document assembly
 * (`src/lib/gedcom-export.ts`) as the `npm run export` CLI script, so the
 * app and the CLI can never drift from one another.
 *
 * @returns The GEDCOM document as `text/plain` with a dated attachment
 * filename, or an error response with status 401/403/500
 */
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let gedcom: string
  try {
    const [personRows, unionRows, spouseRows, childRows] = await Promise.all([
      read<Record<string, unknown>>(PERSON_QUERY),
      read<Record<string, unknown>>(UNION_QUERY),
      read<Record<string, unknown>>(SPOUSE_EDGES_QUERY),
      read<Record<string, unknown>>(CHILD_EDGES_QUERY),
    ])

    gedcom = buildGedcomDocument({
      persons: personRows.map(toQueryRecord).map(mapPersonRecord),
      unions: unionRows.map(toQueryRecord).map(mapUnionRecord),
      spouseRels: spouseRows.map(toQueryRecord).map(mapRelRecord),
      childRels: childRows.map(toQueryRecord).map(mapRelRecord),
    })
  } catch (err) {
    return neo4jErrorResponse(err, 'Failed to query graph database')
  }

  const dateStamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(gedcom, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="family-tree-${dateStamp}.ged"`,
    },
  })
}
