import { isLikelyLiving, redactPerson, Person } from './privacy'

const CURRENT_YEAR = new Date().getFullYear()

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    gedcomId: '@I1@',
    name: 'Jane Doe',
    sex: 'F',
    birthYear: '1990',
    deathYear: null,
    birthDate: '1990-04-12',
    deathDate: null,
    birthPlace: 'Sheffield',
    deathPlace: null,
    occupation: 'Teacher',
    notes: 'Some private note',
    ...overrides,
  }
}

describe('isLikelyLiving — dead person untouched', () => {
  it('returns false when deathYear is set', () => {
    const person = makePerson({ deathYear: '1990', deathDate: '1990-01-01', deathPlace: 'London' })
    expect(isLikelyLiving(person)).toBe(false)
  })

  it('returns false when only deathDate is set', () => {
    const person = makePerson({ deathYear: null, deathDate: '1990-01-01', deathPlace: null })
    expect(isLikelyLiving(person)).toBe(false)
  })

  it('returns false when only deathPlace is set', () => {
    const person = makePerson({ deathYear: null, deathDate: null, deathPlace: 'London' })
    expect(isLikelyLiving(person)).toBe(false)
  })
})

describe('isLikelyLiving — living redacted', () => {
  it('returns true for a person with no death fields and a recent birth year', () => {
    const person = makePerson({ birthYear: String(CURRENT_YEAR - 35) })
    expect(isLikelyLiving(person)).toBe(true)
  })
})

describe('isLikelyLiving — unknown-birth-no-death redacted', () => {
  it('returns true (fail safe) when birthYear is unknown and there are no death fields', () => {
    const person = makePerson({ birthYear: null, birthDate: null })
    expect(isLikelyLiving(person)).toBe(true)
  })
})

describe('isLikelyLiving — explicit isLiving override', () => {
  it('treats a person with death fields as living when isLiving is explicitly true', () => {
    const person = makePerson({
      deathYear: '1950',
      deathDate: '1950-01-01',
      deathPlace: 'London',
      isLiving: true,
    })
    expect(isLikelyLiving(person)).toBe(true)
  })

  it('treats a person with no death fields as not living when isLiving is explicitly false', () => {
    const person = makePerson({ birthYear: String(CURRENT_YEAR - 35), isLiving: false })
    expect(isLikelyLiving(person)).toBe(false)
  })
})

describe('isLikelyLiving — threshold boundary', () => {
  it('returns true when birthYear is exactly 105 years ago', () => {
    const person = makePerson({ birthYear: String(CURRENT_YEAR - 105) })
    expect(isLikelyLiving(person)).toBe(true)
  })

  it('returns false when birthYear is more than 105 years ago', () => {
    const person = makePerson({ birthYear: String(CURRENT_YEAR - 106) })
    expect(isLikelyLiving(person)).toBe(false)
  })
})

describe('redactPerson', () => {
  it('keeps gedcomId, name, and sex unchanged', () => {
    const person = makePerson({ birthYear: String(CURRENT_YEAR - 35) })
    const redacted = redactPerson(person)
    expect(redacted.gedcomId).toBe(person.gedcomId)
    expect(redacted.name).toBe(person.name)
    expect(redacted.sex).toBe(person.sex)
  })

  it('nulls birthYear, birthDate, birthPlace, deathPlace, occupation, and notes', () => {
    const person = makePerson({ birthYear: String(CURRENT_YEAR - 35) })
    const redacted = redactPerson(person)
    expect(redacted.birthYear).toBeNull()
    expect(redacted.birthDate).toBeNull()
    expect(redacted.birthPlace).toBeNull()
    expect(redacted.deathPlace).toBeNull()
    expect(redacted.occupation).toBeNull()
    expect(redacted.notes).toBeNull()
  })

  it('sets a living: true marker', () => {
    const person = makePerson({ birthYear: String(CURRENT_YEAR - 35) })
    const redacted = redactPerson(person)
    expect(redacted.living).toBe(true)
  })
})
