/**
 * @jest-environment jsdom
 */

// Required for React act() to work correctly in tests
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import SearchBar from './SearchBar'

interface Person {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  birthPlace: string | null
}

const persons: Person[] = [
  { gedcomId: '@I1@', name: 'Alice Brown',   birthPlace: 'Sheffield', birthYear: null, sex: 'F' },
  { gedcomId: '@I2@', name: 'Bob Green',     birthYear: '1920',       birthPlace: null, sex: 'M' },
  { gedcomId: '@I3@', name: 'Charlie White', birthYear: null,         birthPlace: null, sex: 'U' },
]

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

// Simulate a keydown on the search input (ArrowUp/ArrowDown/Enter).
async function pressKey(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

describe('SearchBar', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const onSelect = jest.fn()

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container)
      root.render(
        <SearchBar
          onSelect={onSelect}
          persons={persons}
        />,
      )
    })
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
    jest.clearAllMocks()
  })

  it('place search for "Sheffield" returns the Sheffield person', async () => {
    const input = container.querySelector('input')!
    await typeQuery(input, 'Sheffield')
    const list = container.querySelector('.search-results')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('Alice Brown')
    expect(list!.textContent).not.toContain('Bob Green')
    expect(list!.textContent).not.toContain('Charlie White')
  })

  it('year search for "1920" returns the 1920 person', async () => {
    const input = container.querySelector('input')!
    await typeQuery(input, '1920')
    const list = container.querySelector('.search-results')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('Bob Green')
    expect(list!.textContent).not.toContain('Alice Brown')
    expect(list!.textContent).not.toContain('Charlie White')
  })

  it('result item contains a sex dot element', async () => {
    const input = container.querySelector('input')!
    await typeQuery(input, 'Alice')
    const item = container.querySelector('.search-results li')
    expect(item).not.toBeNull()
    expect(item!.querySelector('.sex-dot')).not.toBeNull()
  })

  it('name-only search for "Charlie" returns Charlie White', async () => {
    const input = container.querySelector('input')!
    await typeQuery(input, 'Charlie')
    const list = container.querySelector('.search-results')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('Charlie White')
    expect(list!.textContent).not.toContain('Alice Brown')
    expect(list!.textContent).not.toContain('Bob Green')
  })

  describe('highlight and keyboard navigation (design system §4.3)', () => {
    it('highlights the matched substring in brass-soft without bolding', async () => {
      const input = container.querySelector('input')!
      await typeQuery(input, 'Alice')
      const name = container.querySelector('.search-results li .font-serif')!
      const highlight = name.querySelector('span')!
      expect(highlight).not.toBeNull()
      expect(highlight.textContent).toBe('Alice')
      expect(highlight.className).toMatch(/ft-brass-soft/)
      expect(highlight.className).not.toMatch(/font-bold/)
    })

    it('does not mark any result as keyboard-active before ArrowDown/ArrowUp is pressed', async () => {
      const input = container.querySelector('input')!
      await typeQuery(input, 'Alice')
      const item = container.querySelector('[data-testid="search-result-item"]')!
      expect(item.getAttribute('aria-selected')).toBe('false')
      expect(item.className).not.toMatch(/ft-accent-soft/)
    })

    it('ArrowDown marks the first result keyboard-active with accent-soft styling', async () => {
      const input = container.querySelector('input')!
      await typeQuery(input, 'Alice')
      await pressKey(input, 'ArrowDown')

      const item = container.querySelector('[data-testid="search-result-item"]')!
      expect(item.getAttribute('aria-selected')).toBe('true')
      expect(item.className).toMatch(/ft-accent-soft/)
      // The tick's colour is an inline style, not a class — the sex tints are
      // token/hex values applied via `style`, so the active accent is too.
      // Asserting on className here tested the mechanism rather than the
      // result, and failed while the rendered behaviour was correct.
      const tick = item.querySelector('.sex-dot') as HTMLElement
      expect(tick.style.backgroundColor).toBe('var(--ft-accent)')
    })

    it('ArrowDown is a no-op when there are no results', async () => {
      const input = container.querySelector('input')!
      await pressKey(input, 'ArrowDown')
      expect(container.querySelector('.search-results')).toBeNull()
    })

    it('Enter selects the keyboard-active result and closes the results', async () => {
      const input = container.querySelector('input')!
      await typeQuery(input, 'Alice')
      await pressKey(input, 'ArrowDown')
      await pressKey(input, 'Enter')

      expect(onSelect).toHaveBeenCalledWith('@I1@')
      expect(container.querySelector('.search-results')).toBeNull()
    })

    it('Enter does nothing before any result is keyboard-active', async () => {
      const input = container.querySelector('input')!
      await typeQuery(input, 'Alice')
      await pressKey(input, 'Enter')

      expect(onSelect).not.toHaveBeenCalled()
      expect(container.querySelector('.search-results')).not.toBeNull()
    })

    it('ArrowDown then ArrowUp moves the active row between multiple results', async () => {
      const multi: Person[] = [
        { gedcomId: '@M1@', name: 'Anna Kim',  birthPlace: null, birthYear: null, sex: 'F' },
        { gedcomId: '@M2@', name: 'Anand Roy', birthPlace: null, birthYear: null, sex: 'M' },
      ]
      const localOnSelect = jest.fn()
      const localContainer = document.createElement('div')
      document.body.appendChild(localContainer)
      let localRoot: ReturnType<typeof createRoot>
      await act(async () => {
        localRoot = createRoot(localContainer)
        localRoot.render(<SearchBar onSelect={localOnSelect} persons={multi} />)
      })

      try {
        const input = localContainer.querySelector('input')!
        await typeQuery(input, 'An')
        await pressKey(input, 'ArrowDown')
        let items = localContainer.querySelectorAll('[data-testid="search-result-item"]')
        expect(items[0].getAttribute('aria-selected')).toBe('true')
        expect(items[1].getAttribute('aria-selected')).toBe('false')

        await pressKey(input, 'ArrowDown')
        items = localContainer.querySelectorAll('[data-testid="search-result-item"]')
        expect(items[0].getAttribute('aria-selected')).toBe('false')
        expect(items[1].getAttribute('aria-selected')).toBe('true')

        // Clamped at the last result — a further ArrowDown keeps it in place.
        await pressKey(input, 'ArrowDown')
        items = localContainer.querySelectorAll('[data-testid="search-result-item"]')
        expect(items[1].getAttribute('aria-selected')).toBe('true')

        await pressKey(input, 'ArrowUp')
        items = localContainer.querySelectorAll('[data-testid="search-result-item"]')
        expect(items[0].getAttribute('aria-selected')).toBe('true')
        expect(items[1].getAttribute('aria-selected')).toBe('false')
      } finally {
        act(() => { localRoot.unmount() })
        document.body.removeChild(localContainer)
      }
    })
  })

  describe('mobile collapse (AC2: below 640px search is an icon button that opens a sheet)', () => {
    it('renders a 44px search toggle button and keeps the panel hidden below sm', () => {
      const toggle = container.querySelector<HTMLButtonElement>('[data-testid="search-toggle"]')
      expect(toggle).not.toBeNull()
      expect(toggle!.getAttribute('aria-label')).toBe('Search')
      expect(toggle!.className).toMatch(/min-h-11/)
      expect(toggle!.className).toMatch(/min-w-11/)
      // Hidden at sm+ (desktop keeps the panel open, not the toggle).
      expect(toggle!.className).toMatch(/sm:hidden/)

      const panel = container.querySelector<HTMLElement>('[data-testid="search-panel"]')
      expect(panel).not.toBeNull()
      // Hidden on mobile until toggled open; always shown at sm+.
      expect(panel!.className).toMatch(/hidden/)
      expect(panel!.className).toMatch(/sm:block/)
    })

    it('tapping the toggle button opens the panel and hides the toggle', () => {
      const toggle = container.querySelector<HTMLButtonElement>('[data-testid="search-toggle"]')!
      act(() => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

      const panelAfter = container.querySelector<HTMLElement>('[data-testid="search-panel"]')!
      expect(panelAfter.className).not.toMatch(/(^|\s)hidden(\s|$)/)

      const toggleAfter = container.querySelector<HTMLButtonElement>('[data-testid="search-toggle"]')
      expect(toggleAfter).toBeNull()
    })

    it('the panel close button collapses back to the toggle button', () => {
      const toggle = container.querySelector<HTMLButtonElement>('[data-testid="search-toggle"]')!
      act(() => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

      const closeBtn = container.querySelector<HTMLButtonElement>('[data-testid="search-close"]')!
      expect(closeBtn).not.toBeNull()
      act(() => { closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

      expect(container.querySelector('[data-testid="search-toggle"]')).not.toBeNull()
      const panelAfter = container.querySelector<HTMLElement>('[data-testid="search-panel"]')!
      expect(panelAfter.className).toMatch(/(^|\s)hidden(\s|$)/)
    })

    it('selecting a result collapses the panel back to the toggle button', async () => {
      const toggle = container.querySelector<HTMLButtonElement>('[data-testid="search-toggle"]')!
      act(() => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

      const input = container.querySelector('input')!
      await typeQuery(input, 'Alice')
      const item = container.querySelector<HTMLElement>('[data-testid="search-result-item"]')!
      act(() => { item.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

      expect(onSelect).toHaveBeenCalledWith('@I1@')
      expect(container.querySelector('[data-testid="search-toggle"]')).not.toBeNull()
      const panelAfter = container.querySelector<HTMLElement>('[data-testid="search-panel"]')!
      expect(panelAfter.className).toMatch(/(^|\s)hidden(\s|$)/)
    })
  })
})
