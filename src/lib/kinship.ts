/**
 * @fileoverview Pure step-sequence to English kinship label helper.
 *
 * Converts a shortest path between two people, expressed as a sequence of
 * parent/child/spouse hops over the UNION/CHILD graph, into a
 * human-readable relationship label (e.g. "second cousin once removed").
 */

export type Sex = 'M' | 'F' | null | undefined

export type StepType = 'parent' | 'child' | 'spouse'

export interface KinshipStep {
  /** Direction of this hop relative to the person taking the previous step. */
  type: StepType
  /** Sex of the person arrived at after this step. */
  sex?: Sex
  /** Optional display name of the person arrived at after this step. */
  name?: string
}

function sexWord(sex: Sex, male: string, female: string, neutral: string): string {
  if (sex === 'M') return male
  if (sex === 'F') return female
  return neutral
}

/** Builds a "grand"/"great-grand" prefix for a given generation level (0 = none). */
function grandPrefix(level: number): string {
  if (level <= 0) return ''
  if (level === 1) return 'grand'
  return `great-`.repeat(level - 1) + 'grand'
}

/** Builds a "great-" prefix (no "grand") for a given generation level (0 = none). */
function greatPrefix(level: number): string {
  if (level <= 0) return ''
  return 'great-'.repeat(level)
}

const ORDINAL_WORDS = [
  'zeroth',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
]

function ordinal(n: number): string {
  if (n >= 0 && n < ORDINAL_WORDS.length) return ORDINAL_WORDS[n]
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

function removalSuffix(removal: number): string {
  if (removal === 0) return ''
  if (removal === 1) return ' once removed'
  if (removal === 2) return ' twice removed'
  return ` ${removal} times removed`
}

function countGenerations(steps: KinshipStep[]): { up: number; down: number } {
  let up = 0
  let down = 0
  for (const step of steps) {
    if (step.type === 'parent') up++
    else if (step.type === 'child') down++
  }
  return { up, down }
}

/**
 * Labels a purely blood (parent/child only) relationship given the number
 * of generations up to the common ancestor and down to the target.
 */
function bloodRelationLabel(up: number, down: number, sex: Sex): string {
  if (up === 0 && down === 0) return 'self'

  if (down === 0) {
    const level = up - 1
    const term = sexWord(sex, 'father', 'mother', 'parent')
    return level === 0 ? term : grandPrefix(level) + term
  }

  if (up === 0) {
    const level = down - 1
    const term = sexWord(sex, 'son', 'daughter', 'child')
    return level === 0 ? term : grandPrefix(level) + term
  }

  if (up === 1 && down === 1) {
    return sexWord(sex, 'brother', 'sister', 'sibling')
  }

  if (up === 1 && down >= 2) {
    const level = down - 2
    const term = sexWord(sex, 'nephew', 'niece', 'nibling')
    return level === 0 ? term : grandPrefix(level) + term
  }

  if (down === 1 && up >= 2) {
    const level = up - 2
    const term = sexWord(sex, 'uncle', 'aunt', 'aunt/uncle')
    return greatPrefix(level) + term
  }

  const degree = Math.min(up, down) - 1
  const removal = Math.abs(up - down)
  return `${ordinal(degree)} cousin${removalSuffix(removal)}`
}

/**
 * Labels the spouse of a blood relative ("theirs"), or a blood relative of
 * a spouse ("spouses"), using conventional in-law/step terminology for the
 * common cases and a "by marriage" fallback otherwise.
 */
function inLawLabel(up: number, down: number, sex: Sex, direction: 'theirs' | 'spouses'): string {
  if (up === 1 && down === 0) {
    return direction === 'theirs'
      ? sexWord(sex, 'stepfather', 'stepmother', 'step-parent')
      : sexWord(sex, 'father-in-law', 'mother-in-law', 'parent-in-law')
  }

  if (up === 0 && down === 1) {
    return direction === 'theirs'
      ? sexWord(sex, 'son-in-law', 'daughter-in-law', 'child-in-law')
      : sexWord(sex, 'stepson', 'stepdaughter', 'stepchild')
  }

  if (up === 1 && down === 1) {
    return sexWord(sex, 'brother-in-law', 'sister-in-law', 'sibling-in-law')
  }

  return `${bloodRelationLabel(up, down, sex)} by marriage`
}

/**
 * Converts a kinship step sequence into an English relationship label.
 *
 * Supports direct blood relations (parent/child, grandparent/grandchild
 * with great- prefixes, sibling, uncle/aunt, niece/nephew, and a
 * generalized Nth-cousin-M-times-removed formula), a direct spouse, and
 * simple in-law/step fallbacks for a single spouse hop at either end of an
 * otherwise blood path. Anything else (a spouse hop mid-path, or more than
 * one spouse hop) falls back to "distant relative (N steps)".
 *
 * @param steps - Ordered hops from the source person to the target person
 * @returns A human-readable relationship label, e.g. "second cousin once removed"
 */
export function computeKinshipLabel(steps: KinshipStep[]): string {
  if (steps.length === 0) return 'self'

  const spouseIndices: number[] = []
  steps.forEach((step, i) => {
    if (step.type === 'spouse') spouseIndices.push(i)
  })

  const targetSex = steps[steps.length - 1].sex

  if (spouseIndices.length === 0) {
    const { up, down } = countGenerations(steps)
    return bloodRelationLabel(up, down, targetSex)
  }

  if (spouseIndices.length === 1 && steps.length === 1) {
    return sexWord(targetSex, 'husband', 'wife', 'spouse')
  }

  if (spouseIndices.length === 1) {
    const spouseIndex = spouseIndices[0]

    if (spouseIndex === steps.length - 1) {
      const { up, down } = countGenerations(steps.slice(0, -1))
      return inLawLabel(up, down, targetSex, 'theirs')
    }

    if (spouseIndex === 0) {
      const { up, down } = countGenerations(steps.slice(1))
      return inLawLabel(up, down, targetSex, 'spouses')
    }
  }

  return `distant relative (${steps.length} steps)`
}
