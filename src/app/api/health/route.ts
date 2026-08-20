/**
 * @module api/health
 * @description Public health-check endpoint reporting Neo4j reachability, intended for
 * uptime monitoring so a database outage is detectable without a human loading the site
 * (issue #321). Runs its own hard-capped timeout independent of the driver's
 * retry/connection-acquisition configuration in `src/lib/neo4j.ts`, so an unreachable
 * database is reported in seconds instead of inheriting the driver's (much longer) retry
 * window.
 * Route: GET /api/health
 */

import { NextResponse } from 'next/server'
import { getDriver } from '@/lib/neo4j'

/** Forces the route to run in the Node.js runtime (required for the Neo4j driver). */
export const runtime = 'nodejs'

/**
 * Hard cap on how long the health check waits for Neo4j before declaring it unreachable.
 *
 * Deliberately decoupled from the driver's own retry/acquisition timeouts — this check
 * must fail fast even if those are misconfigured or left at their (much longer) defaults.
 * 5s is a conservative placeholder: comfortably under AC3's 10s ceiling while leaving
 * headroom above a warm connection's round trip. It is NOT based on measured Aura
 * cold-start latency — the production instance is currently paused, so that measurement
 * is outstanding (see issue #321 AC5/AC5b). Re-tune this value once cold-start latency
 * has been measured.
 */
export const HEALTH_CHECK_TIMEOUT_MS = 5000

/**
 * Races Neo4j connectivity verification against a hard timeout. Rejects with a timeout
 * error if the database doesn't respond in time, regardless of what the driver itself
 * would otherwise do (retry, wait for connection acquisition, etc.).
 */
async function checkDatabaseReachable(timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout>
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Database connectivity check timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  })

  try {
    await Promise.race([getDriver().verifyConnectivity(), timedOut])
  } finally {
    clearTimeout(timer!)
  }
}

/**
 * Handles GET /api/health.
 *
 * Verifies Neo4j connectivity with a hard-capped timeout so an unreachable database is
 * reported within seconds rather than after the driver's (much longer) retry window
 * (issue #321 AC2/AC3).
 *
 * @returns `{ status: 'ok', database: 'reachable', latencyMs }` with HTTP 200 when the
 *          database responds in time, or `{ status: 'error', database: 'unreachable',
 *          reason, latencyMs }` with HTTP 503 otherwise.
 */
export async function GET() {
  const startedAt = Date.now()
  try {
    await checkDatabaseReachable(HEALTH_CHECK_TIMEOUT_MS)
    return NextResponse.json({
      status: 'ok',
      database: 'reachable',
      latencyMs: Date.now() - startedAt,
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('Health check: database unreachable', err)
    return NextResponse.json(
      {
        status: 'error',
        database: 'unreachable',
        reason,
        latencyMs: Date.now() - startedAt,
      },
      { status: 503 }
    )
  }
}
