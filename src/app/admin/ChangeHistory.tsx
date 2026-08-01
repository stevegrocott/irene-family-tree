'use client'

import { useState, useEffect } from 'react'
import type { Change } from './types'
import {
  ADMIN_CARD_CLASS,
  ADMIN_CARD_META_CLASS,
  ADMIN_CARD_TITLE_CLASS,
  ADMIN_EMPTY_ICON_CLASS,
  ADMIN_EMPTY_ICON_WRAP_CLASS,
  ADMIN_EMPTY_STATE_CLASS,
  ADMIN_ERROR_TEXT_CLASS,
  ADMIN_SECONDARY_BUTTON_CLASS,
  ADMIN_STATUS_PILL_CLASS,
  BUTTON_SPINNER_WRAP_CLASS,
  SPINNER_CLASS,
} from '@/constants/tree'

/** HTTP status code indicating a conflict (used for revert conflicts) */
const HTTP_CONFLICT_STATUS = 409

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  sex: 'Sex',
  birthYear: 'Birth year',
  birthDate: 'Birth date',
  birthPlace: 'Birth place',
  deathYear: 'Death year',
  deathDate: 'Death date',
  deathPlace: 'Death place',
  occupation: 'Occupation',
  notes: 'Notes',
}

function FieldDiff({
  field,
  prev,
  next,
}: {
  field: string
  prev: unknown
  next: unknown
}) {
  const label = FIELD_LABELS[field] ?? field
  const prevStr = prev != null && prev !== '' ? String(prev) : '(none)'
  const nextStr = next != null && next !== '' ? String(next) : '(none)'
  const hasPrev = prev != null && prev !== ''
  const hasNext = next != null && next !== ''
  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <div>
        <span className="text-ink-3 uppercase tracking-wide text-[10px] font-semibold">
          {label} before
        </span>
        <p
          className={`font-mono mt-0.5 break-words rounded-[var(--ft-r-sm)] px-1.5 py-0.5 bg-[var(--ft-declined-soft)] text-ink-3 line-through ${hasPrev ? '' : 'italic no-underline'}`}
        >
          {prevStr}
        </p>
      </div>
      <div>
        <span className="text-ink-3 uppercase tracking-wide text-[10px] font-semibold">
          {label} after
        </span>
        <p
          className={`font-mono mt-0.5 break-words rounded-[var(--ft-r-sm)] px-1.5 py-0.5 bg-[var(--ft-approved-soft)] ${hasNext ? 'text-ink' : 'text-ink-3 italic'}`}
        >
          {nextStr}
        </p>
      </div>
    </div>
  )
}

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
        <span className={SPINNER_CLASS} />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div data-testid="change-history" className={ADMIN_EMPTY_STATE_CLASS}>
        <p className="text-[var(--ft-declined)] text-sm">{fetchError}</p>
      </div>
    )
  }

  if (changes.length === 0) {
    return (
      <div data-testid="change-history" className={ADMIN_EMPTY_STATE_CLASS}>
        <div className={ADMIN_EMPTY_ICON_WRAP_CLASS}>
          <svg className={ADMIN_EMPTY_ICON_CLASS} fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

        const changedFields: string[] = []
        if (c.newValue) {
          for (const key of Object.keys(c.newValue)) {
            const prev = c.previousValue?.[key]
            const next = c.newValue[key]
            if (String(prev ?? '') !== String(next ?? '')) {
              changedFields.push(key)
            }
          }
        }

        return (
          <div
            key={c.id}
            className={`${ADMIN_CARD_CLASS} ${isReverted ? 'opacity-50' : ''}`}
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className={ADMIN_CARD_TITLE_CLASS}>{c.personName || c.targetId}</p>
                <p className={ADMIN_CARD_META_CLASS}>
                  By <span className="text-ink-2">{c.authorName || c.authorEmail}</span>
                  {c.appliedAt && (
                    <> &middot; <span className="font-mono">{new Date(c.appliedAt).toLocaleDateString()}</span></>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`shrink-0 ${ADMIN_STATUS_PILL_CLASS}`}>
                  {c.changeType.replace(/_/g, ' ')}
                </span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full ${
                    isReverted
                      ? 'bg-[var(--ft-declined-soft)] text-[var(--ft-declined)]'
                      : 'bg-[var(--ft-approved-soft)] text-[var(--ft-approved)]'
                  }`}
                >
                  {isReverted ? 'Reverted' : 'Live'}
                </span>
              </div>
            </div>

            {changedFields.length > 0 && (
              <div className="space-y-3 mb-4 border-t border-line pt-3">
                {changedFields.map(field => (
                  <FieldDiff
                    key={field}
                    field={field}
                    prev={c.previousValue?.[field]}
                    next={c.newValue[field]}
                  />
                ))}
              </div>
            )}

            {revertErrors[c.id] && (
              <p className={`${ADMIN_ERROR_TEXT_CLASS} mb-3`}>{revertErrors[c.id]}</p>
            )}

            <button
              type="button"
              onClick={() => handleRevert(c.id)}
              disabled={isReverted || isReverting}
              className={`w-full ${ADMIN_SECONDARY_BUTTON_CLASS}`}
            >
              {isReverting ? (
                <span className={BUTTON_SPINNER_WRAP_CLASS}>
                  <span className={SPINNER_CLASS} />
                  Reverting…
                </span>
              ) : isReverted ? 'Reverted' : 'Revert'}
            </button>
          </div>
        )
      })}

      {loadMoreError && (
        <p className={`${ADMIN_ERROR_TEXT_CLASS} text-center`}>{loadMoreError}</p>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          className={`w-full ${ADMIN_SECONDARY_BUTTON_CLASS}`}
        >
          {loadingMore ? (
            <span className={BUTTON_SPINNER_WRAP_CLASS}>
              <span className={SPINNER_CLASS} />
              Loading…
            </span>
          ) : 'Load more'}
        </button>
      )}
    </div>
  )
}
