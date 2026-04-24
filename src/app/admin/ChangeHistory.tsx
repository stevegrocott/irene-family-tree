'use client'

import { useState, useEffect } from 'react'
import type { Change } from './types'

/** HTTP status code indicating a conflict (used for revert conflicts) */
const HTTP_CONFLICT_STATUS = 409

/**
 * Displays a paginated list of changes with the ability to revert them.
 *
 * Fetches pending changes from the API on mount and displays them with their
 * metadata (author, change type, date). Users can revert individual changes,
 * with real-time UI feedback for loading, success, and error states.
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
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [reverting, setReverting] = useState<Record<string, boolean>>({})
  const [revertedIds, setRevertedIds] = useState<Set<string>>(new Set())
  const [revertErrors, setRevertErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/admin/changes?page=1', { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => setChanges(data.changes ?? []))
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setFetchError('Failed to load change history. Please refresh to try again.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

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
        <span className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div data-testid="change-history" className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-red-400 text-sm">{fetchError}</p>
      </div>
    )
  }

  if (changes.length === 0) {
    return (
      <div data-testid="change-history" className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-white/60 text-sm">No change history to display.</p>
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
            className={`bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ${isReverted ? 'opacity-50' : ''}`}
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-white font-semibold text-base">{c.personName || c.targetId}</p>
                <p className="text-white/50 text-xs mt-0.5">
                  By <span className="text-white/70">{c.authorName || c.authorEmail}</span>
                  {c.appliedAt && (
                    <> &middot; {new Date(c.appliedAt).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {c.changeType.replace(/_/g, ' ')}
                </span>
                {isReverted && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-white/40 border border-white/20">
                    Reverted
                  </span>
                )}
              </div>
            </div>

            {revertErrors[c.id] && (
              <p className="text-red-400 text-xs mb-3">{revertErrors[c.id]}</p>
            )}

            <button
              onClick={() => handleRevert(c.id)}
              disabled={isReverted || isReverting}
              className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium border border-white/20 transition-colors"
            >
              {isReverting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Reverting…
                </span>
              ) : isReverted ? 'Reverted' : 'Revert'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
