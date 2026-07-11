import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { read } from '@/lib/neo4j'
import { safeParseJson } from '@/lib/utils'
import { SuggestionsReview } from './SuggestionsReview'
import { ChangeHistory } from './ChangeHistory'
import { AdminTabs } from './AdminTabs'
import type { Change } from './types'

const PAGE_SIZE = 20

/** Raw Neo4j row returned by the pending-changes query. */
interface PendingChangeRow {
  id: string
  changeType: string
  authorName: string
  authorEmail: string
  /** JSON-serialised change payload, or null if not yet stored. */
  payload: string | null
  /** Resolved from the linked Person node; null when the node cannot be found. */
  personName: string | null
  status: string
  createdAt: string | null
}

/**
 * Server component for `/admin`.
 *
 * Redirects unauthenticated or non-admin visitors to the sign-in page,
 * fetches the first page of pending suggestions from Neo4j, and renders
 * the tabbed admin UI with the data pre-loaded.
 */
export default async function AdminPage() {
  const session = await auth()
  if (!session || session.user?.role !== 'admin') {
    redirect('/api/auth/signin?callbackUrl=/admin')
  }

  let suggestions: Change[] = []
  try {
    const rows = await read<PendingChangeRow>(
      `MATCH (c:PendingChange {status: 'pending'})
       OPTIONAL MATCH (p:Person {gedcomId: c.targetId})
       RETURN c.id          AS id,
              c.changeType  AS changeType,
              c.authorName  AS authorName,
              c.authorEmail AS authorEmail,
              c.payload     AS payload,
              coalesce(p.name, c.targetId, '') AS personName,
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
        personName: row.personName ?? '',
        authorName: row.authorName,
        authorEmail: row.authorEmail,
        previousValue: null,
        newValue: newValueFields,
        appliedAt: row.createdAt ?? '',
        status: row.status,
      }
    })
  } catch (err) {
    console.error('Failed to fetch pending suggestions:', err)
  }

  return (
    <main className="min-h-screen bg-[#050a18] text-white px-4 py-8 sm:px-8">
      <div className="max-w-2xl mx-auto">
        <AdminTabs
          suggestionsSlot={<SuggestionsReview initialSuggestions={suggestions} />}
          historySlot={<ChangeHistory />}
        />
      </div>
    </main>
  )
}
