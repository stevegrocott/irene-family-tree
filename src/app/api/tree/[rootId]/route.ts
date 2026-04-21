import { getSubtree } from '@/lib/dataset'
import type { TreeResponse } from '@/types/tree'

const DEFAULT_DEPTH = 8
const MAX_DEPTH = 12

export async function GET(
  request: Request,
  { params }: { params: Promise<{ rootId: string }> }
) {
  const { rootId } = await params
  const url = new URL(request.url)
  const depth = Math.min(
    Math.max(parseInt(url.searchParams.get('depth') ?? String(DEFAULT_DEPTH), 10) || DEFAULT_DEPTH, 1),
    MAX_DEPTH,
  )

  const result = getSubtree(rootId, depth)
  if (!result) return Response.json({ error: 'Person not found' }, { status: 404 })

  return Response.json(result satisfies TreeResponse)
}
