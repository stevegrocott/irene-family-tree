import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { read } from '@/lib/neo4j'
import { ChangesReview } from './ChangesReview'
import type { Change } from './types'

const PAGE_SIZE = 20

interface ChangeRow {
  id: string
  changeType: string
  targetId: string
  personName: string | null
  authorName: string
  authorEmail: string
  previousValue: string | null
  newValue: string
  appliedAt: string
  status: string
}

function safeParseJson(val: unknown): Record<string, unknown> | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'object') return val as Record<string, unknown>
  try { return JSON.parse(val as string) } catch { return null }
}

export default async function AdminPage() {
  const session = await auth()
  if (!session || session.user?.role !== 'admin') {
    redirect('/api/auth/signin?callbackUrl=/admin')
  }

  let changes: Change[] = []
  try {
    const rows = await read<ChangeRow>(
      `MATCH (c:Change {status: 'live'})
       OPTIONAL MATCH (p:Person {gedcomId: c.targetId})
       RETURN c.id            AS id,
              c.changeType    AS changeType,
              c.targetId      AS targetId,
              p.name          AS personName,
              c.authorName    AS authorName,
              c.authorEmail   AS authorEmail,
              c.previousValue AS previousValue,
              c.newValue      AS newValue,
              c.appliedAt     AS appliedAt,
              c.status        AS status
       ORDER BY c.appliedAt DESC
       SKIP $skip LIMIT $limit`,
      { skip: 0, limit: PAGE_SIZE }
    )
    changes = rows.map(row => ({
      ...row,
      personName: row.personName ?? '',
      previousValue: safeParseJson(row.previousValue),
      newValue: safeParseJson(row.newValue) ?? {},
    })) as Change[]
  } catch {
    // Render with empty list; the component shows a friendly message
  }

  return (
    <main className="min-h-screen bg-[#050a18] text-white px-4 py-8 sm:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-white">Pending Changes</h1>
          <p className="text-white/50 text-sm mt-1">
            Review edits submitted by contributors. Keep approved changes or revert them to the previous values.
          </p>
        </div>
        <ChangesReview initialChanges={changes} />
      </div>
    </main>
  )
}
