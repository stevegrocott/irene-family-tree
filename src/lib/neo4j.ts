import neo4j, { Driver } from 'neo4j-driver'
import { NextResponse } from 'next/server'

const g = globalThis as unknown as { neo4jDriver?: Driver }

// Driver defaults let an unreachable database hang every request for 30s
// (maxTransactionRetryTime) with no cap on how long a connection acquisition
// can block (connectionAcquisitionTimeout), before `read`/`write` reject
// (see issue #321). 5s is a conservative default chosen to keep total
// request time comfortably under typical serverless function budgets while
// still tolerating normal (non-cold-start) query latency. It is NOT derived
// from measured Aura cold-start latency — the production instance is
// currently paused and that measurement is outstanding (issue #321, AC5b).
// Re-tune once real cold-start numbers are available.
const MAX_TRANSACTION_RETRY_TIME_MS = 5_000
const CONNECTION_ACQUISITION_TIMEOUT_MS = 5_000

export function getDriver(): Driver {
  if (!g.neo4jDriver) {
    g.neo4jDriver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
      {
        disableLosslessIntegers: true,
        maxTransactionRetryTime: MAX_TRANSACTION_RETRY_TIME_MS,
        connectionAcquisitionTimeout: CONNECTION_ACQUISITION_TIMEOUT_MS,
      }
    )
  }
  return g.neo4jDriver
}

export async function closeDriver(): Promise<void> {
  if (g.neo4jDriver) {
    await g.neo4jDriver.close()
    g.neo4jDriver = undefined
  }
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
