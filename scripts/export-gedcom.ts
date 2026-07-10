import * as fs from 'fs'
import * as path from 'path'
import neo4j from 'neo4j-driver'
import { loadLocalEnv, validateRequiredEnv } from '../src/lib/env'
import {
  PERSON_QUERY,
  UNION_QUERY,
  SPOUSE_EDGES_QUERY,
  CHILD_EDGES_QUERY,
  mapPersonRecord,
  mapUnionRecord,
  mapRelRecord,
  groupByUnionId,
  buildFamRecord,
  buildGedcomDocument,
  type UnionNode,
  type PersonUnionRel,
  type FamilyBuildContext,
  type GedcomExportData,
} from '../src/lib/gedcom-export'

export {
  PERSON_QUERY,
  UNION_QUERY,
  SPOUSE_EDGES_QUERY,
  CHILD_EDGES_QUERY,
  mapPersonRecord,
  mapUnionRecord,
  mapRelRecord,
  groupByUnionId,
  buildFamRecord,
  buildGedcomDocument,
  type UnionNode,
  type PersonUnionRel,
  type FamilyBuildContext,
  type GedcomExportData,
}

async function main() {
  loadLocalEnv()
  validateRequiredEnv(['NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD'])

  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true }
  )
  const session = driver.session()

  try {
    const [personResult, unionResult, spouseResult, childResult] = await Promise.all([
      session.run(PERSON_QUERY),
      session.run(UNION_QUERY),
      session.run(SPOUSE_EDGES_QUERY),
      session.run(CHILD_EDGES_QUERY),
    ])

    const persons = personResult.records.map(mapPersonRecord)
    const unions = unionResult.records.map(mapUnionRecord)
    const spouseRels = spouseResult.records.map(mapRelRecord)
    const childRels = childResult.records.map(mapRelRecord)

    const output = buildGedcomDocument({ persons, unions, spouseRels, childRels })
    const outPath = path.join(__dirname, '../family-tree.ged')
    fs.writeFileSync(outPath, output, 'utf-8')

    console.log(
      `Exported ${persons.length} people and ${unions.length} unions to ${outPath}`
    )
  } finally {
    await session.close()
    await driver.close()
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
