import {
  PHOTO_PREFIX,
  DEFAULT_MIN_AGE_HOURS,
  DELETE_BATCH_SIZE,
  extractPhotoUrls,
  toPhotoPathname,
  buildReachablePhotoPathnames,
  findOrphanedBlobs,
  selectDeletableUrls,
  chunk,
  listAllPhotoBlobs,
  parseCliArgs,
  type BlobInfo,
} from './gc-orphaned-photos'

const url = (suffix: string) => `https://example.public.blob.vercel-storage.com/${PHOTO_PREFIX}${suffix}`

function blob(overrides: Partial<BlobInfo> & { url: string }): BlobInfo {
  return {
    pathname: overrides.url.split('.vercel-storage.com/')[1]?.split('?')[0] ?? overrides.url,
    size: 1024,
    uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('extractPhotoUrls', () => {
  it('finds a top-level photoUrl string field', () => {
    const found = extractPhotoUrls({ photoUrl: url('a.jpg'), name: 'Alice' })
    expect(found).toEqual(new Set([url('a.jpg')]))
  })

  it('finds photo URLs nested inside arrays and objects', () => {
    const found = extractPhotoUrls({
      changeType: 'CREATE_PERSON',
      fields: { photoUrl: url('nested.jpg') },
      tags: ['x', url('in-array.jpg')],
    })
    expect(found).toEqual(new Set([url('nested.jpg'), url('in-array.jpg')]))
  })

  it('ignores strings that are not blob photo URLs', () => {
    const found = extractPhotoUrls({ name: 'Bob', notes: 'https://example.com/not-a-photo' })
    expect(found.size).toBe(0)
  })

  it('returns an empty set for null/non-object input', () => {
    expect(extractPhotoUrls(null).size).toBe(0)
    expect(extractPhotoUrls(42).size).toBe(0)
  })
})

describe('toPhotoPathname', () => {
  it('reduces a plain blob URL to its store pathname', () => {
    expect(toPhotoPathname(url('a.jpg'))).toBe(`${PHOTO_PREFIX}a.jpg`)
  })

  it('strips a query string so signed/download URL variants still match', () => {
    expect(toPhotoPathname(`${url('a.jpg')}?download=1`)).toBe(`${PHOTO_PREFIX}a.jpg`)
  })

  it('strips a fragment', () => {
    expect(toPhotoPathname(`${url('a.jpg')}#top`)).toBe(`${PHOTO_PREFIX}a.jpg`)
  })

  it('matches across differing store hostnames', () => {
    expect(toPhotoPathname(`https://other-store.public.blob.vercel-storage.com/${PHOTO_PREFIX}a.jpg`))
      .toBe(`${PHOTO_PREFIX}a.jpg`)
  })

  it('extracts a pathname embedded inside a larger string', () => {
    expect(toPhotoPathname(`<img src="${url('a.jpg')}" />`)).toBe(`${PHOTO_PREFIX}a.jpg`)
  })

  it('accepts a bare pathname with no host', () => {
    expect(toPhotoPathname(`${PHOTO_PREFIX}a.jpg`)).toBe(`${PHOTO_PREFIX}a.jpg`)
  })

  it('returns null for a string that does not reference the photo prefix', () => {
    expect(toPhotoPathname('https://example.com/avatar.jpg')).toBeNull()
  })
})

describe('buildReachablePhotoPathnames', () => {
  it('includes live Person.photoUrl values', () => {
    const reachable = buildReachablePhotoPathnames([url('live.jpg'), null], [], [])
    expect(reachable.has(`${PHOTO_PREFIX}live.jpg`)).toBe(true)
  })

  it('ignores a Person.photoUrl pointing outside the photo prefix', () => {
    const reachable = buildReachablePhotoPathnames(['https://example.com/external.jpg'], [], [])
    expect(reachable.size).toBe(0)
  })

  it('includes photo URLs referenced by a pending PendingChange payload', () => {
    const payload = JSON.stringify({ photoUrl: url('pending.jpg') })
    const reachable = buildReachablePhotoPathnames([], [payload], [])
    expect(reachable.has(`${PHOTO_PREFIX}pending.jpg`)).toBe(true)
  })

  it('includes photo URLs from a live Change previousValue and newValue', () => {
    const reachable = buildReachablePhotoPathnames(
      [],
      [],
      [
        {
          previousValue: JSON.stringify({ photoUrl: url('prev.jpg') }),
          newValue: JSON.stringify({ photoUrl: url('next.jpg') }),
        },
      ]
    )
    expect(reachable.has(`${PHOTO_PREFIX}prev.jpg`)).toBe(true)
    expect(reachable.has(`${PHOTO_PREFIX}next.jpg`)).toBe(true)
  })

  it('tolerates malformed JSON in payloads/changes without throwing', () => {
    const reachable = buildReachablePhotoPathnames(
      [],
      ['not-json'],
      [{ previousValue: 'also-not-json', newValue: null }]
    )
    expect(reachable.size).toBe(0)
  })

  it('still reaches a photo referenced by a bare JSON string payload', () => {
    const reachable = buildReachablePhotoPathnames([], [JSON.stringify(url('bare.jpg'))], [])
    expect(reachable.has(`${PHOTO_PREFIX}bare.jpg`)).toBe(true)
  })
})

describe('findOrphanedBlobs', () => {
  const now = new Date('2026-01-10T00:00:00.000Z').getTime()
  const dayMs = 24 * 60 * 60 * 1000

  it('excludes blobs whose pathname is in the reachable set', () => {
    const blobs = [blob({ url: url('reachable.jpg'), uploadedAt: new Date(now - 10 * dayMs) })]
    const orphaned = findOrphanedBlobs(blobs, new Set([`${PHOTO_PREFIX}reachable.jpg`]), dayMs, now)
    expect(orphaned).toEqual([])
  })

  it('excludes a blob referenced only via a query-string URL variant', () => {
    const blobs = [blob({ url: url('signed.jpg'), uploadedAt: new Date(now - 10 * dayMs) })]
    const reachable = buildReachablePhotoPathnames([`${url('signed.jpg')}?download=1`], [], [])
    expect(findOrphanedBlobs(blobs, reachable, dayMs, now)).toEqual([])
  })

  it('excludes unreachable blobs younger than the age threshold', () => {
    const blobs = [blob({ url: url('fresh.jpg'), uploadedAt: new Date(now - 1000) })]
    const orphaned = findOrphanedBlobs(blobs, new Set(), dayMs, now)
    expect(orphaned).toEqual([])
  })

  it('includes unreachable blobs older than the age threshold', () => {
    const b = blob({ url: url('stale.jpg'), uploadedAt: new Date(now - 10 * dayMs) })
    const orphaned = findOrphanedBlobs([b], new Set(), dayMs, now)
    expect(orphaned).toEqual([b])
  })

  it('treats a blob with an unparseable uploadedAt as too young to delete', () => {
    const b = blob({ url: url('bad-date.jpg'), uploadedAt: 'not-a-date' })
    expect(findOrphanedBlobs([b], new Set(), dayMs, now)).toEqual([])
  })
})

describe('selectDeletableUrls', () => {
  it('returns the URLs of blobs under the photo prefix', () => {
    const b = blob({ url: url('a.jpg') })
    expect(selectDeletableUrls([b])).toEqual([b.url])
  })

  it('throws rather than deleting a blob outside the photo prefix', () => {
    const stray = blob({ url: 'https://example.public.blob.vercel-storage.com/other/a.jpg' })
    expect(() => selectDeletableUrls([stray])).toThrow(/other\/a\.jpg/)
  })

  it('throws when a pathname merely contains the prefix rather than starting with it', () => {
    const sneaky = blob({
      url: `https://example.public.blob.vercel-storage.com/uploads/${PHOTO_PREFIX}a.jpg`,
    })
    expect(() => selectDeletableUrls([sneaky])).toThrow()
  })
})

describe('chunk', () => {
  it('splits a list into batches of at most the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns an empty list for no items', () => {
    expect(chunk([], 10)).toEqual([])
  })

  it('uses a delete batch size within the blob API limit', () => {
    expect(DELETE_BATCH_SIZE).toBeLessThanOrEqual(1000)
  })
})

describe('listAllPhotoBlobs', () => {
  it('follows the cursor until hasMore is false and scopes every page to the prefix', async () => {
    const calls: Array<{ prefix: string; cursor?: string }> = []
    const pages = [
      { blobs: [blob({ url: url('a.jpg') })], cursor: 'c1', hasMore: true },
      { blobs: [blob({ url: url('b.jpg') })], cursor: undefined, hasMore: false },
    ]
    const listFn = async (opts: { prefix: string; cursor?: string; limit?: number }) => {
      calls.push({ prefix: opts.prefix, cursor: opts.cursor })
      return pages[calls.length - 1]
    }

    const blobs = await listAllPhotoBlobs(listFn)

    expect(blobs.map(b => b.pathname)).toEqual([`${PHOTO_PREFIX}a.jpg`, `${PHOTO_PREFIX}b.jpg`])
    expect(calls).toEqual([
      { prefix: PHOTO_PREFIX, cursor: undefined },
      { prefix: PHOTO_PREFIX, cursor: 'c1' },
    ])
  })

  it('stops when hasMore is true but no cursor is returned', async () => {
    let calls = 0
    const listFn = async () => {
      calls++
      return { blobs: [blob({ url: url('a.jpg') })], cursor: undefined, hasMore: true }
    }
    await listAllPhotoBlobs(listFn)
    expect(calls).toBe(1)
  })

  it('stops if the API keeps returning the same cursor', async () => {
    let calls = 0
    const listFn = async () => {
      calls++
      return { blobs: [blob({ url: url(`${calls}.jpg`) })], cursor: 'stuck', hasMore: true }
    }
    await listAllPhotoBlobs(listFn)
    expect(calls).toBe(2)
  })
})

describe('parseCliArgs', () => {
  it('defaults to a dry run with the default min age', () => {
    expect(parseCliArgs([])).toEqual({ apply: false, minAgeHours: DEFAULT_MIN_AGE_HOURS })
  })

  it('enables apply mode when --apply is passed', () => {
    expect(parseCliArgs(['--apply'])).toEqual({ apply: true, minAgeHours: DEFAULT_MIN_AGE_HOURS })
  })

  it('parses a custom --min-age-hours value', () => {
    expect(parseCliArgs(['--min-age-hours=2'])).toEqual({ apply: false, minAgeHours: 2 })
  })

  it('throws for a negative or non-numeric --min-age-hours', () => {
    expect(() => parseCliArgs(['--min-age-hours=-1'])).toThrow()
    expect(() => parseCliArgs(['--min-age-hours=abc'])).toThrow()
  })

  it('rejects an unrecognised flag rather than silently ignoring it', () => {
    expect(() => parseCliArgs(['--min-age-hrs=2'])).toThrow(/--min-age-hrs/)
  })
})
