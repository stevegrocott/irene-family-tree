/**
 * @fileoverview Privacy redaction helpers for likely-living persons.
 */

export interface Person {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  deathYear: string | null
  birthDate?: string | null
  deathDate?: string | null
  birthPlace: string | null
  deathPlace: string | null
  occupation: string | null
  notes: string | null
  isLiving?: boolean
}

export interface RedactedPerson {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: null
  deathYear: null
  birthDate: null
  deathDate: null
  birthPlace: null
  deathPlace: null
  occupation: null
  notes: null
  living: true
}

const LIVING_AGE_THRESHOLD_YEARS = 105

/**
 * Determines whether a person is likely still living and should be redacted.
 *
 * Death fields (deathYear, deathDate, deathPlace) always indicate not living.
 * An unknown birth year with no death fields fails safe as living. The
 * `isLiving` field, when explicitly set, overrides all other checks.
 *
 * @param person - Person record to evaluate
 * @returns `true` if the person is likely living, `false` otherwise
 */
export function isLikelyLiving(person: Person): boolean {
  if (typeof person.isLiving === 'boolean') return person.isLiving

  if (person.deathYear || person.deathDate || person.deathPlace) return false

  if (!person.birthYear) return true

  const age = new Date().getFullYear() - Number(person.birthYear)
  return age <= LIVING_AGE_THRESHOLD_YEARS
}

/**
 * Redacts sensitive fields from a likely-living person, keeping only the
 * identity fields needed for tree display.
 *
 * @param person - Person record to redact
 * @returns A redacted copy with sensitive fields nulled and `living: true` set
 */
export function redactPerson(person: Person): RedactedPerson {
  return {
    gedcomId: person.gedcomId,
    name: person.name,
    sex: person.sex,
    birthYear: null,
    deathYear: null,
    birthDate: null,
    deathDate: null,
    birthPlace: null,
    deathPlace: null,
    occupation: null,
    notes: null,
    living: true,
  }
}
