import neo4j, { Driver } from 'neo4j-driver'
import { NextResponse } from 'next/server'

const g = globalThis as unknown as { neo4jDriver?: Driver }

function getDriver(): Driver {
  if (!g.neo4jDriver) {
    g.neo4jDriver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
      { disableLosslessIntegers: true }
    )
  }
  return g.neo4jDriver
}

export async function read<T>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ })
  try {
    const { records } = await session.executeRead(tx => tx.run(cypher, params))
    return records.map(r => r.toObject() as T)
  } finally {
    await session.close()
  }
}

export async function write<T>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE })
  try {
    const { records } = await session.executeWrite(tx => tx.run(cypher, params))
    return records.map(r => r.toObject() as T)
  } finally {
    await session.close()
  }
}

/**
 * Builds a consistent 500 response for a failed Neo4j operation: logs the full
 * error server-side and returns `{ error, detail }`, where `detail` is the
 * underlying error message so operators can diagnose outages (e.g. a paused
 * Aura instance) without needing separate log access.
 */
export function neo4jErrorResponse(err: unknown, publicMessage: string, status = 500) {
  const detail = err instanceof Error ? err.message : String(err)
  console.error(publicMessage, err)
  return NextResponse.json({ error: publicMessage, detail }, { status })
}

export async function writeTransaction(
  statements: Array<{ cypher: string; params?: Record<string, unknown> }>
): Promise<void> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE })
  try {
    await session.executeWrite(async tx => {
      for (const { cypher, params = {} } of statements) {
        await tx.run(cypher, params)
      }
    })
  } finally {
    await session.close()
  }
}
