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

  // Step 1: collect this person's union ids.
  const unionRows = await read<{ unionId: string }>(
    `MATCH (p:Person {gedcomId: $id})-[:UNION]->(u:Union)
     RETURN DISTINCT u.gedcomId AS unionId`,
    { id }
  )
  const unionIds = new Set(unionRows.map(r => r.unionId).filter(Boolean))

  // Step 2: fetch candidate live changes authored by this user.
  // ADD_RELATIONSHIP is filtered broadly then narrowed to this person's unions in JS,
  // to avoid needing APOC (not guaranteed on Aura/Neo4j Community).
  const changeRows = await read<ChangeRow>(
    `MATCH (c:Change { status: 'live', authorEmail: $email })
     WHERE (c.changeType IN ['CREATE_PERSON','UPDATE_PERSON'] AND c.targetId = $id)
        OR c.changeType = 'ADD_RELATIONSHIP'
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
