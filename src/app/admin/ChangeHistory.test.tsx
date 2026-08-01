/**
 * @jest-environment jsdom
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ChangeHistory } from '@/app/admin/ChangeHistory'
import type { Change } from '@/app/admin/types'

function makeChange(id: string, personName: string): Change {
  return {
    id,
    changeType: 'UPDATE_PERSON',
    targetId: `@${id}@`,
    personName,
    authorName: 'Test Author',
    authorEmail: 'author@example.com',
    previousValue: null,
    newValue: {},
    appliedAt: '2026-01-01T00:00:00.000Z',
    status: 'live',
  }
}

function findLoadMoreButton(container: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button'))
    .find(b => b.textContent?.includes('Load more')) as HTMLButtonElement | undefined
}

describe('ChangeHistory — load more', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  async function renderChangeHistory() {
    await act(async () => {
      root = createRoot(container)
      root.render(<ChangeHistory />)
    })
    await act(async () => { await Promise.resolve() })
  }

  it('shows the "Load more" button when the API reports hasMore: true', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ changes: [makeChange('c1', 'Page One Person')], page: 1, hasMore: true }),
    })

    await renderChangeHistory()

    expect(findLoadMoreButton(container)).toBeDefined()
  })

  it('hides the "Load more" button when the API reports hasMore: false', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ changes: [makeChange('c1', 'Only Person')], page: 1, hasMore: false }),
    })

    await renderChangeHistory()

    expect(findLoadMoreButton(container)).toBeUndefined()
  })

  it('clicking "Load more" appends the next page rather than replacing the current list', async () => {
    const calls: string[] = []
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      calls.push(url)
      if (url === '/api/admin/changes?page=1') {
        return {
          ok: true,
          json: async () => ({
            changes: [makeChange('c1', 'Page One Person')],
            page: 1,
            hasMore: true,
          }),
        }
      }
      if (url === '/api/admin/changes?page=2') {
        return {
          ok: true,
          json: async () => ({
            changes: [makeChange('c2', 'Page Two Person')],
            page: 2,
            hasMore: false,
          }),
        }
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    await renderChangeHistory()

    expect(container.textContent).toContain('Page One Person')
    expect(container.textContent).not.toContain('Page Two Person')

    const loadMoreButton = findLoadMoreButton(container)
    expect(loadMoreButton).toBeDefined()

    await act(async () => { loadMoreButton!.click() })
    await act(async () => { await Promise.resolve() })

    expect(calls).toContain('/api/admin/changes?page=2')
    // Both pages' items are present — the second page was appended, not swapped in.
    expect(container.textContent).toContain('Page One Person')
    expect(container.textContent).toContain('Page Two Person')

    // hasMore was false on page 2, so the button disappears.
    expect(findLoadMoreButton(container)).toBeUndefined()
  })
})

describe('ChangeHistory — diff treatment and status pills', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  async function renderChangeHistory() {
    await act(async () => {
      root = createRoot(container)
      root.render(<ChangeHistory />)
    })
    await act(async () => { await Promise.resolve() })
  }

  it('renders before/after field diffs for changed fields, struck-through before and (none) for empty values', async () => {
    const change: Change = {
      ...makeChange('c1', 'Diff Person'),
      previousValue: { name: 'Old Name', birthPlace: null },
      newValue: { name: 'New Name', birthPlace: 'Springfield' },
    }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ changes: [change], page: 1, hasMore: false }),
    })

    await renderChangeHistory()

    expect(container.textContent).toContain('Old Name')
    expect(container.textContent).toContain('New Name')
    expect(container.textContent).toContain('(none)')

    const beforeValue = Array.from(container.querySelectorAll('p')).find(p => p.textContent === 'Old Name')
    expect(beforeValue?.className).toContain('line-through')
    expect(beforeValue?.className).toContain('bg-[var(--ft-declined-soft)]')

    const afterValue = Array.from(container.querySelectorAll('p')).find(p => p.textContent === 'New Name')
    expect(afterValue?.className).toContain('bg-[var(--ft-approved-soft)]')
    expect(afterValue?.className).not.toContain('line-through')
  })

  it('shows a "Live" status pill for unreverted changes and switches to "Reverted" after a successful revert', async () => {
    const change = makeChange('c1', 'Status Person')
    global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ status: 'reverted' }) }
      }
      return { ok: true, json: async () => ({ changes: [change], page: 1, hasMore: false }) }
    })

    await renderChangeHistory()

    const findPill = (text: string) =>
      Array.from(container.querySelectorAll('span')).find(el => el.textContent === text)

    expect(findPill('Live')).toBeDefined()
    expect(findPill('Live')?.className).toContain('bg-[var(--ft-approved-soft)]')

    const revertButton = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent === 'Revert') as HTMLButtonElement
    expect(revertButton).toBeDefined()

    await act(async () => { revertButton.click() })
    await act(async () => { await Promise.resolve() })

    expect(findPill('Live')).toBeUndefined()
    expect(findPill('Reverted')?.className).toContain('bg-[var(--ft-declined-soft)]')
  })
})
