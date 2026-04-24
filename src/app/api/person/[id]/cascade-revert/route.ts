import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { cascadeRevertPerson } from '@/lib/cascade-revert'

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

  const result = await cascadeRevertPerson(id, {
    email: session.user.email,
    name: session.user.name ?? session.user.email,
    isAdmin: session.user.role === 'admin',
  })

  if (result.ok) {
    return NextResponse.json({ success: true, unionsReverted: result.unionsReverted })
  }
  return NextResponse.json(
    { error: result.error, blockedBy: result.blockedBy },
    { status: result.status }
  )
}
