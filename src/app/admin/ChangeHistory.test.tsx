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
