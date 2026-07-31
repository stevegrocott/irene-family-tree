/**
 * Unit tests for the blob pathname normalisation helper.
 */
import { blobPathname } from './blob'

describe('blobPathname', () => {
  it('extracts the pathname from a full blob URL', () => {
    expect(
      blobPathname('https://abc123.public.blob.vercel-storage.com/person-photos/foo-uuid.jpg')
    ).toBe('person-photos/foo-uuid.jpg')
  })

  it('returns an already-relative pathname unchanged', () => {
    expect(blobPathname('person-photos/foo-uuid.jpg')).toBe('person-photos/foo-uuid.jpg')
  })

  it('strips a leading slash from a relative pathname', () => {
    expect(blobPathname('/person-photos/foo-uuid.jpg')).toBe('person-photos/foo-uuid.jpg')
  })

  it('returns null for an empty string', () => {
    expect(blobPathname('')).toBeNull()
  })

  it('returns null for a whitespace-only string', () => {
    expect(blobPathname('   ')).toBeNull()
  })

  it('returns null for a URL with no pathname', () => {
    expect(blobPathname('https://example.com')).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(blobPathname(null)).toBeNull()
    expect(blobPathname(undefined)).toBeNull()
    expect(blobPathname(123)).toBeNull()
  })
})
