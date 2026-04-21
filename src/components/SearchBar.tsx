'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { sexDotClass, formatLifespan } from '@/lib/person'

export interface Person {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  deathYear: string | null
  birthPlace: string | null
}
interface Props {
  persons: Person[]
  onSelect: (gedcomId: string) => void
}

export default function SearchBar({ persons, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const results = useMemo(() => {
    if (query.trim().length < 2) return []
    const q = query.trim().toLowerCase()
    return persons
      .filter(p => {
        if (!p.name) return false
        if (p.name.toLowerCase().includes(q)) return true
        if (p.birthPlace?.toLowerCase().includes(q)) return true
        if (p.birthYear?.includes(q) || p.deathYear?.includes(q)) return true
        return false
      })
      .slice(0, 12)
  }, [query, persons])

  const pick = (id: string) => {
    onSelect(id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div
      ref={containerRef}
      className="absolute top-4 left-4 z-20 w-80 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
    >
      <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-3">
        <div className="relative">
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder="Search by name, place or year…"
            className="w-full bg-white/[0.06] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-amber-400/50 focus:bg-white/[0.1] transition-all"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">⌕</span>
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-widest text-white/30 px-1 pt-1 flex justify-between">
          <span>{persons.length} people</span>
          {query && <span>{results.length} matches</span>}
        </div>
        {open && results.length > 0 && (
          <ul className="mt-2 space-y-0.5 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
            {results.map(p => {
              const dates = formatLifespan(p)
              return (
                <li
                  key={p.gedcomId}
                  onClick={() => pick(p.gedcomId)}
                  className="group px-2 py-2 rounded-lg cursor-pointer hover:bg-white/[0.08] transition-colors flex items-start gap-2"
                >
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${sexDotClass(p.sex)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-white truncate">
                      {p.name}
                    </div>
                    <div className="text-[11px] text-white/50 truncate tabular-nums">
                      {dates}
                      {dates && p.birthPlace ? ' · ' : ''}
                      {p.birthPlace}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
