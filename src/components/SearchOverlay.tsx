/**
 * @module SearchOverlay
 * @description Global `⌘K` search overlay: a blurred scrim behind a centred
 * panel with an autofocused input and a result list. Available from any view
 * (wired up by the caller — see `FamilyTree.tsx`); this component owns only
 * its own filtering, highlighting and dismissal (`Escape` or scrim click).
 * Presentational — the caller supplies the person list and handles what
 * happens on selection or close.
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import { SEX_AVATAR_BG } from '@/constants/tree'

/** Minimal person record used for search filtering and result rendering. */
export interface SearchOverlayPerson {
  gedcomId: string
  name: string
  sex: string | null
  birthYear?: string | null
}

/** Props for {@link SearchOverlay}. */
export interface SearchOverlayProps {
  /** Whether the overlay is mounted and visible. Renders nothing when `false`. */
  open: boolean
  /** Full person list to search over. Filtering happens client-side against `name`. */
  persons: SearchOverlayPerson[]
  /** Fired with a result's GEDCOM id when it's chosen (click or Enter). */
  onSelect: (gedcomId: string) => void
  /** Fired on scrim click, the close button, or `Escape`. */
  onClose: () => void
}

/** Results shown for an empty query — a starting sample, not a match set. */
const MAX_EMPTY_QUERY_RESULTS = 8
/** Cap on rendered matches once a query is entered (docs/DESIGN_SYSTEM.md §4.3). */
const MAX_RESULTS = 9

interface NameMatch {
  before: string
  match: string
  after: string
}

/** Finds the first case-insensitive occurrence of `query` in `name`, or `null` if absent. */
function findMatch(name: string, query: string): NameMatch | null {
  if (!query) return null
  const idx = name.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return null
  return { before: name.slice(0, idx), match: name.slice(idx, idx + query.length), after: name.slice(idx + query.length) }
}

/**
 * `⌘K` search overlay: scrim, panel, autofocused input, and result rows.
 *
 * @param {SearchOverlayProps} props - Component props.
 * @returns {JSX.Element | null} The overlay, or `null` when closed.
 */
export default function SearchOverlay({ open, persons, onSelect, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)

  // Reset the query whenever the overlay transitions closed -> open. Adjusting
  // state during render (rather than in the effect below) avoids a spurious
  // extra render pass — see https://react.dev/learn/you-might-not-need-an-effect.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setQuery('')
  }

  useEffect(() => {
    if (!open) return

    previouslyFocusedElementRef.current = document.activeElement as HTMLElement | null
    inputRef.current?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocusedElementRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const trimmedQuery = query.trim()
  const results = trimmedQuery
    ? persons.filter(p => p.name.toLowerCase().includes(trimmedQuery.toLowerCase())).slice(0, MAX_RESULTS)
    : persons.slice(0, MAX_EMPTY_QUERY_RESULTS)
  const showNoResults = trimmedQuery.length > 0 && results.length === 0

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && results.length > 0) {
      onSelect(results[0].gedcomId)
    }
  }

  return (
    <div
      data-testid="search-overlay-scrim"
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--ft-overlay)] backdrop-blur-[2px] px-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        data-testid="search-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[560px] rounded-panel bg-surface border border-line shadow-[var(--ft-shadow-3)] overflow-hidden"
      >
        <div className="flex items-center gap-3 pl-4 pr-2 border-b border-line">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" className="flex-shrink-0 text-ink-3">
            <circle cx="8.5" cy="8.5" r="6" />
            <line x1="13.2" y1="13.2" x2="18" y2="18" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search by name…"
            aria-label="Search by name"
            data-testid="search-overlay-input"
            className="flex-1 h-[52px] bg-transparent text-ink [font:var(--ft-body)] placeholder-ink-3 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            data-testid="search-overlay-close"
            className="min-h-11 min-w-11 flex-shrink-0 flex items-center justify-center text-ink-3 hover:text-ink transition-colors"
          >
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
              <line x1="4" y1="4" x2="16" y2="16" strokeLinecap="round" />
              <line x1="16" y1="4" x2="4" y2="16" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {showNoResults ? (
          <p data-testid="search-overlay-no-results" className="px-4 py-8 text-center text-ink-3 [font:var(--ft-body)]">
            No one matches “{trimmedQuery}”.
          </p>
        ) : (
          <ul data-testid="search-overlay-results" className="max-h-[60vh] overflow-y-auto py-2 list-none">
            {results.map(p => {
              const match = findMatch(p.name, trimmedQuery)
              return (
                <li key={p.gedcomId}>
                  <button
                    type="button"
                    onClick={() => onSelect(p.gedcomId)}
                    data-testid="search-overlay-result"
                    className="w-full min-h-[48px] flex items-center gap-3 pl-3 pr-4 text-left hover:bg-surface-1 focus:outline-none focus:bg-surface-1 transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      className={`w-0.5 self-stretch my-1 rounded-[var(--ft-r-sm)] flex-shrink-0 ${SEX_AVATAR_BG[p.sex ?? 'default'] ?? SEX_AVATAR_BG.default}`}
                    />
                    <span className="min-w-0 flex-1 block font-serif font-medium text-ink truncate">
                      {match ? (
                        <>
                          {match.before}
                          <span className="bg-[var(--ft-brass-soft)]">{match.match}</span>
                          {match.after}
                        </>
                      ) : (
                        p.name
                      )}
                    </span>
                    {p.birthYear && (
                      <span className="flex-shrink-0 [font:var(--ft-mono)] text-ink-3">{p.birthYear}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
