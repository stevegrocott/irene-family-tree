import { getPersonDetail } from '@/lib/dataset'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const detail = getPersonDetail(id)
  if (!detail) return Response.json({ error: 'Person not found' }, { status: 404 })
  return Response.json(detail)
}
