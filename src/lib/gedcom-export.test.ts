import {
  buildGedcomDocument,
  mapPersonRecord,
  mapUnionRecord,
  mapRelRecord,
  type QueryRecord,
  type GedcomExportData,
} from './gedcom-export'

function toQueryRecord(row: Record<string, unknown>): QueryRecord {
  return { get: key => row[key] }
}

describe('buildGedcomDocument', () => {
  const persons = [
    { gedcomId: '@I1@', name: 'John Doe', sex: 'M', birthYear: null, deathYear: null, birthPlace: null, deathPlace: null, occupation: null, notes: null },
    { gedcomId: '@I2@', name: 'Jane Doe', sex: 'F', birthYear: null, deathYear: null, birthPlace: null, deathPlace: null, occupation: null, notes: null },
    { gedcomId: '@I3@', name: 'Child Doe', sex: 'M', birthYear: null, deathYear: null, birthPlace: null, deathPlace: null, occupation: null, notes: null },
  ]
  const unions = [{ gedcomId: '@U1@', marriageYear: null, marriagePlace: null }]
  const spouseRels = [
    { personId: '@I1@', unionId: '@U1@' },
    { personId: '@I2@', unionId: '@U1@' },
  ]
  const childRels = [{ personId: '@I3@', unionId: '@U1@' }]

  const data: GedcomExportData = { persons, unions, spouseRels, childRels }

  it('orders sections as HEAD, one INDI per person, one FAM per union, then TRLR', () => {
    const doc = buildGedcomDocument(data)
    const lines = doc.split('\n')

    const headIdx = lines.findIndex(l => l === '0 HEAD')
    const indiIdxs = ['@I1@', '@I2@', '@I3@'].map(id =>
      lines.findIndex(l => l === `0 ${id} INDI`)
    )
    const famIdx = lines.findIndex(l => l === '0 @U1@ FAM')
    const trlrIdx = lines.findIndex(l => l === '0 TRLR')

    expect(headIdx).toBe(0)
    expect(indiIdxs.every(i => i > headIdx)).toBe(true)
    expect(famIdx).toBeGreaterThan(Math.max(...indiIdxs))
    expect(trlrIdx).toBeGreaterThan(famIdx)
    expect(trlrIdx).toBe(lines.length - 2)
    expect(lines[lines.length - 1]).toBe('')
  })

  it('emits a well-formed HEAD block', () => {
    const doc = buildGedcomDocument(data)
    const lines = doc.split('\n')

    expect(lines.slice(0, 6)).toEqual([
      '0 HEAD',
      '1 SOUR FamilyTree',
      '1 GEDC',
      '2 VERS 5.5.1',
      '2 FORM LINEAGE-LINKED',
      '1 CHAR UTF-8',
    ])
  })

  it('ends the document with a single TRLR line and trailing newline', () => {
    const doc = buildGedcomDocument(data)

    expect(doc).toMatch(/\n0 TRLR\n$/)
    expect(doc.match(/^0 TRLR$/gm)).toHaveLength(1)
  })

  it('emits FAMS/FAMC back-pointers on INDI records that match the FAM record', () => {
    const doc = buildGedcomDocument(data)
    const lines = doc.split('\n')

    expect(lines).toContain('1 FAMS @U1@')
    expect(lines).toContain('1 FAMC @U1@')
    expect(lines).toContain('1 HUSB @I1@')
    expect(lines).toContain('1 WIFE @I2@')
    expect(lines).toContain('1 CHIL @I3@')
  })

  it('produces only HEAD and TRLR when there is no data', () => {
    const doc = buildGedcomDocument({ persons: [], unions: [], spouseRels: [], childRels: [] })
    const lines = doc.split('\n')

    expect(lines[0]).toBe('0 HEAD')
    expect(lines[lines.length - 2]).toBe('0 TRLR')
    expect(lines.filter(l => l.startsWith('0 @'))).toHaveLength(0)
  })

  it('builds a document from rows shaped like the query runner results via mapPersonRecord/mapUnionRecord/mapRelRecord', () => {
    const personRows = [
      { gedcomId: '@I1@', name: 'John Doe', sex: 'M', birthYear: null, deathYear: null, birthPlace: null, deathPlace: null, occupation: null, notes: null },
    ].map(toQueryRecord)
    const unionRows = [{ gedcomId: '@U1@', marriageYear: '1950', marriagePlace: 'Springfield' }].map(toQueryRecord)
    const spouseRows = [{ personId: '@I1@', unionId: '@U1@' }].map(toQueryRecord)
    const childRows: QueryRecord[] = []

    const doc = buildGedcomDocument({
      persons: personRows.map(mapPersonRecord),
      unions: unionRows.map(mapUnionRecord),
      spouseRels: spouseRows.map(mapRelRecord),
      childRels: childRows.map(mapRelRecord),
    })
    const lines = doc.split('\n')

    expect(lines).toContain('0 @I1@ INDI')
    expect(lines).toContain('0 @U1@ FAM')
    expect(lines).toContain('1 HUSB @I1@')
    expect(lines).toContain('2 DATE 1950')
    expect(lines).toContain('2 PLAC Springfield')
  })
})
