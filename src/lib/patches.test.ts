/**
 * Unit tests for the PATCH field allowlist and photoUrl validation helper.
 */
import { ALLOWED_PATCH_FIELDS, isValidPhotoUrl } from './patches'

describe('ALLOWED_PATCH_FIELDS', () => {
  it('includes photoUrl', () => {
    expect(ALLOWED_PATCH_FIELDS).toContain('photoUrl')
  })
})

describe('isValidPhotoUrl', () => {
  it('accepts null', () => {
    expect(isValidPhotoUrl(null)).toBe(true)
  })

  it('accepts an https:// URL', () => {
    expect(isValidPhotoUrl('https://example.com/photo.jpg')).toBe(true)
  })

  it('rejects an http:// URL', () => {
    expect(isValidPhotoUrl('http://example.com/photo.jpg')).toBe(false)
  })

  it('rejects a non-URL string', () => {
    expect(isValidPhotoUrl('not-a-url')).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isValidPhotoUrl(undefined)).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(isValidPhotoUrl(123)).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidPhotoUrl('')).toBe(false)
  })
})
