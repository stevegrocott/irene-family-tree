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
}

function render(overrides: Partial<PersonData> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <PersonNode data={{ ...baseData, ...overrides }} {...({} as never)} />
    )
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      document.body.removeChild(container)
    },
  }
}

describe('PersonNode avatar', () => {
  it('renders initials "IT" for "Irene Tunnicliffe"', () => {
    const { container, cleanup } = render({ name: 'Irene Tunnicliffe' })
    expect(container.textContent).toContain('IT')
    cleanup()
  })

  it('applies bg-indigo-900/40 when generation is -1', () => {
    const { container, cleanup } = render({ generation: -1 })
    expect(container.innerHTML).toContain('bg-indigo-900/40')
    cleanup()
  })

  it('applies bg-emerald-900/40 when generation is 1', () => {
    const { container, cleanup } = render({ generation: 1 })
    expect(container.innerHTML).toContain('bg-emerald-900/40')
    cleanup()
  })

  it('applies neither bg-indigo-900/40 nor bg-emerald-900/40 when generation is 0', () => {
    const { container, cleanup } = render({ generation: 0 })
    expect(container.innerHTML).not.toContain('bg-indigo-900/40')
    expect(container.innerHTML).not.toContain('bg-emerald-900/40')
    cleanup()
  })

  it('renders no photo img and shows initials when photoUrl is absent', () => {
    const { container, cleanup } = render({ photoUrl: null })
    expect(container.querySelector('[data-testid="person-node-photo"]')).toBeNull()
    expect(container.textContent).toContain('IT')
    cleanup()
  })

  it('renders the photo img when photoUrl is present', () => {
    const { container, cleanup } = render({
      photoUrl: 'https://example.com/photo.jpg',
    })
    const img = container.querySelector('[data-testid="person-node-photo"]') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://example.com/photo.jpg')
    cleanup()
  })

  it('falls back to initials when the photo img fails to load', () => {
    const { container, cleanup } = render({
      photoUrl: 'https://example.com/broken.jpg',
    })
    const img = container.querySelector('[data-testid="person-node-photo"]') as HTMLImageElement
    act(() => {
      img.dispatchEvent(new Event('error', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="person-node-photo"]')).toBeNull()
    expect(container.textContent).toContain('IT')
    cleanup()
  })
})
