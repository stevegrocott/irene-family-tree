import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'parse-gedcom'
import neo4j from 'neo4j-driver'

// Load .env.local for local dev (no dotenv dependency needed)
const envPath = path.join(__dirname, '../.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim()
  }
}

interface GedNode {
  type: string
  data?: { xref_id?: string; pointer?: string }
  value?: string
  children: GedNode[]
}

function findChild(nodes: GedNode[], type: string): GedNode | undefined {
  return nodes.find(n => n.type === type)
}

function childValue(nodes: GedNode[], type: string): string {
  return findChild(nodes, type)?.value ?? ''
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
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE')
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (f:Family) REQUIRE f.id IS UNIQUE')

    const individuals = root.children.filter(r => r.type === 'INDI')
    for (const indi of individuals) {
      const id = indi.data?.xref_id ?? ''
      const nameNode = findChild(indi.children, 'NAME')
      const birthNode = findChild(indi.children, 'BIRT')
      const deathNode = findChild(indi.children, 'DEAT')

      const givenName = childValue(nameNode?.children ?? [], 'GIVN')
      const surname = childValue(nameNode?.children ?? [], 'SURN')
      const sex = childValue(indi.children, 'SEX')
      const birthDate = childValue(birthNode?.children ?? [], 'DATE')
      const birthPlace = childValue(birthNode?.children ?? [], 'PLAC')
      const deathDate = childValue(deathNode?.children ?? [], 'DATE')
      const deathPlace = childValue(deathNode?.children ?? [], 'PLAC')

      await session.run(
        `MERGE (p:Person {id: $id})
         SET p.givenName = $givenName,
             p.surname = $surname,
             p.sex = $sex,
             p.birthDate = $birthDate,
             p.birthPlace = $birthPlace,
             p.deathDate = $deathDate,
             p.deathPlace = $deathPlace`,
        { id, givenName, surname, sex, birthDate, birthPlace, deathDate, deathPlace }
      )
    }

    const families = root.children.filter(r => r.type === 'FAM')
    for (const fam of families) {
      const famId = fam.data?.xref_id ?? ''
      await session.run('MERGE (f:Family {id: $id})', { id: famId })

      const husb = findChild(fam.children, 'HUSB')?.data?.pointer
      const wife = findChild(fam.children, 'WIFE')?.data?.pointer
      const children = fam.children.filter(n => n.type === 'CHIL').map(n => n.data?.pointer ?? '')

      if (husb) {
        await session.run(
          'MATCH (p:Person {id: $pid}), (f:Family {id: $fid}) MERGE (p)-[:SPOUSE_IN]->(f)',
          { pid: husb, fid: famId }
        )
      }
      if (wife) {
        await session.run(
          'MATCH (p:Person {id: $pid}), (f:Family {id: $fid}) MERGE (p)-[:SPOUSE_IN]->(f)',
          { pid: wife, fid: famId }
        )
      }
      for (const child of children) {
        if (child) {
          await session.run(
            'MATCH (p:Person {id: $pid}), (f:Family {id: $fid}) MERGE (p)-[:CHILD_OF]->(f)',
            { pid: child, fid: famId }
          )
        }
      }
    }

    const personResult = await session.run('MATCH (p:Person) RETURN count(p) AS n')
    const famResult = await session.run('MATCH (f:Family) RETURN count(f) AS n')
    const personCount = personResult.records[0].get('n')
    const famCount = famResult.records[0].get('n')
    console.log(`Imported ${personCount} people and ${famCount} families`)
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
