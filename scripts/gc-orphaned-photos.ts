/**
 * @module scripts/gc-orphaned-photos
 * @description Garbage-collects person photos in Vercel Blob storage that are no
 * longer referenced by the graph. Photos are uploaded by
 * `POST /api/person/[id]/photo` before the owning edit is saved, so an abandoned
 * edit leaves the blob behind with nothing pointing at it.
 *
 * Dry run (default):  ts-node --project tsconfig.scripts.json scripts/gc-orphaned-photos.ts
 * Delete for real:    ts-node --project tsconfig.scripts.json scripts/gc-orphaned-photos.ts --apply
 */

import neo4j from 'neo4j-driver'
import { list, del } from '@vercel/blob'
import { loadLocalEnv, validateRequiredEnv } from '../src/lib/env'
import { safeParseJson } from '../src/lib/utils'

export const PHOTO_PREFIX = 'person-photos/'
export const DEFAULT_MIN_AGE_HOURS = 24

/** The Blob API rejects a `/delete` request carrying more than 1000 URLs. */
export const DELETE_BATCH_SIZE = 1000

export const PERSON_PHOTO_QUERY = `
  MATCH (p:Person) WHERE p.photoUrl IS NOT NULL RETURN p.photoUrl AS photoUrl
`

export const PENDING_PAYLOAD_QUERY = `
  MATCH (c:PendingChange {status: 'pending'}) RETURN c.payload AS payload
`

export const LIVE_CHANGE_QUERY = `
  MATCH (c:Change {status: 'live'}) RETURN c.previousValue AS previousValue, c.newValue AS newValue
`

export interface BlobInfo {
  url: string
  pathname: string
  size: number
  uploadedAt: Date | string
}

export type ListPage = {
  blobs: BlobInfo[]
  cursor?: string
  hasMore: boolean
}

export type ListFn = (opts: { prefix: string; cursor?: string; limit?: number }) => Promise<ListPage>

/**
 * Recursively walks an arbitrary JSON value (PendingChange payloads and
 * Change previous/new values have no fixed shape across change types) and
 * collects any string that references a blob under PHOTO_PREFIX.
 */
export function extractPhotoUrls(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.includes(PHOTO_PREFIX)) into.add(value)
  } else if (Array.isArray(value)) {
    for (const item of value) extractPhotoUrls(item, into)
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) extractPhotoUrls(item, into)
  }
  return into
}

/**
 * Reduces a reference to the blob store pathname it points at, or null when it
 * does not reference this prefix at all.
 *
 * Reachability is compared on pathname rather than on the full URL because the
 * same blob is legitimately referenced by several spellings — the canonical
 * `url`, the `downloadUrl` variant, a URL carrying a query string, or a URL
 * embedded in a larger string. Comparing whole URLs would miss those and delete
 * a photo that is still in use.
 */
