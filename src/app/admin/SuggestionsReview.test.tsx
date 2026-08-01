/**
 * @jest-environment jsdom
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SuggestionsReview } from '@/app/admin/SuggestionsReview'
import type { Change } from '@/app/admin/types'

function makeSuggestion(overrides: Partial<Change> = {}): Change {
  return {
    id: 's1',
    changeType: 'UPDATE_PERSON',
    targetId: '@I1@',
    personName: 'Jane Doe',
    authorName: 'Test Author',
    authorEmail: 'author@example.com',
    previousValue: { name: 'John Doe', occupation: '' },
    newValue: { name: 'Jane Doe', occupation: 'Farmer' },
    appliedAt: '2026-01-01T00:00:00.000Z',
    status: 'pending',
    ...overrides,
  }
}

function fieldValueParagraph(container: HTMLElement, label: string): HTMLParagraphElement {
  const span = Array.from(container.querySelectorAll('span')).find(
    s => s.textContent?.trim() === label
  )
  if (!span) throw new Error(`Could not find label "${label}"`)
  const p = span.parentElement?.querySelector('p')
  if (!p) throw new Error(`Could not find value paragraph for "${label}"`)
  return p
}

describe('SuggestionsReview — before/after diff treatment', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
  })

  async function renderReview(suggestions: Change[]) {
    await act(async () => {
      root = createRoot(container)
      root.render(<SuggestionsReview initialSuggestions={suggestions} />)
    })
  }

  it('renders the "before" value struck through on the declined-soft background', async () => {
    await renderReview([makeSuggestion()])

    const before = fieldValueParagraph(container, 'Name before')
    expect(before.className).toContain('line-through')
    expect(before.className).toContain('bg-[var(--ft-declined-soft)]')
    expect(before.className).toContain('text-ink-3')
    expect(before.textContent).toBe('John Doe')
  })

  it('renders the "after" value on the approved-soft background without strikethrough', async () => {
    await renderReview([makeSuggestion()])

    const after = fieldValueParagraph(container, 'Name after')
    expect(after.className).not.toContain('line-through')
    expect(after.className).toContain('bg-[var(--ft-approved-soft)]')
    expect(after.textContent).toBe('Jane Doe')
  })

  it('renders an empty "before" value as italic "(none)" in the tertiary text color', async () => {
    await renderReview([makeSuggestion({ previousValue: {}, newValue: { name: 'Jane Doe' } })])

    const before = fieldValueParagraph(container, 'Name before')
    expect(before.textContent).toBe('(none)')
    expect(before.className).toContain('italic')
    expect(before.className).toContain('text-ink-3')
  })

  it('renders an empty "after" value as italic "(none)" in the tertiary text color', async () => {
    await renderReview([makeSuggestion({ previousValue: { occupation: 'Farmer' }, newValue: { occupation: '' } })])

    const after = fieldValueParagraph(container, 'Occupation after')
    expect(after.textContent).toBe('(none)')
    expect(after.className).toContain('italic')
    expect(after.className).toContain('text-ink-3')
  })
})

describe('SuggestionsReview — "View in tree" link', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
  })

  async function renderReview(suggestions: Change[]) {
    await act(async () => {
      root = createRoot(container)
      root.render(<SuggestionsReview initialSuggestions={suggestions} />)
    })
  }

  it('renders a link pointing to the tree re-rooted on the suggestion\'s target person', async () => {
    await renderReview([makeSuggestion({ targetId: '@I42@', personName: 'Ada Lovelace' })])

    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.textContent).toBe('View in tree')
    expect(link?.getAttribute('href')).toBe('/?root=%40I42%40')
    expect(link?.getAttribute('aria-label')).toBe('View Ada Lovelace in tree')
  })

  it('falls back to the target id in the aria-label when personName is missing', async () => {
    await renderReview([makeSuggestion({ targetId: '@I42@', personName: null })])

    const link = container.querySelector('a')
    expect(link?.getAttribute('aria-label')).toBe('View @I42@ in tree')
  })

  it('omits the link when targetId is not a valid GEDCOM id (e.g. CREATE_PERSON suggestions)', async () => {
    await renderReview([
      makeSuggestion({ changeType: 'CREATE_PERSON', targetId: '', personName: null }),
    ])

    expect(container.querySelector('a')).toBeNull()
  })
})
