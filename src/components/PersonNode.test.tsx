/**
 * @jest-environment jsdom
 */

// Tell React we're in a test environment so act() works correctly
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import PersonNode from './PersonNode'
import type { PersonData } from '@/types/tree'
import { getPersonLodVariant, LOD_ZOOM_THRESHOLDS } from '@/constants/tree'

jest.mock('reactflow', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

const baseData: PersonData = {
  gedcomId: '@I85@',
  name: 'Irene Tunnicliffe',
  sex: 'U',
  birthYear: null,
  deathYear: null,
  birthPlace: null,
  deathPlace: null,
  occupation: null,
  notes: null,
  photoUrl: null,
}

function render(overrides: Partial<PersonData> = {}, nodeProps: { selected?: boolean } = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <PersonNode
        {...({ data: { ...baseData, ...overrides }, ...nodeProps } as unknown as Parameters<typeof PersonNode>[0])}
      />
    )
  })
  return container
}

afterEach(() => {
  act(() => { root.unmount() })
  if (container.parentNode) {
    container.parentNode.removeChild(container)
  }
})

describe('PersonNode avatar', () => {
  it('renders initials "IT" for "Irene Tunnicliffe"', () => {
    const el = render({ name: 'Irene Tunnicliffe' })
    expect(el.textContent).toContain('IT')
  })

  it('applies the neutral bg-surface-2 token when generation is -1', () => {
    const el = render({ generation: -1 })
    expect(el.innerHTML).toContain('bg-surface-2')
    expect(el.innerHTML).not.toContain('bg-indigo-900/40')
  })

  it('applies the neutral bg-surface-2 token when generation is 1', () => {
    const el = render({ generation: 1 })
    expect(el.innerHTML).toContain('bg-surface-2')
    expect(el.innerHTML).not.toContain('bg-emerald-900/40')
  })

  it('applies the neutral bg-surface-2 token when generation is 0', () => {
    const el = render({ generation: 0 })
    expect(el.innerHTML).toContain('bg-surface-2')
    expect(el.innerHTML).not.toContain('bg-indigo-900/40')
    expect(el.innerHTML).not.toContain('bg-emerald-900/40')
  })

  it('renders no photo img and shows initials when photoUrl is absent', () => {
    const el = render({ photoUrl: null })
    expect(el.querySelector('[data-testid="person-node-photo"]')).toBeNull()
    expect(el.textContent).toContain('IT')
  })

  it('renders the photo img when photoUrl is present', () => {
    const el = render({
      photoUrl: 'https://example.com/photo.jpg',
    })
    const img = el.querySelector('[data-testid="person-node-photo"]') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://example.com/photo.jpg')
  })

  it('falls back to initials when the photo img fails to load', () => {
    const el = render({
      photoUrl: 'https://example.com/broken.jpg',
    })
    const img = el.querySelector('[data-testid="person-node-photo"]') as HTMLImageElement
    act(() => {
      img.dispatchEvent(new Event('error', { bubbles: true }))
    })
    expect(el.querySelector('[data-testid="person-node-photo"]')).toBeNull()
    expect(el.textContent).toContain('IT')
  })
})

describe('getPersonLodVariant boundaries', () => {
  it('resolves to "dot" just below the dotMax threshold (0.45)', () => {
    expect(getPersonLodVariant(LOD_ZOOM_THRESHOLDS.dotMax - 0.01)).toBe('dot')
  })

  it('resolves the dotMax threshold itself (0.45) to "compact", not "dot"', () => {
    expect(getPersonLodVariant(LOD_ZOOM_THRESHOLDS.dotMax)).toBe('compact')
  })

  it('resolves values between the thresholds to "compact"', () => {
    expect(getPersonLodVariant(0.6)).toBe('compact')
  })

  it('resolves the compactMax threshold itself (0.85) to "compact", not "full"', () => {
    expect(getPersonLodVariant(LOD_ZOOM_THRESHOLDS.compactMax)).toBe('compact')
  })

  it('resolves just above the compactMax threshold (0.85) to "full"', () => {
    expect(getPersonLodVariant(LOD_ZOOM_THRESHOLDS.compactMax + 0.01)).toBe('full')
  })

  it('is deterministic and single-valued at each boundary across repeated calls', () => {
    const calls = Array.from({ length: 5 }, () => getPersonLodVariant(LOD_ZOOM_THRESHOLDS.dotMax))
    expect(new Set(calls).size).toBe(1)
    expect(calls[0]).toBe('compact')
  })

  it('resolves to "dot" at the default initial zoom (0.18), not "full" (issue #218)', () => {
    expect(getPersonLodVariant(0.18)).toBe('dot')
  })
})