export function toPhotoPathname(value: string): string | null {
  const start = value.indexOf(PHOTO_PREFIX)
  if (start === -1) return null
  // Stop at the first character that cannot appear in a pathname, which also
  // trims any `?query` or `#fragment` suffix.
  const match = value.slice(start).match(/^[^\s"'<>()[\]{}?#\\]+/)
  return match ? match[0] : null
}


/**
 * Extracts photo URLs from a raw payload/change-value string, falling back to
 * scanning the raw text itself when it fails to parse as JSON. A record that
 * cannot be understood must never be read as "references nothing" — AC9
 * requires malformed data to fail closed rather than silently drop a root.
 */
function extractPhotoUrlsFromRaw(raw: string | null, into: Set<string> = new Set()): Set<string> {
  if (raw === null || raw === undefined) return into
  const parsed = safeParseJson(raw)
  return parsed !== null ? extractPhotoUrls(parsed, into) : extractPhotoUrls(raw, into)
}

/**
 * Builds the set of photo pathnames still reachable from live data: current
 * Person.photoUrl values, pending suggestion payloads (which may still be
 * approved and applied), and live Change records (whose previousValue a revert
 * could restore).
 *
 * `reverted` and `kept` Changes are deliberately excluded. A revert has already
 * written previousValue back onto the Person node, and
 * `PATCH /api/admin/changes/[id]` refuses to act on any Change that is not
 * `live`, so neither status can resurrect a photo.
 */
export function buildReachablePhotoPathnames(
  personPhotoUrls: Array<string | null>,
  pendingPayloads: Array<string | null>,
  liveChanges: Array<{ previousValue: string | null; newValue: string | null }>
): Set<string> {
  const reachable = new Set<string>()
  const addPhotoPathname = (url: string | null | undefined) => {
    if (!url) return
    const pathname = toPhotoPathname(url)
    if (pathname) reachable.add(pathname)
  }

  for (const url of personPhotoUrls) addPhotoPathname(url)
  for (const payload of pendingPayloads) {
    for (const url of extractPhotoUrlsFromRaw(payload)) addPhotoPathname(url)
  }
  for (const { previousValue, newValue } of liveChanges) {
    for (const url of extractPhotoUrlsFromRaw(previousValue)) addPhotoPathname(url)
    for (const url of extractPhotoUrlsFromRaw(newValue)) addPhotoPathname(url)
  }

  return reachable
}

/**
 * Blobs not in the reachable set and older than minAgeMs. The age floor keeps
 * an in-flight upload — one whose owning edit has not been saved yet — out of
 * the delete set. A blob with an unreadable timestamp is treated as brand new
 * so that bad metadata can never authorise a deletion.
 */
export function findOrphanedBlobs(
  blobs: BlobInfo[],
  reachablePathnames: Set<string>,
  minAgeMs: number,
  now: number
): BlobInfo[] {
  return blobs.filter(blob => {
    if (reachablePathnames.has(blob.pathname)) return false
    const uploadedAt = new Date(blob.uploadedAt).getTime()
    if (!Number.isFinite(uploadedAt)) return false
    return now - uploadedAt >= minAgeMs
  })
}

/**
 * Final guard on the delete path: every blob handed to `del()` must live under
 * PHOTO_PREFIX. `list()` is already scoped by prefix, so a violation means a
 * bug upstream — this throws rather than filtering, because silently dropping
 * the entry would hide it.
 */
export function selectDeletableUrls(orphaned: BlobInfo[]): string[] {
  return orphaned.map(blob => {
    if (!blob.pathname.startsWith(PHOTO_PREFIX)) {
      throw new Error(
        `Refusing to delete blob outside "${PHOTO_PREFIX}": ${blob.pathname}`
      )
    }
    return blob.url
  })
}

export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

/**
 * Pages through the whole prefix. Guards against a non-advancing cursor so a
 * misbehaving API cannot spin this loop forever.
 */
export async function listAllPhotoBlobs(listFn: ListFn): Promise<BlobInfo[]> {
  const blobs: BlobInfo[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (;;) {
    const page = await listFn({ prefix: PHOTO_PREFIX, cursor, limit: 1000 })
    blobs.push(...page.blobs)

    if (!page.hasMore || !page.cursor || seenCursors.has(page.cursor)) break
    seenCursors.add(page.cursor)
    cursor = page.cursor
  }

  return blobs
}

export interface CliOptions {
  apply: boolean
  minAgeHours: number
}

export function parseCliArgs(argv: string[]): CliOptions {
  let apply = false
  let minAgeHours = DEFAULT_MIN_AGE_HOURS

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true
    } else if (arg.startsWith('--min-age-hours=')) {
      minAgeHours = Number(arg.slice('--min-age-hours='.length))
    } else {
      // Fail loudly: a typo must not be read as "use the defaults" on a script
      // whose job is to delete things.
      throw new Error(`Unrecognised argument: ${arg}`)
    }
  }

  if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
    throw new Error('--min-age-hours must be a non-negative number')
  }

  return { apply, minAgeHours }
}

async function main() {
  loadLocalEnv()
  validateRequiredEnv(['NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD', 'BLOB_READ_WRITE_TOKEN'])

  const { apply, minAgeHours } = parseCliArgs(process.argv.slice(2))
  const minAgeMs = minAgeHours * 60 * 60 * 1000

  // Order matters: snapshot the blob list BEFORE reading the graph. Any blob
  // uploaded after this point is absent from the candidate set entirely, and
  // any reference written after this point is still picked up by the queries
  // below. Reading the graph first would leave a window in which a freshly
  // uploaded-and-referenced photo looked orphaned.
  const blobs = await listAllPhotoBlobs(opts => list(opts))

  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true }
  )
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })

  let reachable: Set<string>
  try {
    const [personResult, pendingResult, changeResult] = await Promise.all([
      session.run(PERSON_PHOTO_QUERY),
      session.run(PENDING_PAYLOAD_QUERY),
      session.run(LIVE_CHANGE_QUERY),
    ])

    reachable = buildReachablePhotoPathnames(
      personResult.records.map(r => r.get('photoUrl') as string | null),
      pendingResult.records.map(r => r.get('payload') as string | null),
      changeResult.records.map(r => ({
        previousValue: r.get('previousValue') as string | null,
        newValue: r.get('newValue') as string | null,
      }))
    )
  } finally {
    await session.close()
    await driver.close()
  }

  const orphaned = findOrphanedBlobs(blobs, reachable, minAgeMs, Date.now())
  const reclaimedBytes = orphaned.reduce((sum, blob) => sum + (blob.size ?? 0), 0)

  console.log(`Scanned ${blobs.length} blob(s) under "${PHOTO_PREFIX}"`)
  console.log(`Reachable photo(s): ${reachable.size}`)
  console.log(`Orphaned blob(s) older than ${minAgeHours}h: ${orphaned.length} (${reclaimedBytes} bytes)`)
  for (const blob of orphaned) {
    console.log(`  ${blob.pathname}  (${blob.size} bytes, uploaded ${new Date(blob.uploadedAt).toISOString()})`)
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to delete these blobs.')
    return
  }

  const toDelete = selectDeletableUrls(orphaned)
  if (toDelete.length === 0) {
    console.log('\nNothing to delete.')
    return
  }

  let deleted = 0
  for (const batch of chunk(toDelete, DELETE_BATCH_SIZE)) {
    await del(batch)
    deleted += batch.length
    console.log(`Deleted ${deleted}/${toDelete.length}...`)
  }
  console.log(`\nDeleted ${deleted} orphaned blob(s), reclaiming ${reclaimedBytes} bytes.`)
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
