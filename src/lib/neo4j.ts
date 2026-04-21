import neo4j, { Driver } from 'neo4j-driver'

const g = globalThis as unknown as { neo4jDriver?: Driver }

export const driver: Driver =
  g.neo4jDriver ??
  neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true }
  )

if (process.env.NODE_ENV !== 'production') g.neo4jDriver = driver

export async function read<T>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const { records } = await session.executeRead(tx => tx.run(cypher, params))
    return records.map(r => r.toObject() as T)
  } finally {
    await session.close()
  }
}
