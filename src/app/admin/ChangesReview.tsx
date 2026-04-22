'use client'

import { useState } from 'react'

interface Change {
  id: string
  changeType: 'edit_person' | 'add_person' | 'add_relationship'
  targetId: string
  personName: string
  authorName: string
  authorEmail: string
  previousValue: Record<string, unknown> | null
  newValue: Record<string, unknown>
  appliedAt: string
  status: string
}

const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  sex: 'sex',
  birthYear: 'birth year',
  birthDate: 'birth date',
  birthPlace: 'birth place',
  deathYear: 'death year',
  deathDate: 'death date',
  deathPlace: 'death place',
  occupation: 'occupation',
  notes: 'notes',
}

function describeChange(change: Change): string {
  if (change.changeType === 'add_person') {
    return `Added new person: ${change.personName}`
  }
  if (change.changeType === 'add_relationship') {
    const type = change.newValue?.relationshipType as string | undefined
    return `Added ${type ?? 'relationship'} relationship`
  }
  const prev = change.previousValue
  const next = change.newValue
  if (!prev) return 'Updated person record'
  const parts: string[] = []
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    if (key in next && String(prev[key] ?? '') !== String(next[key] ?? '')) {
      parts.push(`Updated ${label}: ${prev[key] ?? '(none)'} → ${next[key] ?? '(none)'}`)
    }
  }
  return parts.length > 0 ? parts.join('; ') : 'Updated person record'
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const s = Math.floor(diff / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d} day${d > 1 ? 's' : ''} ago`
  if (h > 0) return `${h} hour${h > 1 ? 's' : ''} ago`
  if (m > 0) return `${m} minute${m > 1 ? 's' : ''} ago`
  return 'just now'
}

export function ChangesReview({ initialChanges }: { initialChanges: Change[] }) {
  const [changes, setChanges] = useState(initialChanges)
  const [pending, setPending] = useState<Record<string, 'keep' | 'revert' | undefined>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function handleAction(id: string, action: 'keep' | 'revert') {
    setPending(p => ({ ...p, [id]: action }))
    setErrors(e => { const next = { ...e }; delete next[id]; return next })
    try {
      const res = await fetch(`/api/admin/changes/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setChanges(cs => cs.filter(c => c.id !== id))
    } catch {
      setErrors(e => ({ ...e, [id]: `Failed to ${action} change. Please try again.` }))
    } finally {
      setPending(p => { const next = { ...p }; delete next[id]; return next })
    }
  }

  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-white/60 text-sm">No pending changes to review.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {changes.map(change => {
        const isPending = !!pending[change.id]
        const isKeeping = pending[change.id] === 'keep'
        const isReverting = pending[change.id] === 'revert'
        return (
          <div
            key={change.id}
            className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-white font-semibold text-base">{change.personName || change.targetId}</p>
                <p className="text-white/50 text-xs mt-0.5">{relativeTime(change.appliedAt)}</p>
              </div>
              <span className="shrink-0 text-xs px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {change.changeType.replace(/_/g, ' ')}
              </span>
            </div>

            <p className="text-white/80 text-sm mb-3 leading-relaxed">{describeChange(change)}</p>

            <p className="text-slate-400 text-xs mb-4">
              Contributor: <span className="text-white/70">{change.authorName || change.authorEmail}</span>
            </p>

            {errors[change.id] && (
              <p className="text-red-400 text-xs mb-3">{errors[change.id]}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => handleAction(change.id, 'keep')}
                disabled={isPending}
                className="flex-1 py-2 rounded-xl bg-indigo-500/80 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                {isKeeping ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Keeping…
                  </span>
                ) : 'Keep'}
              </button>
              <button
                onClick={() => handleAction(change.id, 'revert')}
                disabled={isPending}
                className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium border border-white/20 transition-colors"
              >
                {isReverting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Reverting…
                  </span>
                ) : 'Revert'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
