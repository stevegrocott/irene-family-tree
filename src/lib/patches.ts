export const ALLOWED_PATCH_FIELDS = [
  'name', 'sex', 'birthYear', 'birthDate', 'birthPlace',
  'deathYear', 'deathDate', 'deathPlace', 'occupation', 'notes',
  'photoUrl',
] as const

/**
 * Validates a `photoUrl` patch value: must be `null` or an `https://` URL.
 */
export function isValidPhotoUrl(value: unknown): boolean {
  if (value === null) return true
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
