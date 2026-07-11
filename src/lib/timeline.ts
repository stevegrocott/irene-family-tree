/**
 * @fileoverview Derives a chronologically sorted life timeline from a person's
 * profile data — birth, marriages, children's births, and death — for
 * rendering in the person drawer's Timeline section.
 */

import type { MarriageDetail, PersonDetailResponse, PersonSummary } from '@/types/tree'

export type TimelineEventType = 'birth' | 'marriage' | 'child' | 'death'

/**
 * A single chronological event in a person's life timeline.
 */
export interface TimelineEvent {
  /** Kind of life event. */
  type: TimelineEventType
  /** Parsed four-digit year, or `null` when unknown/unparseable. */
  year: number | null
  /** `true` when no usable year could be determined; sorts into the trailing group. */
  dateUnknown: boolean
  /** Place associated with the event, or `null` if unknown. */
  place: string | null
  /** The related person (spouse for marriages, child for child births), or `null`. */
  person: PersonSummary | null
  /** Age at death, or `null` when not computable. Only set for `'death'` events. */
  age: number | null
}

const TYPE_ORDER: Record<TimelineEventType, number> = {
  birth: 0,
  marriage: 1,
  child: 2,
  death: 3,
}

function parseYear(year: string | null): number | null {
  if (year == null) return null
  const parsed = parseInt(year, 10)
  return Number.isNaN(parsed) ? null : parsed
}

function makeEvent(
  type: TimelineEventType,
  year: string | null,
  place: string | null,
  person: PersonSummary | null,
  age: number | null = null
): TimelineEvent {
  const parsed = parseYear(year)
  return { type, year: parsed, dateUnknown: parsed === null, place, person, age }
}

function marriageEvents(marriages: MarriageDetail[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const marriage of marriages) {
    events.push(makeEvent('marriage', marriage.marriageYear, marriage.marriagePlace, marriage.spouse))
    for (const child of marriage.children) {
      events.push(makeEvent('child', child.birthYear, null, child))
    }
  }
  return events
}

/**
 * Builds a chronologically sorted list of life events from a person's profile
 * data. Events without a usable year are not dropped — they sort into a
 * trailing "Date unknown" group instead.
 *
 * @param detail - Full person profile as returned by `GET /api/person/[id]`
 * @returns Timeline events sorted ascending by year, undated events last,
 *   with same-year events tied-broken as birth, marriage, child, death
 */
export function buildTimeline(detail: PersonDetailResponse): TimelineEvent[] {
  const events: TimelineEvent[] = []

  if (detail.birthYear !== null) {
    events.push(makeEvent('birth', detail.birthYear, detail.birthPlace, null))
  }

  events.push(...marriageEvents(detail.marriages))

  if (detail.deathYear !== null) {
    const birthYearNum = parseYear(detail.birthYear)
    const deathYearNum = parseYear(detail.deathYear)
    const age = birthYearNum !== null && deathYearNum !== null ? deathYearNum - birthYearNum : null
    events.push(makeEvent('death', detail.deathYear, detail.deathPlace, null, age))
  }

  return events.sort((a, b) => {
    if (a.dateUnknown !== b.dateUnknown) return a.dateUnknown ? 1 : -1
    if (!a.dateUnknown && a.year !== b.year) return (a.year as number) - (b.year as number)
    return TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
  })
}
