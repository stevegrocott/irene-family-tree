/**
 * @jest-environment jsdom
 */

// Tell React we're in a test environment so act() works correctly
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import EmptyState, { type EmptyStateProps, type EmptyStateStartPerson } from './EmptyState'

const ROOT: EmptyStateStartPerson = { gedcomId: '@I1@', name: 'Alice Brown', birthYear: '1850', deathYear: '1920' }
const EARLIEST: EmptyStateStartPerson = { gedcomId: '@I2@', name: 'Bob Green', birthYear: '1800' }
const RESUME: EmptyStateStartPerson = { gedcomId: '@I3@', name: 'Charlie White' }

describe('EmptyState', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
    jest.restoreAllMocks()
  })

  function renderEmptyState(props: Partial<EmptyStateProps> = {}) {
    const onSelectPerson = jest.fn()
    const onSearchClick = jest.fn()
    act(() => {
      root.render(
        <EmptyState
          personCount={props.personCount}
          pendingCount={props.pendingCount}
          rootPerson={props.rootPerson}
          earliestAncestor={props.earliestAncestor}
          resumePerson={props.resumePerson}
          onSelectPerson={props.onSelectPerson ?? onSelectPerson}
          onSearchClick={props.onSearchClick ?? onSearchClick}
        />
      )
    })
    return { onSelectPerson, onSearchClick }
  }

  function rows() {
    return Array.from(container.querySelectorAll('[data-testid="empty-state-start-rows"] > li > button'))
  }

  it('renders the title and subline', () => {
    renderEmptyState()
    expect(container.querySelector('[data-testid="empty-state-title"]')!.textContent).toBe('Who are you looking for?')
    expect(container.querySelector('[data-testid="empty-state-subline"]')).not.toBeNull()
  })

  it('fires onSearchClick when the search field is activated', () => {
    const { onSearchClick } = renderEmptyState()
    const search = container.querySelector('[data-testid="empty-state-search"]') as HTMLButtonElement
    act(() => { search.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onSearchClick).toHaveBeenCalledTimes(1)
  })

  describe('start rows', () => {
    it('renders no rows section when no start people are provided', () => {
      renderEmptyState()
      expect(container.querySelector('[data-testid="empty-state-start-rows"]')).toBeNull()
      expect(container.querySelector('[data-testid="empty-state-eyebrow"]')).toBeNull()
    })

    it('renders only the rows for the start people that are provided, in root/earliest/resume order', () => {
      renderEmptyState({ rootPerson: ROOT, earliestAncestor: EARLIEST, resumePerson: RESUME })
      const ids = rows().map(r => r.getAttribute('data-testid'))
      expect(ids).toEqual([
        'empty-state-row-root',
        'empty-state-row-earliest',
        'empty-state-row-resume',
      ])
    })

    it('omits rows for people that are null or undefined', () => {
      renderEmptyState({ rootPerson: ROOT, earliestAncestor: null, resumePerson: undefined })
      const ids = rows().map(r => r.getAttribute('data-testid'))
      expect(ids).toEqual(['empty-state-row-root'])
    })

    it('gives the root person row the brass-line emphasis border, and other rows the plain hairline', () => {
      renderEmptyState({ rootPerson: ROOT, earliestAncestor: EARLIEST })
      const rootRow = container.querySelector('[data-testid="empty-state-row-root"]')!
      const earliestRow = container.querySelector('[data-testid="empty-state-row-earliest"]')!
      expect(rootRow.className).toMatch(/border-\[var\(--ft-brass-line\)\]/)
      expect(earliestRow.className).not.toMatch(/border-\[var\(--ft-brass-line\)\]/)
      expect(earliestRow.className).toMatch(/border-line/)
    })

    it('renders the row label and person name', () => {
      renderEmptyState({ resumePerson: RESUME })
      const row = container.querySelector('[data-testid="empty-state-row-resume"]')!
      expect(row.textContent).toContain('Resume where you left off')
      expect(row.textContent).toContain('Charlie White')
    })

    it('renders a birth–death year range when both are present', () => {
      renderEmptyState({ rootPerson: ROOT })
      const row = container.querySelector('[data-testid="empty-state-row-root"]')!
      expect(row.textContent).toContain('1850–1920')
    })

    it('renders only the birth year when no death year is present', () => {
      renderEmptyState({ earliestAncestor: EARLIEST })
      const row = container.querySelector('[data-testid="empty-state-row-earliest"]')!
      expect(row.textContent).toContain('1800')
      expect(row.textContent).not.toContain('–')
    })

    it('renders no year text when neither birth nor death year is present', () => {
      renderEmptyState({ resumePerson: RESUME })
      const row = container.querySelector('[data-testid="empty-state-row-resume"]')!
      expect(row.textContent!.trim()).toBe('Resume where you left offCharlie White')
    })

    it('calls onSelectPerson with the row person\'s gedcomId when clicked', () => {
      const { onSelectPerson } = renderEmptyState({ rootPerson: ROOT, earliestAncestor: EARLIEST })
      const earliestRow = container.querySelector('[data-testid="empty-state-row-earliest"]') as HTMLButtonElement
      act(() => { earliestRow.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onSelectPerson).toHaveBeenCalledWith('@I2@')
    })
  })

  describe('footer', () => {
    it('renders no footer while personCount is omitted (still loading)', () => {
      renderEmptyState()
      expect(container.querySelector('[data-testid="empty-state-footer"]')).toBeNull()
    })

    it('renders the singular "person" label when personCount is 1', () => {
      renderEmptyState({ personCount: 1 })
      expect(container.querySelector('[data-testid="empty-state-person-count"]')!.textContent).toBe('1 person in the tree')
    })

    it('renders the plural "people" label when personCount is not 1', () => {
      renderEmptyState({ personCount: 42 })
      expect(container.querySelector('[data-testid="empty-state-person-count"]')!.textContent).toBe('42 people in the tree')
    })

    it('renders the zero count with plural "people"', () => {
      renderEmptyState({ personCount: 0 })
      expect(container.querySelector('[data-testid="empty-state-footer"]')).not.toBeNull()
      expect(container.querySelector('[data-testid="empty-state-person-count"]')!.textContent).toBe('0 people in the tree')
    })

    it('renders the pending pill when pendingCount is greater than 0', () => {
      renderEmptyState({ personCount: 10, pendingCount: 3 })
      const pill = container.querySelector('[data-testid="empty-state-pending-pill"]')
      expect(pill).not.toBeNull()
      expect(pill!.textContent).toBe('3 pending')
    })

    it('omits the pending pill when pendingCount is 0 or omitted', () => {
      renderEmptyState({ personCount: 10, pendingCount: 0 })
      expect(container.querySelector('[data-testid="empty-state-pending-pill"]')).toBeNull()

      renderEmptyState({ personCount: 10 })
      expect(container.querySelector('[data-testid="empty-state-pending-pill"]')).toBeNull()
    })
  })
})
