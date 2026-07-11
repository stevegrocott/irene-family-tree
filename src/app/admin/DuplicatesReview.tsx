'use client'

import { useEffect, useState } from 'react'

/** Scalar Person fields for one side of a duplicate candidate pair. */
interface DuplicatePersonSide {
  gedcomId: string
  name: string
  sex: string | null
  birthYear: string | null
  deathYear: string | null
  birthPlace: string | null
  deathPlace: string | null
  occupation: string | null
  notes: string | null
}

/** A candidate pair of Person records that may be duplicates of each other. */
interface DuplicateCandidate {
  person1: DuplicatePersonSide
  person2: DuplicatePersonSide
}

const FIELD_LABELS: Record<string, string> = {
  sex: 'Sex',
  birthYear: 'Birth year',
  deathYear: 'Death year',
  birthPlace: 'Birth place',
  deathPlace: 'Death place',
  occupation: 'Occupation',
  notes: 'Notes',
}

const DISPLAY_FIELDS = ['sex', 'birthYear', 'deathYear', 'birthPlace', 'deathPlace', 'occupation', 'notes'] as const

function pairKey(candidate: DuplicateCandidate): string {
  return `${candidate.person1.gedcomId}::${candidate.person2.gedcomId}`
}

function PersonCard({
  person,
  side,
  selected,
  onSelect,
  pairKeyValue,
}: {
  person: DuplicatePersonSide
  side: 'primary' | 'duplicate'
  selected: boolean
  onSelect: () => void
  pairKeyValue: string
}) {
  return (
    <div className="flex-1 min-w-0">
      <label className="flex items-center gap-2 mb-2 cursor-pointer">
        <input
          type="radio"
          name={`survivor-${pairKeyValue}`}
          data-testid={`survivor-radio-${side}`}
          checked={selected}
          onChange={onSelect}
          className="accent-indigo-500"
        />
        <span className="text-white font-semibold text-base break-words">{person.name}</span>
      </label>
      <div className="space-y-1.5 text-xs">
        {DISPLAY_FIELDS.map(field => {
          const value = person[field]
          if (value == null || value === '') return null
          return (
            <div key={field}>
              <span className="text-white/40 uppercase tracking-wide text-[10px] font-medium">
                {FIELD_LABELS[field]}
              </span>
              <p className="text-white/70 mt-0.5 break-words">{value}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Displays candidate duplicate Person pairs for admin review.
 *
 * Fetches candidate pairs from `/api/admin/duplicates` on mount (same
 * client-fetch pattern as {@link ChangeHistory}) and renders each pair side
 * by side with per-field comparison. The admin selects which side of a pair
 * should survive via a radio group, then confirms the merge, which POSTs
 * `{ survivorId, duplicateId }` to `/api/admin/duplicates/merge`. On a
 * successful merge the pair is removed from the list.
 *
 * @component
 * @returns {JSX.Element} A container with candidate pair cards, loading state, or empty state
 */
export function DuplicatesReview() {
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, 'primary' | 'duplicate'>>({})
  const [merging, setMerging] = useState<Record<string, boolean>>({})
  const [mergeErrors, setMergeErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const res = await fetch('/api/admin/duplicates', { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setCandidates(data.duplicates ?? data.candidates ?? [])
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setFetchError('Failed to load duplicate candidates. Please refresh to try again.')
      } finally {
        setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  async function handleConfirmMerge(candidate: DuplicateCandidate) {
    const key = pairKey(candidate)
    const side = selected[key] ?? 'primary'
    const survivor = side === 'duplicate' ? candidate.person2 : candidate.person1
    const duplicate = side === 'duplicate' ? candidate.person1 : candidate.person2

    setMerging(m => ({ ...m, [key]: true }))
    setMergeErrors(e => { const next = { ...e }; delete next[key]; return next })
    try {
      const res = await fetch('/api/admin/duplicates/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ survivorId: survivor.gedcomId, duplicateId: duplicate.gedcomId }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setCandidates(cs => cs.filter(c => pairKey(c) !== key))
    } catch {
      setMergeErrors(e => ({ ...e, [key]: 'Failed to merge duplicate. Please try again.' }))
    } finally {
      setMerging(m => { const next = { ...m }; delete next[key]; return next })
    }
  }

  if (loading) {
    return (
      <div data-testid="duplicates-review" className="flex items-center justify-center py-20">
        <span className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div data-testid="duplicates-review" className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-red-400 text-sm">{fetchError}</p>
      </div>
    )
  }

  return (
    <div data-testid="duplicates-review" className="space-y-4">
      {candidates.length === 0 ? (
        <div data-testid="empty-state" className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-white/60 text-sm">No duplicate candidates found.</p>
        </div>
      ) : (
        candidates.map(candidate => {
          const key = pairKey(candidate)
          const side = selected[key] ?? 'primary'
          const isMerging = !!merging[key]

          return (
            <div
              key={key}
              className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
            >
              <div className="flex gap-4 border-t border-white/10 pt-3">
                <PersonCard
                  person={candidate.person1}
                  side="primary"
                  selected={side === 'primary'}
                  onSelect={() => setSelected(s => ({ ...s, [key]: 'primary' }))}
                  pairKeyValue={key}
                />
                <PersonCard
                  person={candidate.person2}
                  side="duplicate"
                  selected={side === 'duplicate'}
                  onSelect={() => setSelected(s => ({ ...s, [key]: 'duplicate' }))}
                  pairKeyValue={key}
                />
              </div>

              {mergeErrors[key] && (
                <p role="alert" aria-live="assertive" className="text-red-400 text-xs mt-3">{mergeErrors[key]}</p>
              )}

              <button
                type="button"
                onClick={() => handleConfirmMerge(candidate)}
                disabled={isMerging}
                className="w-full mt-4 py-2 rounded-xl bg-indigo-500/80 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                {isMerging ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Merging…
                  </span>
                ) : 'Confirm Merge'}
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}
