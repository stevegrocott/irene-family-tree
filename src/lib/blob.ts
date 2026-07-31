/**
 * Normalises a full Vercel Blob URL or a bare pathname to a store-relative
 * pathname (e.g. `person-photos/foo-uuid.jpg`), so callers can compare
 * `Person.photoUrl` values against `list()` results without caring which
 * form either side is in.
 */
export function blobPathname(url: unknown): string | null {
  if (typeof url !== 'string') return null

  const trimmed = url.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed).pathname.replace(/^\/+/, '') || null
  } catch {
    return trimmed.replace(/^\/+/, '') || null
  }
}
