'use client'
import { useState, useEffect } from 'react'

interface Person { gedcomId: string; name: string }
interface Props { onSelect: (gedcomId: string) => void; persons?: Person[] }

export default function SearchBar({ onSelect, persons: personsProp }: Props) {
  const [fetchedPersons, setFetchedPersons] = useState<Person[]>([])
  const [query, setQuery]                   = useState('')

  useEffect(() => {
    if (personsProp) return
    fetch('/api/persons').then(r => r.json()).then(setFetchedPersons)
  }, [personsProp])

  const persons = personsProp ?? fetchedPersons

  const results = query.length > 1
    ? persons.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : []

  return (
    <div className="absolute top-4 left-4 z-10 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-3 w-64 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search family…"
        className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-indigo-400/60 focus:bg-white/15 transition-all"
      />
      {results.length > 0 && (
        <ul className="search-results mt-2 space-y-0.5 max-h-48 overflow-y-auto">
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
