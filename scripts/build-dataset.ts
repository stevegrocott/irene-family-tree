/**
 * Parses family-tree.ged into a static JSON dataset at src/data/tree.json.
 * The Next.js app imports the JSON directly at build time — no database.
 */

import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'parse-gedcom'

interface GedData {
  formal_name?: string
  xref_id?: string
  pointer?: string
}
interface GedNode {
  type: string
  data?: GedData
  value?: string
  children: GedNode[]
}

const findChild = (nodes: GedNode[], type: string) =>
  nodes.find(n => n.type === type)

const childValue = (nodes: GedNode[], type: string) =>
  findChild(nodes, type)?.value ?? ''

const year = (d: string) => d.match(/\d{4}/)?.[0] ?? null

const cleanPlace = (p: string): string | null => {
  if (!p) return null
  const cleaned = p.split(',').map(s => s.trim()).filter(Boolean).join(', ')
  return cleaned || null
}

function extractOccupation(indi: GedNode): string | null {
  for (const o of indi.children.filter(n => n.type === 'OCCU')) {
    if (o.value) return o.value
    const cleaned = cleanPlace(findChild(o.children, 'PLAC')?.value ?? '')
    if (cleaned) return cleaned
  }
  return null
}

function extractName(nameNode: GedNode | undefined) {
  if (!nameNode) return { given: '', surname: '', full: '' }
  const given = childValue(nameNode.children, 'GIVN')
  const surname = childValue(nameNode.children, 'SURN')
  let full = ''
  if (nameNode.value) full = nameNode.value.replace(/\//g, ' ').replace(/\s+/g, ' ').trim()
  if (!full) full = [given, surname].filter(Boolean).join(' ')
  return { given, surname, full }
}

export interface PersonRecord {
  gedcomId: string
  name: string
  givenName: string
  surname: string
  sex: string
  birthDate: string | null
  birthYear: string | null
  birthPlace: string | null
  deathDate: string | null
  deathYear: string | null
  deathPlace: string | null
  occupation: string | null
  notes: string | null
}

export interface UnionRecord {
  gedcomId: string
  marriageDate: string | null
  marriageYear: string | null
  marriagePlace: string | null
}

export interface Dataset {
  persons: Record<string, PersonRecord>
  unions: Record<string, UnionRecord>
  // person -> unions they are a spouse in
  unionOf: Record<string, string[]>
  // person -> unions they are a child of (their parents' unions)
  childOf: Record<string, string[]>
  // union -> spouse person ids
  spousesOf: Record<string, string[]>
  // union -> children person ids
  childrenOf: Record<string, string[]>
}

function buildDataset(gedPath: string): Dataset {
  const content = fs.readFileSync(gedPath, 'utf-8')
  const root = parse(content) as unknown as { children: GedNode[] }

  const persons: Record<string, PersonRecord> = {}
  const unions: Record<string, UnionRecord> = {}
  const unionOf: Record<string, string[]> = {}
  const childOf: Record<string, string[]> = {}
  const spousesOf: Record<string, string[]> = {}
  const childrenOf: Record<string, string[]> = {}

  const push = (map: Record<string, string[]>, k: string, v: string) => {
    ;(map[k] ??= []).push(v)
  }

  for (const indi of root.children.filter(r => r.type === 'INDI')) {
    const id = indi.data?.xref_id
    if (!id) continue
    const nameNode = findChild(indi.children, 'NAME')
    const { given, surname, full } = extractName(nameNode)
    const birthNode = findChild(indi.children, 'BIRT')
    const deathNode = findChild(indi.children, 'DEAT')
    const birthDate = childValue(birthNode?.children ?? [], 'DATE') || null
    const deathDate = childValue(deathNode?.children ?? [], 'DATE') || null
    persons[id] = {
      gedcomId: id,
      name: full,
      givenName: given,
      surname,
      sex: childValue(indi.children, 'SEX'),
      birthDate,
      birthYear: birthDate ? year(birthDate) : null,
      birthPlace: cleanPlace(childValue(birthNode?.children ?? [], 'PLAC')),
      deathDate,
      deathYear: deathDate ? year(deathDate) : null,
      deathPlace: cleanPlace(childValue(deathNode?.children ?? [], 'PLAC')),
      occupation: extractOccupation(indi),
      notes: childValue(indi.children, 'NOTE') || null,
    }
  }

  for (const fam of root.children.filter(r => r.type === 'FAM')) {
    const id = fam.data?.xref_id
    if (!id) continue
    const marr = findChild(fam.children, 'MARR')
    const marriageDate = childValue(marr?.children ?? [], 'DATE') || null
    unions[id] = {
      gedcomId: id,
      marriageDate,
      marriageYear: marriageDate ? year(marriageDate) : null,
      marriagePlace: cleanPlace(childValue(marr?.children ?? [], 'PLAC')),
    }
    const husb = findChild(fam.children, 'HUSB')?.data?.pointer
    const wife = findChild(fam.children, 'WIFE')?.data?.pointer
    for (const pid of [husb, wife]) {
      if (pid && persons[pid]) {
        push(unionOf, pid, id)
        push(spousesOf, id, pid)
      }
    }
    for (const chil of fam.children.filter(n => n.type === 'CHIL')) {
      const pid = chil.data?.pointer
      if (pid && persons[pid]) {
        push(childOf, pid, id)
        push(childrenOf, id, pid)
      }
    }
  }

  return { persons, unions, unionOf, childOf, spousesOf, childrenOf }
}

function main() {
  const gedPath = path.join(__dirname, '../family-tree.ged')
  const outPath = path.join(__dirname, '../src/data/tree.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const ds = buildDataset(gedPath)
  fs.writeFileSync(outPath, JSON.stringify(ds))
  const personCount = Object.keys(ds.persons).length
  const unionCount = Object.keys(ds.unions).length
  console.log(`Wrote ${outPath}: ${personCount} people, ${unionCount} unions`)
}

main()
