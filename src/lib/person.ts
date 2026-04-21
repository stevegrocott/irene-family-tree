/**
 * @fileoverview Utility functions for formatting person data for display.
 */

/**
 * Formats a person's lifespan as a human-readable date string.
 *
 * Returns `"YYYY–YYYY"` when both years are known, `"b. YYYY"` for birth-only,
 * `"d. YYYY"` for death-only, and an empty string when neither is available.
 *
 * @param r - Object containing optional birth and death year strings
 * @param r.birthYear - Four-digit birth year, or `null`/`undefined` if unknown
 * @param r.deathYear - Four-digit death year, or `null`/`undefined` if unknown
 * @returns Formatted lifespan string, or `''` if no dates are available
 */
export function formatLifespan(r: { birthYear?: string | null; deathYear?: string | null }): string {
  const b = r.birthYear ?? ''
  const d = r.deathYear ?? ''
  if (b && d) return `${b}–${d}`
  if (b) return `b. ${b}`
  if (d) return `d. ${d}`
  return ''
}
