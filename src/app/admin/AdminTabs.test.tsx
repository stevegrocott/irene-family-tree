/**
 * @jest-environment jsdom
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AdminTabs } from '@/app/admin/AdminTabs'

function findTab(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('[role="tab"]'))
    .find(el => el.textContent?.trim() === name) as HTMLButtonElement | undefined
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
    expect(duplicatesTab?.getAttribute('role')).toBe('tab')
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
    const duplicatesPanel = findPanel(container, 'panel-duplicates')
    expect(duplicatesPanel?.hasAttribute('hidden')).toBe(false)
    expect(container.textContent).toContain('Duplicates Content')

    // Other panels are hidden once Duplicates is active.
    expect(findPanel(container, 'panel-suggestions')?.hasAttribute('hidden')).toBe(true)
    expect(findPanel(container, 'panel-history')?.hasAttribute('hidden')).toBe(true)
  })
})
