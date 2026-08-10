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

function render(overrides: Partial<PersonData> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <PersonNode {...({ data: { ...baseData, ...overrides } } as unknown as Parameters<typeof PersonNode>[0])} />
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

describe('PersonNode pending edit indicator (DESIGN_SYSTEM.md §3.2 Has pending edit)', () => {
  it('renders a title="1 suggested edit awaiting review" element when pendingEdits is 1', () => {
    const el = render({ pendingEdits: 1 })
    const node = el.querySelector('[data-testid="person-node-full"]') as HTMLElement
    const titled = [...node.querySelectorAll('[title]')].find(
      (n) => n.getAttribute('title') === '1 suggested edit awaiting review'
    )
    expect(titled).toBeTruthy()
    expect(node.outerHTML).toMatch(/pending/i)
  })

  it('renders no pending-edit indicator when pendingEdits is absent', () => {
    const el = render()
    const node = el.querySelector('[data-testid="person-node-full"]') as HTMLElement
    const titled = [...node.querySelectorAll('[title]')].find((n) =>
      /awaiting review/i.test(n.getAttribute('title') ?? '')
    )
    expect(titled).toBeUndefined()
  })

  it('renders no pending-edit indicator when pendingEdits is 0', () => {
    const el = render({ pendingEdits: 0 })
    const node = el.querySelector('[data-testid="person-node-full"]') as HTMLElement
    const titled = [...node.querySelectorAll('[title]')].find((n) =>
      /awaiting review/i.test(n.getAttribute('title') ?? '')
    )
    expect(titled).toBeUndefined()
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
