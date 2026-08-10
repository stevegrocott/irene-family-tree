/**
 * @module SearchBar
 * @description Client-side search widget that filters a person list by name and
 * notifies the parent when a result is selected. Falls back to fetching
 * `/api/persons` when no `persons` prop is supplied.
 */

'use client'
import { useState, useEffect } from 'react'
import { findMatch } from './SearchOverlay'

/** Minimal person record used for search filtering. */
interface Person { gedcomId: string; name: string; sex: string | null; birthYear: string | null; birthPlace: string | null }

/**
 * Props for the {@link SearchBar} component.
 *
 * @property {(gedcomId: string) => void} onSelect - Called with the selected person's GEDCOM ID.
 * @property {Person[]} [persons] - Optional pre-fetched person list; omit to fetch from `/api/persons`.
 */
interface Props { onSelect: (gedcomId: string) => void; persons?: Person[] }

/**
 * Floating search bar that filters persons by name and triggers selection.
 *
 * @param {Props} props - Component props.
 * @param {(gedcomId: string) => void} props.onSelect - Callback fired when a result is clicked.
 * @param {Person[]} [props.persons] - Optional person list; fetched from API when omitted.
 * @returns {JSX.Element} Positioned search input with a dropdown results list.
 */
export default function SearchBar({ onSelect, persons: personsProp }: Props) {
  const [fetchedPersons, setFetchedPersons] = useState<Person[]>([])
  const [query, setQuery]                   = useState('')
  // Below the `sm` (640px) breakpoint the panel starts collapsed behind a
  // 44px icon button (AC2); at `sm` and up the panel is always shown via the
  // `sm:block` override below, regardless of this flag.
  const [mobileOpen, setMobileOpen]          = useState(false)
  // -1 means no row is keyboard-active; set by ArrowDown/ArrowUp (§4.3).
  const [activeIndex, setActiveIndex]        = useState(-1)

  useEffect(() => {
    if (personsProp) return
    fetch('/api/persons')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setFetchedPersons)
      .catch(err => { console.error('Failed to load persons for search', err) })
  }, [personsProp])

  const persons = personsProp ?? fetchedPersons

  const lowerQuery = query.toLowerCase()
  const results = query.length > 1
    ? persons.filter(p =>
        p.name.toLowerCase().includes(lowerQuery) ||
        (p.birthPlace?.toLowerCase() ?? '').includes(lowerQuery) ||
        (p.birthYear?.toLowerCase() ?? '').includes(lowerQuery)
      ).slice(0, 8)
    : []

  /** Closes the mobile sheet and hands the selection off to the caller. */
  const handleSelect = (gedcomId: string) => {
    onSelect(gedcomId)
    setQuery('')
    setMobileOpen(false)
    setActiveIndex(-1)
  }

  /** ArrowUp/ArrowDown move the keyboard-active row; Enter selects it (§4.3, §7). */
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      handleSelect(results[activeIndex].gedcomId)
    }
  }

  return (
    <>
      {!mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Search"
          data-testid="search-toggle"
          className="sm:hidden absolute top-4 left-4 z-10 min-h-11 min-w-11 flex items-center justify-center bg-surface border border-line rounded-[var(--ft-r-md)] shadow-[var(--ft-shadow-1)] text-ink focus:outline-none focus:border-[var(--ft-accent)] focus:shadow-[var(--ft-focus)] transition-colors"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="6" />
            <line x1="13.2" y1="13.2" x2="18" y2="18" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <div
        data-testid="search-panel"
        className={`${mobileOpen ? '' : 'hidden'} sm:block absolute top-4 inset-x-4 z-10 bg-surface border border-line rounded-[var(--ft-r-md)] p-3 shadow-[var(--ft-shadow-1)] sm:inset-x-auto sm:left-4 sm:w-64`}
      >
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(-1) }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search by name, place or year…"
            data-testid="search-input"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="search-results-listbox"
            aria-activedescendant={activeIndex >= 0 ? `search-result-${results[activeIndex].gedcomId}` : undefined}
            className="w-full min-h-11 bg-surface border border-line rounded-[var(--ft-r-md)] px-3 py-2 text-sm text-ink placeholder-ink-3 focus:outline-none focus:border-[var(--ft-accent)] focus:shadow-[var(--ft-focus)] transition-colors"
          />
          <button
            type="button"
            onClick={() => { setMobileOpen(false); setQuery('') }}
            aria-label="Close search"
            data-testid="search-close"
            className="sm:hidden min-h-11 min-w-11 flex-shrink-0 flex items-center justify-center text-ink-2 hover:text-ink transition-colors"
          >
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
              <line x1="4" y1="4" x2="16" y2="16" strokeLinecap="round" />
              <line x1="16" y1="4" x2="4" y2="16" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {results.length > 0 && (
          <ul
            id="search-results-listbox"
            role="listbox"
            data-testid="search-results"
            className="search-results mt-2 space-y-0.5 max-h-48 overflow-y-auto"
          >
            {results.map((p, i) => {
              const isActive = i === activeIndex
              const match = findMatch(p.name, query)
              return (
                <li
                  key={p.gedcomId}
                  id={`search-result-${p.gedcomId}`}
                  role="option"
                  aria-selected={isActive}
                  data-testid="search-result-item"
                  onClick={() => handleSelect(p.gedcomId)}
                  className={`min-h-11 flex items-center gap-2 px-3 py-2 rounded-[var(--ft-r-sm)] text-sm text-ink-2 cursor-pointer hover:bg-surface-1 hover:text-ink transition-colors ${
                    isActive ? 'bg-[var(--ft-accent-soft)]' : ''
                  }`}
                >
                  <span
                    className={`sex-dot w-0.5 self-stretch rounded-[var(--ft-r-sm)] inline-block ${
                      isActive ? 'bg-[var(--ft-accent)]' :
                      p.sex === 'F' ? 'bg-pink-400' :
                      p.sex === 'M' ? 'bg-blue-400' :
                      'bg-[var(--ft-border-strong)]'
                    }`}
                  />
                  <span className="font-serif font-medium">
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
                    <span className="font-mono text-ink-3 text-xs">{p.birthYear}</span>
                  )}
                  {p.birthPlace && (
                    <span className="text-ink-3 text-xs">{p.birthPlace.slice(0, 20)}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
