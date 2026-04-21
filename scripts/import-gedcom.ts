/**
 * GEDCOM Family Tree Importer
 * Imports individuals and families from a GEDCOM file into Neo4j as Person and Union
 * nodes with UNION (spouse) and CHILD (child-of) relationships.
 */

import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'parse-gedcom'
import neo4j from 'neo4j-driver'

const envPath = path.join(__dirname, '../.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2]
  }
}

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

function findChild(nodes: GedNode[], type: string): GedNode | undefined {
  return nodes.find(n => n.type === type)
}

function childValue(nodes: GedNode[], type: string): string {
  return findChild(nodes, type)?.value ?? ''
}

function year(d: string): string | null {
  return d.match(/\d{4}/)?.[0] ?? null
}

// GEDCOM PLAC is typically "town,county,state,country" with trailing commas.
function cleanPlace(p: string): string | null {
  if (!p) return null
  const cleaned = p.split(',').map(s => s.trim()).filter(Boolean).join(', ')
  return cleaned || null
}

// Occupation in this GEDCOM appears either as OCCU value, or as a PLAC child of OCCU.
function extractOccupation(indi: GedNode): string | null {
  const occus = indi.children.filter(n => n.type === 'OCCU')
  for (const o of occus) {
    if (o.value) return o.value
    const plac = findChild(o.children, 'PLAC')?.value
    if (plac) {
      const cleaned = plac.split(',').map(s => s.trim()).filter(Boolean).join(', ')
      if (cleaned) return cleaned
    }
  }
  return null
}

// Full display name from "First Middle/Surname/" or GIVN+SURN.
function extractName(nameNode: GedNode | undefined): { given: string; surname: string; full: string } {
  if (!nameNode) return { given: '', surname: '', full: '' }
  const given = childValue(nameNode.children, 'GIVN')
  const surname = childValue(nameNode.children, 'SURN')
  let full = ''
  if (nameNode.value) {
    full = nameNode.value.replace(/\//g, ' ').replace(/\s+/g, ' ').trim()
  }
  if (!full) full = [given, surname].filter(Boolean).join(' ')
  return { given, surname, full }
}

async function main() {
  const filePath = path.join(__dirname, '../family-tree.ged')
  const content = fs.readFileSync(filePath, 'utf-8')
  const root = parse(content) as unknown as { type: string; children: GedNode[] }

  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true }
  )
  const session = driver.session()

  try {
    await session.run('MATCH (n) DETACH DELETE n')
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (p:Person) REQUIRE p.gedcomId IS UNIQUE')
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (u:Union) REQUIRE u.gedcomId IS UNIQUE')

    interface PersonRow {
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

    const personRows: PersonRow[] = []
    for (const indi of root.children.filter(r => r.type === 'INDI')) {
      const xrefId = indi.data?.xref_id
      if (!xrefId) continue
      const nameNode = findChild(indi.children, 'NAME')
      const { given, surname, full } = extractName(nameNode)
      const birthNode = findChild(indi.children, 'BIRT')
      const deathNode = findChild(indi.children, 'DEAT')
      const birthDate = childValue(birthNode?.children ?? [], 'DATE') || null
      const deathDate = childValue(deathNode?.children ?? [], 'DATE') || null
      personRows.push({
        gedcomId: xrefId,
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
      })
    }

    await session.executeWrite(tx =>
      tx.run(
        `UNWIND $rows AS row
         MERGE (p:Person {gedcomId: row.gedcomId})
         SET p.name = row.name,
             p.givenName = row.givenName,
             p.surname = row.surname,
             p.sex = row.sex,
             p.birthDate = row.birthDate,
             p.birthYear = row.birthYear,
             p.birthPlace = row.birthPlace,
             p.deathDate = row.deathDate,
             p.deathYear = row.deathYear,
             p.deathPlace = row.deathPlace,
             p.occupation = row.occupation,
             p.notes = row.notes`,
        { rows: personRows }
      )
    )

    const families = root.children.filter(r => r.type === 'FAM')
    interface UnionRow {
      gedcomId: string
      marriageDate: string | null
      marriageYear: string | null
      marriagePlace: string | null
    }
    const unionRows: UnionRow[] = []
    const spouseRows: { pid: string; uid: string }[] = []
    const childRows: { pid: string; uid: string }[] = []

    for (const fam of families) {
      const uid = fam.data?.xref_id
      if (!uid) continue
      const marr = findChild(fam.children, 'MARR')
      const marriageDate = childValue(marr?.children ?? [], 'DATE') || null
      unionRows.push({
        gedcomId: uid,
        marriageDate,
        marriageYear: marriageDate ? year(marriageDate) : null,
        marriagePlace: cleanPlace(childValue(marr?.children ?? [], 'PLAC')),
      })
      const husb = findChild(fam.children, 'HUSB')?.data?.pointer
      const wife = findChild(fam.children, 'WIFE')?.data?.pointer
      if (husb) spouseRows.push({ pid: husb, uid })
      if (wife) spouseRows.push({ pid: wife, uid })
      for (const chil of fam.children.filter(n => n.type === 'CHIL')) {
        const pid = chil.data?.pointer
        if (pid) childRows.push({ pid, uid })
      }
    }

    await session.executeWrite(tx =>
      tx.run(
        `UNWIND $rows AS row
         MERGE (u:Union {gedcomId: row.gedcomId})
         SET u.marriageDate = row.marriageDate,
             u.marriageYear = row.marriageYear,
             u.marriagePlace = row.marriagePlace`,
        { rows: unionRows }
      )
    )

    if (spouseRows.length > 0) {
      await session.executeWrite(tx =>
        tx.run(
          `UNWIND $rows AS row
           MATCH (p:Person {gedcomId: row.pid}), (u:Union {gedcomId: row.uid})
           MERGE (p)-[:UNION]->(u)`,
          { rows: spouseRows }
        )
      )
    }

    if (childRows.length > 0) {
      await session.executeWrite(tx =>
        tx.run(
          `UNWIND $rows AS row
           MATCH (p:Person {gedcomId: row.pid}), (u:Union {gedcomId: row.uid})
           MERGE (p)-[:CHILD]->(u)`,
          { rows: childRows }
        )
      )
    }

    const personResult = await session.run('MATCH (p:Person) RETURN count(p) AS n')
    const unionResult = await session.run('MATCH (u:Union) RETURN count(u) AS n')
    console.log(`Imported ${personResult.records[0].get('n')} people and ${unionResult.records[0].get('n')} unions`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