describe('PersonNode lodVariant wiring', () => {
  it('renders the dot markup when data.lodVariant is "dot"', () => {
    const el = render({ lodVariant: 'dot' })
    expect(el.querySelector('[data-testid="person-node-dot"]')).not.toBeNull()
  })

  it('renders the compact markup when data.lodVariant is "compact"', () => {
    const el = render({ lodVariant: 'compact' })
    expect(el.querySelector('[data-testid="person-node-compact"]')).not.toBeNull()
  })

  it('renders the full markup when data.lodVariant is "full"', () => {
    const el = render({ lodVariant: 'full' })
    expect(el.querySelector('[data-testid="person-node-full"]')).not.toBeNull()
  })

  it('falls back to the full markup when data.lodVariant is absent', () => {
    const el = render()
    expect(el.querySelector('[data-testid="person-node-full"]')).not.toBeNull()
  })
})

/** Finds the element carrying the literal `⌂` glyph, or null if absent. */
function findRootMarker(el: HTMLElement): Element | null {
  return [...el.querySelectorAll('*')].find((node) => node.textContent?.trim() === '⌂') ?? null
}

describe('PersonNode root marker (DESIGN_SYSTEM.md §3.2 Root)', () => {
  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('renders a brass ⌂ marker on the %s variant when isRoot is true', (lodVariant, testId) => {
    const el = render({ isRoot: true, lodVariant })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    const marker = findRootMarker(node)
    expect(marker).not.toBeNull()
    expect(`${marker?.className ?? ''} ${marker?.getAttribute('style') ?? ''}`).toMatch(/brass/i)
  })

  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('renders no ⌂ marker on the %s variant when isRoot is false', (lodVariant, testId) => {
    const el = render({ isRoot: false, lodVariant })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    expect(findRootMarker(node)).toBeNull()
  })
})

describe('PersonNode living/private background (DESIGN_SYSTEM.md §3.2 Living/private)', () => {
  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('applies the --ft-private-soft background on the %s variant when living is true', (lodVariant, testId) => {
    const el = render({ living: true, lodVariant })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    expect(node.outerHTML).toMatch(/private-soft/i)
  })

  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('does not apply the --ft-private-soft background on the %s variant when living is false', (lodVariant, testId) => {
    const el = render({ living: false, lodVariant })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    expect(node.outerHTML).not.toMatch(/private-soft/i)
  })
})

describe('PersonNode selected treatment (DESIGN_SYSTEM.md §3.2 Selected, issue #266)', () => {
  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('renders a 2px accent border and accent-soft background on the %s variant when selected', (lodVariant, testId) => {
    const el = render({ lodVariant }, { selected: true })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    expect(node.className).toMatch(/\bborder-2\b/)
    expect(node.className).toMatch(/\bborder-accent\b/)
    expect(node.outerHTML).toMatch(/accent-soft/i)
  })

  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('renders no accent treatment on the %s variant when not selected', (lodVariant, testId) => {
    const el = render({ lodVariant }, { selected: false })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    expect(node.className).not.toMatch(/\bborder-accent\b/)
    expect(node.outerHTML).not.toMatch(/accent-soft/i)
  })

  it('renders the accent border, not the brass root border, on a node that is both root and selected (AC4 precedence)', () => {
    const el = render({ isRoot: true, lodVariant: 'full' }, { selected: true })
    const node = el.querySelector('[data-testid="person-node-full"]') as HTMLElement
    expect(node.className).toMatch(/\bborder-accent\b/)
    expect(node.className).not.toMatch(/\bborder-brass\b/)
  })

  it('keeps the brass root ⌂ marker visible on a node that is both root and selected (AC4)', () => {
    const el = render({ isRoot: true, lodVariant: 'full' }, { selected: true })
    const node = el.querySelector('[data-testid="person-node-full"]') as HTMLElement
    const marker = findRootMarker(node)
    expect(marker).not.toBeNull()
    expect(`${marker?.className ?? ''} ${marker?.getAttribute('style') ?? ''}`).toMatch(/brass/i)
  })

  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('renders no unconditional hover-border class on the %s variant when selected (issue #270)', (lodVariant, testId) => {
    const el = render({ lodVariant }, { selected: true })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    expect(node.className).not.toMatch(/hover:border-\[var\(--ft-border-strong\)\]/)
  })
})

