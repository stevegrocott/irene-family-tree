/**
 * @module api/person/[id]/photo
 * @description Authenticated endpoint for uploading a person's photo to Vercel Blob storage.
 * Route: POST /api/person/[id]/photo
 */

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import { auth } from '@/auth'

/** Forces the route to run in the Node.js runtime (required for @vercel/blob and multipart parsing). */
export const runtime = 'nodejs'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Handles POST /api/person/[id]/photo.
 *
 * Accepts a multipart/form-data request containing a `file` field with a
 * JPEG, PNG, or WebP image up to 5 MB, uploads it to Vercel Blob storage,
 * and returns its public URL.
 *
 * @param request - The incoming multipart/form-data request.
 * @param params - Route parameters containing the person's GEDCOM `id`.
 * @returns `{ url }` (200) on success, `{ error }` (401) when unauthenticated,
 *          or `{ error }` (400) when the upload is missing, not an image,
 *          an unsupported type, or too large.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const extension = ALLOWED_MIME_TYPES[file.type]
  if (!extension) {
    return NextResponse.json(
      { error: 'File must be a JPEG, PNG, or WebP image' },
      { status: 400 }
    )
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: 'File must be 5 MB or smaller' }, { status: 400 })
  }

  const pathname = `person-photos/${id}-${randomUUID()}.${extension}`

  let result: { url: string }
  try {
    result = await put(pathname, file, { access: 'public' })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Failed to upload photo', detail }, { status: 500 })
  }

  return NextResponse.json({ url: result.url })
}
