/**
 * @module SearchBar
 * @description Client-side search widget that filters a person list by name and
 * notifies the parent when a result is selected. Falls back to fetching
 * `/api/persons` when no `persons` prop is supplied.
 */

'use client'
import { useState, useEffect } from 'react'

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

  return (
    <div className="absolute top-4 inset-x-4 z-10 bg-surface border border-line rounded-[var(--ft-r-md)] p-3 shadow-[var(--ft-shadow-1)] sm:inset-x-auto sm:left-4 sm:w-64">
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search by name, place or year…"
        data-testid="search-input"
        className="w-full min-h-11 bg-surface border border-line rounded-[var(--ft-r-md)] px-3 py-2 text-sm text-ink placeholder-ink-3 focus:outline-none focus:border-[var(--ft-accent)] focus:shadow-[var(--ft-focus)] transition-colors"
      />
      {results.length > 0 && (
        <ul data-testid="search-results" className="search-results mt-2 space-y-0.5 max-h-48 overflow-y-auto">
          {results.map(p => (
            <li
              key={p.gedcomId}
              data-testid="search-result-item"
              onClick={() => { onSelect(p.gedcomId); setQuery('') }}
              className="min-h-11 flex items-center gap-2 px-3 py-2 rounded-[var(--ft-r-sm)] text-sm text-ink-2 cursor-pointer hover:bg-surface-1 hover:text-ink transition-colors"
            >
              <span
                className={`sex-dot w-0.5 self-stretch rounded-[var(--ft-r-sm)] inline-block ${
                  p.sex === 'F' ? 'bg-pink-400' :
                  p.sex === 'M' ? 'bg-blue-400' :
                  'bg-[var(--ft-border-strong)]'
                }`}
              />
              <span className="font-serif font-medium">{p.name}</span>
              {p.birthYear && (
                <span className="font-mono text-ink-3 text-xs">{p.birthYear}</span>
              )}
              {p.birthPlace && (
                <span className="text-ink-3 text-xs">{p.birthPlace.slice(0, 20)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