describe('PersonNode hover treatment (DESIGN_SYSTEM.md §3.2, issue #270)', () => {
  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('applies the hover border/shadow classes on the %s variant when not selected', (lodVariant, testId) => {
    const el = render({ lodVariant }, { selected: false })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    expect(node.className).toMatch(/hover:border-\[var\(--ft-border-strong\)\]/)
    expect(node.className).toMatch(/hover:shadow-\[var\(--ft-shadow-2\)\]/)
  })

  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('omits the hover border/shadow classes on the %s variant when selected, so the accent border never gets clobbered on hover', (lodVariant, testId) => {
    const el = render({ lodVariant }, { selected: true })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    expect(node.className).not.toMatch(/hover:border-\[var\(--ft-border-strong\)\]/)
    expect(node.className).not.toMatch(/hover:shadow-\[var\(--ft-shadow-2\)\]/)
  })
})

describe('PersonNode pending edit indicator (DESIGN_SYSTEM.md §3.2 Has pending edit)', () => {
  it.each([
    ['compact', 'person-node-compact', 1, '1 suggested edit awaiting review'],
    ['compact', 'person-node-compact', 3, '3 suggested edits awaiting review'],
    ['full', 'person-node-full', 1, '1 suggested edit awaiting review'],
    ['full', 'person-node-full', 3, '3 suggested edits awaiting review'],
  ] as const)(
    'renders a pending-edit title on the %s variant when pendingEdits is %i',
    (lodVariant, testId, count, expectedTitle) => {
      const el = render({ pendingEdits: count, lodVariant })
      const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
      const titled = [...node.querySelectorAll('[title]')].find(
        (n) => n.getAttribute('title') === expectedTitle
      )
      expect(titled).toBeTruthy()
      expect(node.outerHTML).toMatch(/pending/i)
    }
  )

  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('renders no pending-edit indicator on the %s variant when pendingEdits is absent', (lodVariant, testId) => {
    const el = render({ lodVariant })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    const titled = [...node.querySelectorAll('[title]')].find((n) =>
      /awaiting review/i.test(n.getAttribute('title') ?? '')
    )
    expect(titled).toBeUndefined()
  })

  it.each([
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('renders no pending-edit indicator on the %s variant when pendingEdits is 0', (lodVariant, testId) => {
    const el = render({ pendingEdits: 0, lodVariant })
    const node = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    const titled = [...node.querySelectorAll('[title]')].find((n) =>
      /awaiting review/i.test(n.getAttribute('title') ?? '')
    )
    expect(titled).toBeUndefined()
  })
})

describe('PersonNode compact variant unknown name (DESIGN_SYSTEM.md §3.2)', () => {
  it('renders "Unknown" in italic muted styling when name is empty', () => {
    const el = render({ name: '', lodVariant: 'compact' })
    const node = el.querySelector('[data-testid="person-node-compact"]') as HTMLElement
    const matches = [...node.querySelectorAll('*')].filter((n) => n.textContent?.trim() === 'Unknown')
    const unknownEl = matches[matches.length - 1]
    expect(unknownEl).toBeTruthy()
    expect(unknownEl?.className).toContain('italic')
    expect(unknownEl?.className).toContain('text-ink-3')
  })

  it('does not render the italic "Unknown" placeholder when name is present', () => {
    const el = render({ name: 'Irene Tunnicliffe', lodVariant: 'compact' })
    const node = el.querySelector('[data-testid="person-node-compact"]') as HTMLElement
    expect(node.textContent).not.toContain('Unknown')
  })
})

describe('PersonNode keyboard accessibility (DESIGN_SYSTEM.md §7)', () => {
  it.each([
    ['dot', 'person-node-dot'],
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('exposes role="button" and tabIndex=0 on the %s variant', (lodVariant, testId) => {
    const el = render({ lodVariant })
    const node = el.querySelector(`[data-testid="${testId}"]`)
    expect(node).not.toBeNull()
    expect(node?.getAttribute('role')).toBe('button')
    expect(node?.getAttribute('tabindex')).toBe('0')
  })

  it.each([
    ['dot', 'person-node-dot'],
    ['compact', 'person-node-compact'],
    ['full', 'person-node-full'],
  ] as const)('applies a visible --ft-focus ring via focus-visible on the %s variant', (lodVariant, testId) => {
    const el = render({ lodVariant })
    const node = el.querySelector(`[data-testid="${testId}"]`)
    expect(node?.className).toContain('focus-visible:[box-shadow:var(--ft-focus)]')
    expect(node?.className).toContain('focus-visible:outline-none')
  })
})
