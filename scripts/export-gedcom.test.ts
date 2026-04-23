jest.mock('../src/lib/env', () => ({
  loadLocalEnv: jest.fn(),
  validateRequiredEnv: jest.fn(),
}), { virtual: true })

import {
  CHILD_EDGES_QUERY,
  buildFamRecord,
  type FamilyBuildContext,
} from './export-gedcom'
import { buildIndiRecord, type PersonNode } from '../src/lib/gedcom'

describe('export-gedcom CHILD query direction (issue #100)', () => {
  it('uses canonical direction (u:Union)-[:CHILD]->(p:Person)', () => {
    expect(CHILD_EDGES_QUERY).toContain('(u:Union)-[:CHILD]->(p:Person)')
  })

  it('does not use the reversed direction (p:Person)-[:CHILD]->(u:Union)', () => {
    expect(CHILD_EDGES_QUERY).not.toContain('(p:Person)-[:CHILD]->(u:Union)')
  })
})

describe('buildFamRecord CHIL emission', () => {
  const union = { gedcomId: '@U1@', marriageYear: null, marriagePlace: null }
  const personSexMap = new Map<string, string>([
    ['@I1@', 'M'],
    ['@I2@', 'F'],
    ['@I3@', 'M'],
    ['@I4@', 'F'],
  ])

  it('emits one CHIL line per child attached to the union', () => {
    const ctx: FamilyBuildContext = {
      union,
      spouses: [
        { personId: '@I1@', unionId: '@U1@' },
        { personId: '@I2@', unionId: '@U1@' },
      ],
      children: [
        { personId: '@I3@', unionId: '@U1@' },
        { personId: '@I4@', unionId: '@U1@' },
      ],
      personSexMap,
    }

    const record = buildFamRecord(ctx)
    const lines = record.split('\n')

    expect(lines).toContain('1 CHIL @I3@')
    expect(lines).toContain('1 CHIL @I4@')
  })

  it('omits CHIL lines when the union has no children', () => {
    const ctx: FamilyBuildContext = {
      union,
      spouses: [{ personId: '@I1@', unionId: '@U1@' }],
      children: [],
      personSexMap,
    }

    const record = buildFamRecord(ctx)

    expect(record).not.toMatch(/^1 CHIL /m)
  })

  it('emits CHIL lines after HUSB/WIFE and before MARR (GEDCOM-conventional ordering)', () => {
    const ctx: FamilyBuildContext = {
      union: { gedcomId: '@U1@', marriageYear: '1900', marriagePlace: null },
      spouses: [
        { personId: '@I1@', unionId: '@U1@' },
        { personId: '@I2@', unionId: '@U1@' },
      ],
      children: [{ personId: '@I3@', unionId: '@U1@' }],
      personSexMap,
    }

    const lines = buildFamRecord(ctx).split('\n')
    const husbIdx = lines.findIndex(l => l.startsWith('1 HUSB'))
    const wifeIdx = lines.findIndex(l => l.startsWith('1 WIFE'))
    const chilIdx = lines.findIndex(l => l.startsWith('1 CHIL'))
    const marrIdx = lines.findIndex(l => l === '1 MARR')

    expect(husbIdx).toBeGreaterThan(-1)
    expect(wifeIdx).toBeGreaterThan(-1)
    expect(chilIdx).toBeGreaterThan(Math.max(husbIdx, wifeIdx))
    expect(marrIdx).toBeGreaterThan(chilIdx)
  })
})

describe('INDI FAMC back-pointers in the exported GEDCOM flow', () => {
  const person: PersonNode = {
    gedcomId: '@I3@',
    name: 'Alice Doe',
    sex: 'F',
    birthYear: null,
    deathYear: null,
    birthPlace: null,
    deathPlace: null,
    occupation: null,
    notes: null,
  }

  it('emits a FAMC line pointing at every union the person is a child of', () => {
    const record = buildIndiRecord(person, [], ['@U1@', '@U2@'])
    const lines = record.split('\n')

    expect(lines).toContain('1 FAMC @U1@')
    expect(lines).toContain('1 FAMC @U2@')
  })
})
