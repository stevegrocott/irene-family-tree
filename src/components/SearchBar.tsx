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
    <div className="absolute top-4 left-4 z-10 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-3 w-64 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search by name, place or year…"
        data-testid="search-input"
        className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-indigo-400/60 focus:bg-white/15 transition-all"
      />
      {results.length > 0 && (
        <ul data-testid="search-results" className="search-results mt-2 space-y-0.5 max-h-48 overflow-y-auto">
          {results.map(p => (
            <li
              key={p.gedcomId}
              onClick={() => { onSelect(p.gedcomId); setQuery('') }}
              className="px-3 py-2 rounded-lg text-sm text-white/80 cursor-pointer hover:bg-white/15 hover:text-white transition-colors"
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
