'use client'

import { useState } from 'react'
import type { Change } from './types'
import {
  ADMIN_CARD_CLASS,
  ADMIN_CARD_META_CLASS,
  ADMIN_CARD_TITLE_CLASS,
  ADMIN_EMPTY_ICON_CLASS,
  ADMIN_EMPTY_ICON_WRAP_CLASS,
  ADMIN_EMPTY_STATE_CLASS,
  ADMIN_ERROR_TEXT_CLASS,
  ADMIN_SECONDARY_BUTTON_CLASS,
  ADMIN_STATUS_PILL_CLASS,
  BUTTON_SPINNER_WRAP_CLASS,
  SPINNER_CLASS,
} from '@/constants/tree'

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  sex: 'Sex',
  birthYear: 'Birth year',
  birthDate: 'Birth date',
  birthPlace: 'Birth place',
  deathYear: 'Death year',
  deathDate: 'Death date',
  deathPlace: 'Death place',
  occupation: 'Occupation',
  notes: 'Notes',
}

function FieldDiff({
  field,
  prev,
  next,
}: {
  field: string
  prev: unknown
  next: unknown
}) {
  const label = FIELD_LABELS[field] ?? field
  const prevStr = prev != null && prev !== '' ? String(prev) : '(none)'
  const nextStr = next != null && next !== '' ? String(next) : '(none)'
  const hasPrev = prev != null && prev !== ''
  const hasNext = next != null && next !== ''
  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <div>
        <span className="text-ink-3 uppercase tracking-wide text-[10px] font-semibold">
          {label} before
        </span>
        <p
          className={`font-mono mt-0.5 break-words rounded-[var(--ft-r-sm)] px-1.5 py-0.5 bg-[var(--ft-declined-soft)] text-ink-3 line-through ${hasPrev ? '' : 'italic no-underline'}`}
        >
          {prevStr}
        </p>
      </div>
      <div>
        <span className="text-ink-3 uppercase tracking-wide text-[10px] font-semibold">
          {label} after
        </span>
        <p
          className={`font-mono mt-0.5 break-words rounded-[var(--ft-r-sm)] px-1.5 py-0.5 bg-[var(--ft-approved-soft)] text-ink ${hasNext ? '' : 'italic'}`}
        >
          {nextStr}
        </p>
      </div>
    </div>
  )
}

export function SuggestionsReview({ initialSuggestions }: { initialSuggestions: Change[] }) {
  const [suggestions, setSuggestions] = useState(initialSuggestions)
  const [pending, setPending] = useState<Record<string, 'approve' | 'decline' | undefined>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function handleAction(id: string, action: 'approve' | 'decline') {
    setPending(p => ({ ...p, [id]: action }))
    setErrors(e => { const next = { ...e }; delete next[id]; return next })
    try {
      const res = await fetch(`/api/admin/suggestions/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSuggestions(ss => ss.filter(s => s.id !== id))
    } catch {
      setErrors(e => ({ ...e, [id]: `Failed to ${action} suggestion. Please try again.` }))
    } finally {
      setPending(p => { const next = { ...p }; delete next[id]; return next })
    }
  }

  if (suggestions.length === 0) {
    return (
      <div data-testid="suggestions-review" className={ADMIN_EMPTY_STATE_CLASS}>
        <div className={ADMIN_EMPTY_ICON_WRAP_CLASS}>
          <svg className={ADMIN_EMPTY_ICON_CLASS} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-ink-2 text-sm">No pending suggestions to review.</p>
      </div>
    )
  }

  return (
    <div data-testid="suggestions-review" className="space-y-4">
      {suggestions.map(s => {
        const isPending = !!pending[s.id]
        const isApproving = pending[s.id] === 'approve'
        const isDeclining = pending[s.id] === 'decline'

        const changedFields: string[] = []
        if (s.newValue) {
          for (const key of Object.keys(s.newValue)) {
            const prev = s.previousValue?.[key]
            const next = s.newValue[key]
            if (String(prev ?? '') !== String(next ?? '')) {
              changedFields.push(key)
            }
          }
        }

        return (
          <div
            key={s.id}
            className={ADMIN_CARD_CLASS}
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className={ADMIN_CARD_TITLE_CLASS}>{s.personName || s.targetId}</p>
                <p className={ADMIN_CARD_META_CLASS}>
                  Proposed by{' '}
                  <span className="text-ink-2">{s.authorName || s.authorEmail}</span>
                </p>
              </div>
              <span className={`shrink-0 ${ADMIN_STATUS_PILL_CLASS}`}>
                {s.changeType.replace(/_/g, ' ')}
              </span>
            </div>

            {changedFields.length > 0 && (
              <div className="space-y-3 mb-4 border-t border-line pt-3">
                {changedFields.map(field => (
                  <FieldDiff
                    key={field}
                    field={field}
                    prev={s.previousValue?.[field]}
                    next={s.newValue[field]}
                  />
                ))}
              </div>
            )}

            {errors[s.id] && (
              <p className={`${ADMIN_ERROR_TEXT_CLASS} mb-3`}>{errors[s.id]}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => handleAction(s.id, 'approve')}
                disabled={isPending}
                className="flex-1 py-2 rounded-[var(--ft-r-md)] bg-accent hover:bg-[var(--ft-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--ft-text-on-accent)] text-sm font-medium transition-colors"
              >
                {isApproving ? (
                  <span className={BUTTON_SPINNER_WRAP_CLASS}>
                    <span className="w-4 h-4 border-2 border-current/40 border-t-current rounded-full animate-spin" />
                    Approving…
                  </span>
                ) : 'Approve'}
              </button>
              <button
                onClick={() => handleAction(s.id, 'decline')}
                disabled={isPending}
                className={`flex-1 ${ADMIN_SECONDARY_BUTTON_CLASS}`}
              >
                {isDeclining ? (
                  <span className={BUTTON_SPINNER_WRAP_CLASS}>
                    <span className={SPINNER_CLASS} />
                    Declining…
                  </span>
                ) : 'Decline'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
