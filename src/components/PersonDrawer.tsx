'use client'

import { useEffect, useState } from 'react'
import type { PersonDetail, Relative } from '@/types/tree'
import { sexDotClass, formatLifespan } from '@/lib/person'

interface Props {
  personId: string | null
  onClose: () => void
  onFocus: (gedcomId: string) => void
  onSelect: (gedcomId: string) => void
}

function RelativeRow({
  r,
  onClick,
  onFocus,
}: {
  r: Relative
  onClick: (id: string) => void
  onFocus: (id: string) => void
}) {
  const dates = formatLifespan(r)
  return (
    <li className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.06] cursor-pointer"
        onClick={() => onClick(r.gedcomId)}>
      <span className={`h-1.5 w-1.5 rounded-full ${sexDotClass(r.sex)}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-white truncate">{r.name || '(unknown)'}</div>
        {dates && <div className="text-[11px] text-white/50 tabular-nums">{dates}</div>}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onFocus(r.gedcomId)
        }}
        className="opacity-0 group-hover:opacity-100 text-[10px] uppercase tracking-widest text-amber-300/80 hover:text-amber-200 px-2 py-1 rounded"
        title="Focus tree on this person"
      >
        focus
      </button>
    </li>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-1.5 px-1">
        <h4 className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-semibold">
          {title}
        </h4>
        <span className="text-[10px] text-white/30 tabular-nums">{count}</span>
      </div>
      {children}
    </div>
  )
}

export default function PersonDrawer({
  personId,
  onClose,
  onFocus,
  onSelect,
}: Props) {
  const [data, setData] = useState<PersonDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!personId) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/person/${encodeURIComponent(personId)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: PersonDetail) => {
        if (!cancelled) setData(d)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [personId])

  const open = Boolean(personId)
  const p = data?.person

  return (
    <aside
      className={`pointer-events-none fixed top-0 right-0 h-screen w-[380px] z-30 transition-transform duration-300 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full'}`}
      aria-hidden={!open}
    >
      <div className="pointer-events-auto h-full bg-slate-950/92 backdrop-blur-xl border-l border-white/10 shadow-[-20px_0_60px_rgba(0,0,0,0.6)] flex flex-col">
        <header className="flex items-start justify-between gap-2 px-5 pt-5 pb-3 border-b border-white/5">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Person</div>
            <h2 className="text-lg font-semibold text-white truncate">
              {p?.name || '—'}
            </h2>
            {p && (
              <div className="mt-1 text-[11px] text-white/50 tabular-nums">
                {p.birthYear && `b. ${p.birthYear}`}
                {p.birthYear && p.deathYear && ' · '}
                {p.deathYear && `d. ${p.deathYear}`}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white text-xl leading-none px-2 py-1 rounded hover:bg-white/5"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
          {loading && <div className="text-sm text-white/50">Loading…</div>}
          {error && <div className="text-sm text-rose-300/80">{error}</div>}
          {!loading && !error && data && p && (
            <>
              <button
                onClick={() => onFocus(p.gedcomId)}
                className="w-full mb-4 text-center px-3 py-2 rounded-lg bg-amber-400/10 border border-amber-300/30 text-amber-200 text-[12px] uppercase tracking-[0.18em] hover:bg-amber-400/20 transition-colors"
              >
                ★ Focus tree on {p.givenName || p.name}
              </button>

              <div className="space-y-2 text-[12px] text-white/70 mb-4">
                {p.birthDate && (
                  <Field label="Born">
                    {p.birthDate}
                    {p.birthPlace ? `, ${p.birthPlace}` : ''}
                  </Field>
                )}
                {!p.birthDate && p.birthPlace && (
                  <Field label="Born">{p.birthPlace}</Field>
                )}
                {p.deathDate && (
                  <Field label="Died">
                    {p.deathDate}
                    {p.deathPlace ? `, ${p.deathPlace}` : ''}
                  </Field>
                )}
                {!p.deathDate && p.deathPlace && (
                  <Field label="Died">{p.deathPlace}</Field>
                )}
                {p.occupation && <Field label="Occupation">{p.occupation}</Field>}
                {p.sex && (
                  <Field label="Sex">
                    {p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : p.sex}
                  </Field>
                )}
                <Field label="GEDCOM ID">
                  <code className="text-white/50">{p.gedcomId}</code>
                </Field>
              </div>

              {([
                ['Parents', data.parents],
                ['Siblings', data.siblings],
              ] as const).map(([title, list]) => (
                <Section key={title} title={title} count={list.length}>
                  <ul className="space-y-0.5">
                    {list.map(r => (
                      <RelativeRow key={r.gedcomId} r={r} onClick={onSelect} onFocus={onFocus} />
                    ))}
                  </ul>
                </Section>
              ))}

              {data.marriages.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-semibold mb-1.5 px-1">
                    Marriages
                  </h4>
                  <div className="space-y-3">
                    {data.marriages.map(m => (
                      <div
                        key={m.gedcomId}
                        className="rounded-xl border border-white/5 bg-white/[0.03] p-3"
                      >
                        {m.spouse && (
                          <RelativeRow
                            r={m.spouse}
                            onClick={onSelect}
                            onFocus={onFocus}
                          />
                        )}
                        {(m.marriageDate || m.marriagePlace) && (
                          <div className="mt-1 ml-5 text-[11px] text-amber-200/70">
                            ♥ {m.marriageDate || ''}
                            {m.marriageDate && m.marriagePlace ? ' · ' : ''}
                            {m.marriagePlace || ''}
                          </div>
                        )}
                        {m.children.length > 0 && (
                          <div className="mt-2 ml-5">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-white/30 mb-1">
                              Children · {m.children.length}
                            </div>
                            <ul className="space-y-0.5">
                              {m.children.map(c => (
                                <RelativeRow
                                  key={c.gedcomId}
                                  r={c}
                                  onClick={onSelect}
                                  onFocus={onFocus}
                                />
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {p.notes && (
                <div className="mb-4">
                  <h4 className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-semibold mb-1.5 px-1">
                    Notes
                  </h4>
                  <p className="text-[12px] text-white/65 whitespace-pre-wrap leading-relaxed bg-white/[0.03] border border-white/5 rounded-xl p-3">
                    {p.notes}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-20 flex-none text-[10px] uppercase tracking-[0.18em] text-white/35 pt-[2px]">
        {label}
      </div>
      <div className="flex-1 text-white/80">{children}</div>
    </div>
  )
}
