import { buildTimeline } from './timeline'
import type { PersonDetailResponse, PersonSummary } from '@/types/tree'

function summary(overrides: Partial<PersonSummary> = {}): PersonSummary {
  return {
    gedcomId: '@I2@',
    name: 'Jane Doe',
    sex: 'F',
    birthYear: null,
    deathYear: null,
    ...overrides,
  }
}

function detail(overrides: Partial<PersonDetailResponse> = {}): PersonDetailResponse {
  return {
    gedcomId: '@I1@',
    name: 'John Doe',
    sex: 'M',
    birthYear: null,
    deathYear: null,
    birthPlace: null,
    deathPlace: null,
    occupation: null,
    notes: null,
    parents: [],
    siblings: [],
    marriages: [],
    ...overrides,
  }
}

describe('buildTimeline — chronological sort', () => {
  it('sorts birth, marriage, child births, and death ascending by year regardless of input order', () => {
    const events = buildTimeline(
      detail({
        birthYear: '1850',
        birthPlace: 'Boston',
        deathYear: '1920',
        deathPlace: 'Boston',
        marriages: [
          {
            unionId: '@F1@',
            marriageYear: '1875',
            marriagePlace: 'Boston',
            spouse: summary({ gedcomId: '@I2@', name: 'Mary Doe' }),
            children: [summary({ gedcomId: '@I3@', name: 'Child Doe', birthYear: '1878' })],
          },
        ],
      })
    )

    const years = events.map((e) => e.year)
    expect(years).toEqual([1850, 1875, 1878, 1920])
  })
})

describe('buildTimeline — type tiebreak', () => {
  it('orders same-year events as birth, marriage, child, death', () => {
    const events = buildTimeline(
      detail({
        birthYear: '1900',
        deathYear: '1900',
        marriages: [
          {
            unionId: '@F1@',
            marriageYear: '1900',
            marriagePlace: null,
            spouse: summary({ gedcomId: '@I2@' }),
            children: [summary({ gedcomId: '@I3@', birthYear: '1900' })],
          },
        ],
      })
    )

    expect(events.map((e) => e.type)).toEqual(['birth', 'marriage', 'child', 'death'])
  })
})

describe('buildTimeline — age at death', () => {
  it('computes age at death when both birth and death years are parseable', () => {
    const events = buildTimeline(detail({ birthYear: '1830', deathYear: '1892' }))
    const deathEvent = events.find((e) => e.type === 'death')

    expect(deathEvent?.age).toBe(62)
  })

  it('leaves age null when birth year is missing', () => {
    const events = buildTimeline(detail({ birthYear: null, deathYear: '1892' }))
    const deathEvent = events.find((e) => e.type === 'death')

    expect(deathEvent?.age).toBeNull()
  })

  it('leaves age null when death year is unparseable', () => {
    const events = buildTimeline(detail({ birthYear: '1830', deathYear: 'unknown' }))
    const deathEvent = events.find((e) => e.type === 'death')

    expect(deathEvent?.age).toBeNull()
  })
})

describe('buildTimeline — undated events', () => {
  it('routes null years to the trailing Date unknown group instead of dropping them', () => {
    const events = buildTimeline(
      detail({
        birthYear: '1900',
        marriages: [
          {
            unionId: '@F1@',
            marriageYear: null,
            marriagePlace: null,
            spouse: summary({ gedcomId: '@I2@' }),
            children: [],
          },
        ],
      })
    )

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'birth', year: 1900, dateUnknown: false })
    expect(events[1]).toMatchObject({ type: 'marriage', year: null, dateUnknown: true })
  })

  it('routes non-numeric years to the trailing Date unknown group without producing NaN ordering', () => {
    const events = buildTimeline(
      detail({
        birthYear: '1900',
        deathYear: 'Abt. 1970',
      })
    )

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'birth', year: 1900 })
    expect(events[1]).toMatchObject({ type: 'death', year: null, dateUnknown: true })
  })

  it('sorts undated events after all dated events regardless of input order', () => {
    const events = buildTimeline(
      detail({
        birthYear: null,
        deathYear: '1950',
        marriages: [
          {
            unionId: '@F1@',
            marriageYear: null,
            marriagePlace: null,
            spouse: null,
            children: [summary({ gedcomId: '@I3@', birthYear: null })],
          },
        ],
      })
    )

    expect(events[0].dateUnknown).toBe(false)
    expect(events[0].type).toBe('death')
    expect(events.slice(1).every((e) => e.dateUnknown)).toBe(true)
  })
})

describe('buildTimeline — empty detail', () => {
  it('returns an empty array when no birth, death, marriages, or children are recorded', () => {
    expect(buildTimeline(detail())).toEqual([])
  })

  it('returns only a birth event when just a birth year is known', () => {
    const events = buildTimeline(detail({ birthYear: '1900', birthPlace: 'Dublin' }))

    expect(events).toEqual([
      expect.objectContaining({ type: 'birth', year: 1900, place: 'Dublin', dateUnknown: false }),
    ])
  })
})
