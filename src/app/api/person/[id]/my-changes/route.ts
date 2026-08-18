import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { read } from '@/lib/neo4j'

export const runtime = 'nodejs'

type ChangeType = 'CREATE_PERSON' | 'ADD_RELATIONSHIP' | 'UPDATE_PERSON'

interface ChangeRow {
  id: string
  changeType: ChangeType
  targetId: string
  newValue: string
  previousValue: string | null
  appliedAt: string
}

interface ShapedChange {
  id: string
  changeType: ChangeType
  targetId: string
  newValue: Record<string, unknown>
  previousValue: Record<string, unknown> | null
  appliedAt: string
}

function parseJson(val: string | null): Record<string, unknown> | null {
  if (val == null) return null
  try {
    const parsed = JSON.parse(val)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function shape(row: ChangeRow): ShapedChange {
  return {
    id: row.id,
    changeType: row.changeType,
    targetId: row.targetId,
    newValue: parseJson(row.newValue) ?? {},
    previousValue: parseJson(row.previousValue),
    appliedAt: row.appliedAt,
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const email = session.user.email

  // Step 1: collect this person's union ids — BOTH directions.
  //
  // A person reaches their *spouse* union by an outgoing `UNION` edge, but their
  // *parents'* union by an incoming `CHILD` edge (see the parents match in
  // `person/[id]/route.ts`, which walks `(p)<-[:CHILD]-(pu:Union)<-[:UNION]-(parent)`).
  // Collecting only the outgoing direction silently drops every parent union, so
  // `ADD_RELATIONSHIP` changes against a parent were filtered out here and never
  // reached the client. `hasForeignConnections` then read every parent as foreign
  // and permanently disabled delete for a user who had created the person *and*
  // their parent links (issue #308).
  const unionRows = await read<{ unionId: string }>(
    `MATCH (p:Person {gedcomId: $id})-[:UNION]->(u:Union)
     RETURN DISTINCT u.gedcomId AS unionId
     UNION
     MATCH (p:Person {gedcomId: $id})<-[:CHILD]-(pu:Union)
     RETURN DISTINCT pu.gedcomId AS unionId`,
    { id }
  )
  const unionIds = new Set(unionRows.map(r => r.unionId).filter(Boolean))

  // Step 2: fetch candidate live changes authored by this user.
  // ADD_RELATIONSHIP is filtered broadly then narrowed to this person's unions in JS,
  // to avoid needing APOC (not guaranteed on Aura/Neo4j Community).
  const changeRows = await read<ChangeRow>(
    `MATCH (c:Change { status: 'live' })
     WHERE toLower(c.authorEmail) = toLower($email)
       AND ((c.changeType IN ['CREATE_PERSON','UPDATE_PERSON'] AND c.targetId = $id)
        OR c.changeType = 'ADD_RELATIONSHIP')
     RETURN c.id            AS id,
            c.changeType    AS changeType,
            c.targetId      AS targetId,
            c.newValue      AS newValue,
            c.previousValue AS previousValue,
            c.appliedAt     AS appliedAt
     ORDER BY c.appliedAt DESC`,
    { email, id }
  )

  const creates: ShapedChange[] = []
  const updates: ShapedChange[] = []
  const rels: ShapedChange[] = []

  for (const row of changeRows) {
    const shaped = shape(row)
    if (row.changeType === 'CREATE_PERSON') {
      creates.push(shaped)
    } else if (row.changeType === 'UPDATE_PERSON') {
      updates.push(shaped)
    } else if (row.changeType === 'ADD_RELATIONSHIP') {
      const unionId = shaped.newValue.unionId
      if (typeof unionId === 'string' && unionIds.has(unionId)) {
        rels.push(shaped)
      }
    }
  }

  return NextResponse.json({
    createChange: creates[0] ?? null,
    relationshipChanges: rels,
    updateChanges: updates,
  })
}
