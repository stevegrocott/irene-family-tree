import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { mergePersons } from '@/lib/merge-person'

export const runtime = 'nodejs'

/**
 * Merges a duplicate Person record into its survivor.
 *
 * Requires admin authentication. Validates that `survivorId` and
 * `duplicateId` are present, non-empty strings, then delegates to
 * {@link mergePersons} for the distinct/existence checks (400 when the ids
 * are the same, 404 when either person cannot be found) and the merge
 * itself.
 *
 * @async
 * @param {Request} request - HTTP request with JSON body `{ survivorId, duplicateId }`
 * @returns {Promise<NextResponse<{success: true; survivorId: string} | {error: string}>>}
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { survivorId, duplicateId } = body
  if (
    typeof survivorId !== 'string' || !survivorId ||
    typeof duplicateId !== 'string' || !duplicateId
  ) {
    return NextResponse.json(
      { error: 'survivorId and duplicateId are required strings' },
      { status: 400 }
    )
  }

  const email = session.user.email ?? 'anonymous'
  const name = session.user.name ?? email

  const result = await mergePersons(survivorId, duplicateId, { email, name })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true, survivorId: result.survivorId })
}
