import {
  isValidGedcomId,
  clampHops,
  parseTreeUrlState,
  serializeTreeUrlState,
  buildTreeUrlPath,
} from './treeUrlState'
import { MIN_HOPS, MAX_HOPS } from '@/constants/tree'

describe('isValidGedcomId', () => {
  it('accepts a well-formed GEDCOM id', () => {
    expect(isValidGedcomId('@I85@')).toBe(true)
  })

  it('accepts ids with letters, digits, and underscores', () => {
    expect(isValidGedcomId('@ISPOUSE_A@')).toBe(true)
    expect(isValidGedcomId('@U12345678@')).toBe(true)
  })

  it('rejects a value missing the leading @', () => {
    expect(isValidGedcomId('I85@')).toBe(false)
  })

  it('rejects a value missing the trailing @', () => {
    expect(isValidGedcomId('@I85')).toBe(false)
  })

  it('rejects an empty body between @ delimiters', () => {
    expect(isValidGedcomId('@@')).toBe(false)
  })

  it('rejects a value containing spaces', () => {
    expect(isValidGedcomId('@I 85@')).toBe(false)
  })

  it('rejects null and undefined', () => {
    expect(isValidGedcomId(null)).toBe(false)
    expect(isValidGedcomId(undefined)).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidGedcomId('')).toBe(false)
  })
})

describe('clampHops', () => {
  it('returns the value unchanged when within range', () => {
    expect(clampHops(6)).toBe(6)
  })

  it('clamps values above MAX_HOPS down to MAX_HOPS', () => {
    expect(clampHops(9999)).toBe(MAX_HOPS)
  })

  it('clamps values below MIN_HOPS up to MIN_HOPS', () => {
    expect(clampHops(0)).toBe(MIN_HOPS)
    expect(clampHops(-5)).toBe(MIN_HOPS)
  })

  it('floors non-integer values before clamping', () => {
    expect(clampHops(4.9)).toBe(4)
  })
})

describe('parseTreeUrlState', () => {
  it('parses a valid root, person, and hops from URLSearchParams', () => {
    const params = new URLSearchParams()
    params.set('root', '@I85@')
    params.set('person', '@I12@')
    params.set('hops', '6')

    expect(parseTreeUrlState(params)).toEqual({
      root: '@I85@',
      person: '@I12@',
      hops: 6,
    })
  })

  it('tolerates a raw (percent-encoded) query string with %40 for @', () => {
    const params = new URLSearchParams('root=%40I85%40&person=%40I12%40&hops=6')

    expect(parseTreeUrlState(params)).toEqual({
      root: '@I85@',
      person: '@I12@',
      hops: 6,
    })
  })

  it('returns null for all fields when params are absent', () => {
    const params = new URLSearchParams()

    expect(parseTreeUrlState(params)).toEqual({
      root: null,
      person: null,
      hops: null,
    })
  })

  it('returns null root for a malformed GEDCOM id', () => {
    const params = new URLSearchParams()
    params.set('root', 'not-a-gedcom-id')

    expect(parseTreeUrlState(params).root).toBeNull()
  })

  it('returns null person for a malformed GEDCOM id', () => {
    const params = new URLSearchParams()
    params.set('person', '@bad id@')

    expect(parseTreeUrlState(params).person).toBeNull()
  })

  it('clamps an out-of-range hops value instead of rejecting it', () => {
    const params = new URLSearchParams()
    params.set('hops', '9999')

    expect(parseTreeUrlState(params).hops).toBe(MAX_HOPS)
  })

  it('returns null hops for a non-numeric value', () => {
    const params = new URLSearchParams()
    params.set('hops', 'not-a-number')

    expect(parseTreeUrlState(params).hops).toBeNull()
  })

  it('returns null hops for an empty string value', () => {
    const params = new URLSearchParams()
    params.set('hops', '')

    expect(parseTreeUrlState(params).hops).toBeNull()
  })
})

describe('serializeTreeUrlState', () => {
  it('serializes root, person, and hops into a query string with @ percent-encoded', () => {
    const query = serializeTreeUrlState({ root: '@I85@', person: '@I12@', hops: 6 })
    const params = new URLSearchParams(query)

    expect(query).toContain('%40I85%40')
    expect(params.get('root')).toBe('@I85@')
    expect(params.get('person')).toBe('@I12@')
    expect(params.get('hops')).toBe('6')
  })

  it('omits fields that are null or undefined', () => {
    const query = serializeTreeUrlState({ root: '@I85@', person: null, hops: undefined })
    const params = new URLSearchParams(query)

    expect(params.has('person')).toBe(false)
    expect(params.has('hops')).toBe(false)
    expect(params.get('root')).toBe('@I85@')
  })

  it('clamps hops when serializing an out-of-range value', () => {
    const query = serializeTreeUrlState({ hops: 9999 })
    const params = new URLSearchParams(query)

    expect(params.get('hops')).toBe(String(MAX_HOPS))
  })

  it('returns an empty string when no fields are provided', () => {
    expect(serializeTreeUrlState({})).toBe('')
  })
})

describe('parse/serialize round-trip', () => {
  it('recovers the original state after serializing and re-parsing', () => {
    const original = { root: '@I85@', person: '@I12@', hops: 6 }
    const reparsed = parseTreeUrlState(new URLSearchParams(serializeTreeUrlState(original)))

    expect(reparsed).toEqual(original)
  })
})

describe('buildTreeUrlPath', () => {
  it('returns "/" when no state is provided', () => {
    expect(buildTreeUrlPath({})).toBe('/')
  })

  it('returns "/" when all fields are null or undefined', () => {
    expect(buildTreeUrlPath({ root: null, person: undefined, hops: null })).toBe('/')
  })

  it('returns a relative path with a query string when state is present', () => {
    expect(buildTreeUrlPath({ root: '@I85@' })).toBe('/?root=%40I85%40')
  })

  it('includes all provided fields in the query string', () => {
    const path = buildTreeUrlPath({ root: '@I85@', person: '@I12@', hops: 6 })
    const [pathname, query] = path.split('?')
    const params = new URLSearchParams(query)

    expect(pathname).toBe('/')
    expect(params.get('root')).toBe('@I85@')
    expect(params.get('person')).toBe('@I12@')
    expect(params.get('hops')).toBe('6')
  })

  it('produces a path whose query round-trips through parseTreeUrlState', () => {
    const original = { root: '@I85@', person: '@ISPOUSE_A@', hops: 4 }

    const path = buildTreeUrlPath(original)
    const query = path.split('?')[1]
    const reparsed = parseTreeUrlState(new URLSearchParams(query))

    expect(reparsed).toEqual(original)
  })
})
