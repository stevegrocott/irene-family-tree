/**
 * @jest-environment jsdom
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AdminTabs } from '@/app/admin/AdminTabs'

function findTab(container: HTMLElement, id: string): HTMLButtonElement | null {
  return container.querySelector(`#${id}`)
}

function findPanel(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(`#${id}`)
}

function hasClass(el: Element, cls: string): boolean {
  return el.className.split(/\s+/).includes(cls)
}

describe('AdminTabs', () => {
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

  async function renderAdminTabs(suggestionsCount?: number) {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <AdminTabs
          suggestionsSlot={<div>Suggestions Content</div>}
          historySlot={<div>History Content</div>}
          duplicatesSlot={<div>Duplicates Content</div>}
          suggestionsCount={suggestionsCount}
        />
      )
    })
  }

  describe('Duplicates tab', () => {
    it('renders a "Duplicates" tab in the tablist', async () => {
      await renderAdminTabs()

      const duplicatesTab = findTab(container, 'tab-duplicates')
      expect(duplicatesTab).not.toBeNull()
      expect(duplicatesTab?.getAttribute('aria-controls')).toBe('panel-duplicates')
      expect(duplicatesTab?.textContent?.trim()).toBe('Duplicates')
    })

    it('keeps the Duplicates panel hidden until the tab is selected', async () => {
      await renderAdminTabs()

      const duplicatesPanel = findPanel(container, 'panel-duplicates')
      expect(duplicatesPanel).not.toBeNull()
      // jsdom doesn't apply the UA stylesheet that visually hides `[hidden]`
      // elements, so assert on the attribute itself rather than textContent.
      expect(duplicatesPanel?.hasAttribute('hidden')).toBe(true)
    })

    it('clicking the Duplicates tab reveals duplicatesSlot content and marks the tab selected', async () => {
      await renderAdminTabs()

      const duplicatesTab = findTab(container, 'tab-duplicates')!
      await act(async () => { duplicatesTab.click() })

      expect(duplicatesTab.getAttribute('aria-selected')).toBe('true')
      expect(container.textContent).toContain('Duplicates Content')

      const duplicatesPanel = findPanel(container, 'panel-duplicates')
      const suggestionsPanel = findPanel(container, 'panel-suggestions')
      const historyPanel = findPanel(container, 'panel-history')

      expect(duplicatesPanel?.hasAttribute('hidden')).toBe(false)
      expect(suggestionsPanel?.hasAttribute('hidden')).toBe(true)
      expect(historyPanel?.hasAttribute('hidden')).toBe(true)
    })
  })

  describe('underline tab styling', () => {
    it('gives the active tab an accent underline and text-1 ink color', async () => {
      await renderAdminTabs()

      const suggestionsTab = findTab(container, 'tab-suggestions')!

      expect(suggestionsTab.getAttribute('aria-selected')).toBe('true')
      expect(hasClass(suggestionsTab, 'border-accent')).toBe(true)
      expect(hasClass(suggestionsTab, 'text-ink')).toBe(true)
    })

    it('gives inactive tabs no accent underline and text-3 ink color', async () => {
      await renderAdminTabs()

      const historyTab = findTab(container, 'tab-history')!
      const duplicatesTab = findTab(container, 'tab-duplicates')!

      for (const tab of [historyTab, duplicatesTab]) {
        expect(tab.getAttribute('aria-selected')).toBe('false')
        expect(hasClass(tab, 'border-accent')).toBe(false)
        expect(hasClass(tab, 'text-ink-3')).toBe(true)
      }
    })

    it('moves the underline to whichever tab is clicked', async () => {
      await renderAdminTabs()

      const suggestionsTab = findTab(container, 'tab-suggestions')!
      const historyTab = findTab(container, 'tab-history')!

      await act(async () => { historyTab.click() })

      expect(historyTab.getAttribute('aria-selected')).toBe('true')
      expect(hasClass(historyTab, 'border-accent')).toBe(true)
      expect(hasClass(historyTab, 'text-ink')).toBe(true)

      expect(suggestionsTab.getAttribute('aria-selected')).toBe('false')
      expect(hasClass(suggestionsTab, 'border-accent')).toBe(false)
      expect(hasClass(suggestionsTab, 'text-ink-3')).toBe(true)
    })
  })

  describe('suggestions count badge', () => {
    it('renders the suggestions count in a badge on the Pending Suggestions tab', async () => {
      await renderAdminTabs(7)

      const suggestionsTab = findTab(container, 'tab-suggestions')!
      const badge = suggestionsTab.querySelector('span')

      expect(suggestionsTab.textContent).toContain('Pending Suggestions')
      expect(badge).not.toBeNull()
      expect(badge?.textContent?.trim()).toBe('7')
      expect(badge?.className).toEqual(expect.stringContaining('ft-pending-soft'))
    })

    it('defaults the badge to 0 when no count is provided', async () => {
      await renderAdminTabs()

      const suggestionsTab = findTab(container, 'tab-suggestions')!
      const badge = suggestionsTab.querySelector('span')
      expect(badge).not.toBeNull()
      expect(badge?.textContent?.trim()).toBe('0')
    })

    it('does not render a count badge on the History or Duplicates tabs', async () => {
      await renderAdminTabs(7)

      const historyTab = findTab(container, 'tab-history')!
      const duplicatesTab = findTab(container, 'tab-duplicates')!

      expect(historyTab.textContent?.trim()).toBe('Change History')
      expect(duplicatesTab.textContent?.trim()).toBe('Duplicates')
    })

    it('updates the badge when the suggestions count changes on re-render', async () => {
      await renderAdminTabs(2)

      expect(findTab(container, 'tab-suggestions')!.querySelector('span')?.textContent).toBe('2')

      await act(async () => {
        root.render(
          <AdminTabs
            suggestionsSlot={<div>Suggestions Content</div>}
            historySlot={<div>History Content</div>}
            duplicatesSlot={<div>Duplicates Content</div>}
            suggestionsCount={9}
          />
        )
      })

      expect(findTab(container, 'tab-suggestions')!.querySelector('span')?.textContent).toBe('9')
    })
  })
})

describe('AdminTabs — suggestions count badge', () => {
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

  function renderWithCount(suggestionsCount?: number) {
    return act(async () => {
      root = createRoot(container)
      root.render(
        <AdminTabs
          suggestionsSlot={<div>Suggestions Content</div>}
          historySlot={<div>History Content</div>}
          duplicatesSlot={<div>Duplicates Content</div>}
          suggestionsCount={suggestionsCount}
        />
      )
    })
  }

  it('renders the given suggestionsCount in the badge', async () => {
    await renderWithCount(7)

    const badge = container.querySelector('[data-testid="suggestions-count-badge"]')
    expect(badge).not.toBeNull()
    expect(badge?.textContent?.trim()).toBe('7')
  })

  it('defaults the badge to 0 when suggestionsCount is not provided', async () => {
    await renderWithCount(undefined)

    const badge = container.querySelector('[data-testid="suggestions-count-badge"]')
    expect(badge?.textContent?.trim()).toBe('0')
  })
})
