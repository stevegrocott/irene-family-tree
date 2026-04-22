import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { read } from '@/lib/neo4j'
import { SuggestionsReview } from './SuggestionsReview'
import type { Change } from './types'

const PAGE_SIZE = 20

interface PendingChangeRow {
  id: string
  changeType: string
  authorName: string
  authorEmail: string
  payload: string | null
  status: string
  createdAt: string | null
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

  let suggestions: Change[] = []
  try {
    const rows = await read<PendingChangeRow>(
      `MATCH (c:PendingChange {status: 'pending'})
       RETURN c.id          AS id,
              c.changeType  AS changeType,
              c.authorName  AS authorName,
              c.authorEmail AS authorEmail,
              c.payload     AS payload,
              c.status      AS status,
              c.createdAt   AS createdAt
       ORDER BY c.createdAt DESC
       SKIP $skip LIMIT $limit`,
      { skip: 0, limit: PAGE_SIZE }
    )
    suggestions = rows.map(row => {
      const parsedPayload = safeParseJson(row.payload) ?? {}
      const { targetId, ...newValueFields } = parsedPayload as { targetId?: string } & Record<string, unknown>
      return {
        id: row.id,
        changeType: row.changeType as Change['changeType'],
        targetId: targetId ?? '',
        personName: '',
        authorName: row.authorName,
        authorEmail: row.authorEmail,
        previousValue: null,
        newValue: newValueFields,
        appliedAt: row.createdAt ?? '',
        status: row.status,
      }
    })
  } catch {
    // Render with empty list; the component shows a friendly message
  }

  return (
    <main className="min-h-screen bg-[#050a18] text-white px-4 py-8 sm:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-white">Pending Suggestions</h1>
          <p className="text-white/50 text-sm mt-1">
            Review suggested edits from contributors. Approve to apply changes or decline to dismiss them.
          </p>
        </div>
        <SuggestionsReview initialSuggestions={suggestions} />
      </div>
    </main>
  )
}
