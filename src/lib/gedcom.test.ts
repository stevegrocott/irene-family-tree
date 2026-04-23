import { buildNoteLines } from './gedcom'

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
