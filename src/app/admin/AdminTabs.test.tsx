/**
 * @jest-environment jsdom
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AdminTabs } from '@/app/admin/AdminTabs'

function findTab(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  const tabs = container.querySelectorAll('[role="tab"]')
  return Array.from(tabs).find(tab => tab.textContent?.trim() === name) as HTMLButtonElement | undefined
}

function findPanel(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(`#${id}`)
}

describe('AdminTabs — Duplicates tab', () => {
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

  async function renderAdminTabs() {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <AdminTabs
          suggestionsSlot={<div>Suggestions Content</div>}
          historySlot={<div>History Content</div>}
          duplicatesSlot={<div>Duplicates Content</div>}
        />
      )
    })
  }

  it('renders a "Duplicates" tab in the tablist', async () => {
    await renderAdminTabs()

    const duplicatesTab = findTab(container, 'Duplicates')
    expect(duplicatesTab).toBeDefined()
    expect(duplicatesTab?.getAttribute('aria-controls')).toBe('panel-duplicates')
    expect(duplicatesTab?.id).toBe('tab-duplicates')
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

    const duplicatesTab = findTab(container, 'Duplicates')!
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
