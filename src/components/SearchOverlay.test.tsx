/**
 * @jest-environment jsdom
 */

// Tell React we're in a test environment so act() works correctly
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import SearchOverlay, { type SearchOverlayPerson } from './SearchOverlay'

const PERSONS: SearchOverlayPerson[] = [
  { gedcomId: '@I1@', name: 'Alice Brown', sex: 'F', birthYear: '1850', birthPlace: 'Sheffield' },
  { gedcomId: '@I2@', name: 'Bob Green', sex: 'M', birthYear: '1920', birthPlace: null },
  { gedcomId: '@I3@', name: 'Charlie White', sex: 'U', birthYear: null, birthPlace: null },
]

const MANY_PERSONS: SearchOverlayPerson[] = Array.from({ length: 12 }, (_, i) => ({
  gedcomId: `@I${i}@`,
  name: `Alice Number${i}`,
  sex: 'F',
  birthYear: null,
}))

// Simulate typing into a controlled React input
async function typeQuery(input: HTMLInputElement, value: string) {
  await act(async () => {
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    nativeValueSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SearchOverlay', () => {
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

  function renderOverlay(props: Partial<React.ComponentProps<typeof SearchOverlay>> = {}) {
    const onSelect = jest.fn()
    const onClose = jest.fn()
    act(() => {
      root.render(
        <SearchOverlay
          open={props.open ?? true}
          persons={props.persons ?? PERSONS}
          onSelect={props.onSelect ?? onSelect}
          onClose={props.onClose ?? onClose}
        />
      )
    })
    return { onSelect, onClose }
  }

  function results() {
    return Array.from(container.querySelectorAll('[data-testid="search-overlay-result"]'))
  }

  it('renders nothing when closed', () => {
    renderOverlay({ open: false })
    expect(container.querySelector('[data-testid="search-overlay-scrim"]')).toBeNull()
  })

  it('renders the scrim, panel and input when open', () => {
    renderOverlay()
    expect(container.querySelector('[data-testid="search-overlay-scrim"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="search-overlay-panel"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="search-overlay-input"]')).not.toBeNull()
  })

  describe('result rendering', () => {
    it('shows a starting sample of all persons when the query is empty', () => {
      renderOverlay()
      expect(results()).toHaveLength(PERSONS.length)
      expect(container.querySelector('[data-testid="search-overlay-results"]')!.textContent).toContain('Alice Brown')
    })

    it('caps the empty-query sample at 8 results', () => {
      renderOverlay({ persons: MANY_PERSONS })
      expect(results()).toHaveLength(8)
    })

    it('filters results by case-insensitive substring match against name', async () => {
      renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, 'bob')
      const list = results()
      expect(list).toHaveLength(1)
      expect(list[0].textContent).toContain('Bob Green')
    })

    it('caps filtered matches at 9 results', async () => {
      renderOverlay({ persons: MANY_PERSONS })
      const input = container.querySelector('input')!
      await typeQuery(input, 'Alice')
      expect(results()).toHaveLength(9)
    })

    it('highlights the matched substring within the result name', async () => {
      renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, 'lice')
      const mark = results()[0].querySelector('span > span')
      expect(mark).not.toBeNull()
      expect(mark!.textContent).toBe('lice')
    })

    it('renders the birth year when present, and omits it when absent', async () => {
      renderOverlay()
      const input = container.querySelector('input')!

      await typeQuery(input, 'Alice')
      expect(results()[0].textContent).toContain('1850')

      await typeQuery(input, 'Charlie')
      const charlieResult = results()[0]
      expect(charlieResult.textContent).not.toMatch(/\d{4}/)
    })

    it('calls onSelect with the gedcomId when a result is clicked', async () => {
      const { onSelect } = renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, 'Bob')
      act(() => { results()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onSelect).toHaveBeenCalledWith('@I2@')
    })

    it('trims whitespace from the query before matching', async () => {
      renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, '  bob  ')
      expect(results()).toHaveLength(1)
      expect(results()[0].textContent).toContain('Bob Green')
    })

    it('filters results by case-insensitive substring match against birth place', async () => {
      renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, 'sheff')
      const list = results()
      expect(list).toHaveLength(1)
      expect(list[0].textContent).toContain('Alice Brown')
    })

    it('filters results by substring match against birth year', async () => {
      renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, '1920')
      const list = results()
      expect(list).toHaveLength(1)
      expect(list[0].textContent).toContain('Bob Green')
    })

    it('does not match a person whose birth place differs from the query', async () => {
      renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, 'Sheffield')
      const list = results()
      expect(list.map(r => r.textContent)).not.toEqual(
        expect.arrayContaining([expect.stringContaining('Bob Green')])
      )
    })

    it('does not throw when filtering a person with a null birth place', async () => {
      renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, 'Bob')
      expect(results()).toHaveLength(1)
      expect(results()[0].textContent).toContain('Bob Green')
    })
  })

  describe('no-match copy', () => {
    it('shows no-match copy when the query matches nobody', async () => {
      renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, 'Zzyzx')
      const noResults = container.querySelector('[data-testid="search-overlay-no-results"]')
      expect(noResults).not.toBeNull()
      expect(noResults!.textContent).toBe('No one matches “Zzyzx”.')
      expect(container.querySelector('[data-testid="search-overlay-results"]')).toBeNull()
    })

    it('does not show no-match copy for an empty query', () => {
      renderOverlay()
      expect(container.querySelector('[data-testid="search-overlay-no-results"]')).toBeNull()
    })

    it('does not show no-match copy for a whitespace-only query', async () => {
      renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, '   ')
      expect(container.querySelector('[data-testid="search-overlay-no-results"]')).toBeNull()
      expect(container.querySelector('[data-testid="search-overlay-results"]')).not.toBeNull()
    })

    it('replaces no-match copy with results once a matching query is typed', async () => {
      renderOverlay()
      const input = container.querySelector('input')!
      await typeQuery(input, 'Zzyzx')
      expect(container.querySelector('[data-testid="search-overlay-no-results"]')).not.toBeNull()

      await typeQuery(input, 'Bob')
      expect(container.querySelector('[data-testid="search-overlay-no-results"]')).toBeNull()
      expect(results()).toHaveLength(1)
    })
  })

  describe('dismissal', () => {
    it('calls onClose when the scrim is clicked', () => {
      const { onClose } = renderOverlay()
      const scrim = container.querySelector('[data-testid="search-overlay-scrim"]')!
      act(() => { scrim.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose when the panel itself is clicked', () => {
      const { onClose } = renderOverlay()
      const panel = container.querySelector('[data-testid="search-overlay-panel"]')!
      act(() => { panel.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onClose).not.toHaveBeenCalled()
    })

    it('calls onClose when the close button is clicked', () => {
      const { onClose } = renderOverlay()
      const closeBtn = container.querySelector('[data-testid="search-overlay-close"]') as HTMLButtonElement
      act(() => { closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose on Escape', () => {
      const { onClose } = renderOverlay()
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('selects the first result on Enter', async () => {
    const { onSelect } = renderOverlay()
    const input = container.querySelector('input')! as HTMLInputElement
    await typeQuery(input, 'Alice')
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith('@I1@')
  })

  it('resets the query when the overlay closes and reopens', async () => {
    const onSelect = jest.fn()
    const onClose = jest.fn()
    act(() => {
      root.render(<SearchOverlay open={true} persons={PERSONS} onSelect={onSelect} onClose={onClose} />)
    })
    const input = container.querySelector('input')! as HTMLInputElement
    await typeQuery(input, 'Bob')
    expect(input.value).toBe('Bob')

    act(() => {
      root.render(<SearchOverlay open={false} persons={PERSONS} onSelect={onSelect} onClose={onClose} />)
    })
    act(() => {
      root.render(<SearchOverlay open={true} persons={PERSONS} onSelect={onSelect} onClose={onClose} />)
    })

    const reopenedInput = container.querySelector('input')! as HTMLInputElement
    expect(reopenedInput.value).toBe('')
  })
})
