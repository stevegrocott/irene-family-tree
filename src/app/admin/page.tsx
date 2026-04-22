import { redirect } from 'next/navigation'
import { headers, cookies } from 'next/headers'
import { auth } from '@/auth'
import { ChangesReview } from './ChangesReview'

interface Change {
  id: string
  changeType: 'edit_person' | 'add_person' | 'add_relationship'
  targetId: string
  personName: string
  authorName: string
  authorEmail: string
  previousValue: Record<string, unknown> | null
  newValue: Record<string, unknown>
  appliedAt: string
  status: string
}

export default async function AdminPage() {
  const session = await auth()
  if (!session || session.user?.role !== 'admin') {
    redirect('/api/auth/signin?callbackUrl=/admin')
  }

  const headersList = await headers()
  const host = headersList.get('host') ?? 'localhost:3000'
  const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ')

  let changes: Change[] = []
  try {
    const res = await fetch(`${proto}://${host}/api/admin/changes`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      changes = data.changes ?? []
    }
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
