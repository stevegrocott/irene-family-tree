'use client'

import { useState, useEffect } from 'react'
import type { Change } from './types'

/** HTTP status code indicating a conflict (used for revert conflicts) */
const HTTP_CONFLICT_STATUS = 409

/**
 * Displays a paginated list of changes with the ability to revert them.
 *
 * Fetches the first page of changes on mount and displays them with their
 * metadata (author, change type, date). A "Load more" button appends
 * subsequent pages to the list until the API reports no more are available.
 * Users can revert individual changes, with real-time UI feedback for
 * loading, success, and error states.
 *
 * @component
 * @returns {JSX.Element} A container with change cards, loading state, or error message
 *
 * @example
 * // Usage in an admin page
 * <ChangeHistory />
 */
export function ChangeHistory() {
  const [changes, setChanges] = useState<Change[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [reverting, setReverting] = useState<Record<string, boolean>>({})
  const [revertedIds, setRevertedIds] = useState<Set<string>>(new Set())
  const [revertErrors, setRevertErrors] = useState<Record<string, string>>({})

  async function fetchChangesPage(pageNum: number, signal?: AbortSignal) {
    const res = await fetch(`/api/admin/changes?page=${pageNum}`, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const data = await fetchChangesPage(1, controller.signal)
        setChanges(data.changes ?? [])
        setHasMore(!!data.hasMore)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setFetchError('Failed to load change history. Please refresh to try again.')
      } finally {
        setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  /**
   * Fetches the next page of changes and appends them to the existing list.
   *
   * @async
   * @returns {Promise<void>}
   */
  async function handleLoadMore() {
    const nextPage = page + 1
    const controller = new AbortController()
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const data = await fetchChangesPage(nextPage, controller.signal)
      setChanges(prev => [...prev, ...(data.changes ?? [])])
      setHasMore(!!data.hasMore)
      setPage(nextPage)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setLoadMoreError('Failed to load more changes. Please try again.')
    } finally {
      setLoadingMore(false)
    }
  }

  /**
   * Attempts to revert a change by ID.
   *
   * Updates UI state to show loading, handles conflict errors (409), and tracks
   * reverted IDs and errors. On success, the change is marked as reverted.
   *
   * @async
   * @param {string} id - The ID of the change to revert
   * @returns {Promise<void>}
   */
  async function handleRevert(id: string) {
    setReverting(r => ({ ...r, [id]: true }))
    setRevertErrors(e => {
      const { [id]: _, ...rest } = e
      return rest
    })
    try {
      const res = await fetch(`/api/admin/changes/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revert' }),
      })
      if (res.status === HTTP_CONFLICT_STATUS) {
        const data = await res.json()
        setRevertErrors(e => ({ ...e, [id]: data.error ?? 'Cannot revert: conflicting change exists.' }))
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRevertedIds(s => new Set(s).add(id))
    } catch {
      setRevertErrors(e => ({ ...e, [id]: 'Failed to revert change. Please try again.' }))
    } finally {
      setReverting(r => {
        const { [id]: _, ...rest } = r
        return rest
      })
    }
  }

  if (loading) {
    return (
      <div data-testid="change-history" className="flex items-center justify-center py-20">
        <span className="w-6 h-6 border-2 border-line border-t-ink rounded-full animate-spin" />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div data-testid="change-history" className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[var(--ft-declined)] text-sm">{fetchError}</p>
      </div>
    )
  }

  if (changes.length === 0) {
    return (
      <div data-testid="change-history" className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-ink-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-ink-2 text-sm">No change history to display.</p>
      </div>
    )
  }

  return (
    <div data-testid="change-history" className="space-y-4">
      {changes.map(c => {
        const isReverted = revertedIds.has(c.id)
        const isReverting = !!reverting[c.id]

        return (
          <div
            key={c.id}
            className={`bg-surface border border-line rounded-panel p-5 shadow-[var(--ft-shadow-1)] ${isReverted ? 'opacity-50' : ''}`}
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="font-serif text-[17px] font-semibold leading-tight text-ink">{c.personName || c.targetId}</p>
                <p className="text-ink-3 text-xs mt-0.5">
                  By <span className="text-ink-2">{c.authorName || c.authorEmail}</span>
                  {c.appliedAt && (
                    <> &middot; <span className="font-mono">{new Date(c.appliedAt).toLocaleDateString()}</span></>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--ft-pending-soft)] text-[var(--ft-pending)]">
                  {c.changeType.replace(/_/g, ' ')}
                </span>
                {isReverted && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-surface-2 text-ink-3">
                    Reverted
                  </span>
                )}
              </div>
            </div>

            {revertErrors[c.id] && (
              <p className="text-[var(--ft-declined)] text-xs mb-3">{revertErrors[c.id]}</p>
            )}

            <button
              type="button"
              onClick={() => handleRevert(c.id)}
              disabled={isReverted || isReverting}
              className="w-full py-2 rounded-[var(--ft-r-md)] bg-surface hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed text-ink text-sm font-medium border border-line transition-colors"
            >
              {isReverting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin" />
                  Reverting…
                </span>
              ) : isReverted ? 'Reverted' : 'Revert'}
            </button>
          </div>
        )
      })}

      {loadMoreError && (
        <p className="text-[var(--ft-declined)] text-xs text-center">{loadMoreError}</p>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="w-full py-2 rounded-[var(--ft-r-md)] bg-surface hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed text-ink text-sm font-medium border border-line transition-colors"
        >
          {loadingMore ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin" />
              Loading…
            </span>
          ) : 'Load more'}
        </button>
      )}
    </div>
  )
}
