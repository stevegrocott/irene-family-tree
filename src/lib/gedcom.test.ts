import { buildIndiRecord, buildNoteLines, type PersonNode } from './gedcom'

describe('buildNoteLines', () => {
  it('emits a single NOTE line when the value has no newlines', () => {
    expect(buildNoteLines(1, 'single line note')).toEqual([
      '1 NOTE single line note',
    ])
  })

  it('wraps a multi-newline note with CONT lines at level+1', () => {
    const notes = 'First line of note\nSecond line of note\nThird line of note'

    expect(buildNoteLines(1, notes)).toEqual([
      '1 NOTE First line of note',
      '2 CONT Second line of note',
      '2 CONT Third line of note',
    ])
  })

  it('preserves empty continuation lines produced by consecutive newlines', () => {
    const notes = 'Line one\n\nLine three'

    expect(buildNoteLines(1, notes)).toEqual([
      '1 NOTE Line one',
      '2 CONT ',
      '2 CONT Line three',
    ])
  })

  it('uses the supplied nesting level for NOTE and level+1 for CONT', () => {
    const notes = 'Outer\nInner\nDeeper'

    expect(buildNoteLines(2, notes)).toEqual([
      '2 NOTE Outer',
      '3 CONT Inner',
      '3 CONT Deeper',
    ])
  })

  it('escapes @ characters on every emitted line', () => {
    const notes = 'contact @alice\nping @bob'

    expect(buildNoteLines(1, notes)).toEqual([
      '1 NOTE contact @@alice',
      '2 CONT ping @@bob',
    ])
  })
})

describe('buildIndiRecord', () => {
  const basePerson: PersonNode = {
    gedcomId: '@I1@',
    name: 'John Doe',
    sex: 'M',
    birthYear: null,
    deathYear: null,
    birthPlace: null,
    deathPlace: null,
    occupation: null,
    notes: null,
  }

  it('emits both FAMS and FAMC back-pointers when the person is a spouse in one union and a child in another', () => {
    const record = buildIndiRecord(basePerson, ['@U1@'], ['@U2@'])
    const lines = record.split('\n')

    expect(lines).toContain('1 FAMS @U1@')
    expect(lines).toContain('1 FAMC @U2@')
  })

  it('emits one FAMS per union the person is a spouse in and one FAMC per union the person is a child in', () => {
    const record = buildIndiRecord(basePerson, ['@U1@', '@U3@'], ['@U2@'])
    const lines = record.split('\n')

    expect(lines.filter(l => l === '1 FAMS @U1@')).toHaveLength(1)
    expect(lines.filter(l => l === '1 FAMS @U3@')).toHaveLength(1)
    expect(lines.filter(l => l === '1 FAMC @U2@')).toHaveLength(1)
  })

  it('omits FAMS and FAMC lines when the person has no union memberships', () => {
    const record = buildIndiRecord(basePerson, [], [])

    expect(record).not.toMatch(/^1 FAMS /m)
    expect(record).not.toMatch(/^1 FAMC /m)
  })
})
