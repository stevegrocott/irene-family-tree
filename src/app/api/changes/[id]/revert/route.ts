import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { read } from '@/lib/neo4j'
import { revertChange } from '@/lib/revert'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const rows = await read<{ authorEmail: string }>(
    `MATCH (c:Change {id: $id}) RETURN c.authorEmail AS authorEmail`,
    { id }
  )
  if (!rows.length) {
    return NextResponse.json({ error: 'Change not found' }, { status: 404 })
  }

  const isAuthor = rows[0].authorEmail === session.user.email
  const isAdmin = session.user.role === 'admin'
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await revertChange(id, {
    email: session.user.email,
    name: session.user.name ?? session.user.email,
  })

  if (result.ok) {
    return NextResponse.json({ success: true })
  }
  return NextResponse.json(
    { error: result.error, conflictingChange: result.conflict },
    { status: result.status }
  )
}
