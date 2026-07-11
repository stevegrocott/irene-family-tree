/**
 * @jest-environment jsdom
 */

// Tell React we're in a test environment so act() works correctly
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import PersonNode from './PersonNode'
import type { PersonData } from '@/types/tree'

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
      <PersonNode data={{ ...baseData, ...overrides }} {...({} as never)} />
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

  it('applies bg-indigo-900/40 when generation is -1', () => {
    const el = render({ generation: -1 })
    expect(el.innerHTML).toContain('bg-indigo-900/40')
  })

  it('applies bg-emerald-900/40 when generation is 1', () => {
    const el = render({ generation: 1 })
    expect(el.innerHTML).toContain('bg-emerald-900/40')
  })

  it('applies neither bg-indigo-900/40 nor bg-emerald-900/40 when generation is 0', () => {
    const el = render({ generation: 0 })
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
