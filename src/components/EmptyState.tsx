/**
 * @module EmptyState
 * @description Cold-start landing view rendered at `/` when no person is focused
 * (no `?person=`/`?root=` in the URL and nothing in `localStorage`). Presents a
 * search entry point plus up to three "start here" shortcuts and footer counts.
 * Mounts no react-flow canvas — the caller (FamilyTree) swaps this in for the
 * viewer only until a focus person resolves.
 */

'use client'

import { STATUS_PILL_PENDING_CLASS } from '@/constants/tree'

/** Minimal person data needed to render a "start here" row. */
export interface EmptyStateStartPerson {
  /** GEDCOM identifier of the person this row points to. */
  gedcomId: string
  /** Full display name. */
  name: string
  /** Four-digit birth year, or `null`/absent if unknown. */
  birthYear?: string | null
  /** Four-digit death year, or `null`/absent if unknown or still living. */
  deathYear?: string | null
}

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  /** Total number of people in the tree, shown in the footer counts. Omit while still loading. */
  personCount?: number
  /** Number of suggested edits awaiting review. Renders a pending pill in the footer when greater than 0. */
  pendingCount?: number
  /** The tree's designated root person. Omit or pass `null` to hide the "Root person" row. */
  rootPerson?: EmptyStateStartPerson | null
  /** The earliest-born ancestor in the tree. Omit or pass `null` to hide the "Earliest ancestor" row. */
  earliestAncestor?: EmptyStateStartPerson | null
  /** The last person visited this session. Omit or pass `null` to hide the "Resume" row. */
  resumePerson?: EmptyStateStartPerson | null
  /** Fired with a person's id when a "start here" row is activated. */
  onSelectPerson: (gedcomId: string) => void
  /**
   * Fired when the search field is activated (click or keyboard). The field
   * itself performs no filtering — it hands off to the search overlay wired
   * up alongside it. Optional so the field still renders, inert but
   * focusable and labelled, before that wiring lands.
   */
  onSearchClick?: () => void
}

/** A single "start here" row after its person has been confirmed present. */
interface StartRow {
  testId: string
  label: string
  person: EmptyStateStartPerson
  /** Root person gets the brass-line emphasis border; other rows use the plain hairline. */
  emphasize?: boolean
}

/**
 * Cold-start landing view: title, subline, search field, up to three
 * "start here" shortcuts, and footer counts.
 *
 * @param {EmptyStateProps} props - Component props.
 * @returns {JSX.Element} The centred entry-state column.
 */
export default function EmptyState({
  personCount,
  pendingCount,
  rootPerson,
  earliestAncestor,
  resumePerson,
  onSelectPerson,
  onSearchClick,
}: EmptyStateProps) {
  const candidateRows: Array<{ testId: string; label: string; person: EmptyStateStartPerson | null | undefined; emphasize?: boolean }> = [
    { testId: 'root', label: 'Root person', person: rootPerson, emphasize: true },
    { testId: 'earliest', label: 'Earliest ancestor', person: earliestAncestor },
    { testId: 'resume', label: 'Resume where you left off', person: resumePerson },
  ]
  const rows: StartRow[] = candidateRows.filter((row): row is StartRow => Boolean(row.person))

  const hasCounts = typeof personCount === 'number'

  return (
    <div data-testid="empty-state" className="w-full h-full overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[580px] px-4 pt-16 sm:pt-24 pb-16">
        <h1 data-testid="empty-state-title" className="text-ink [font:var(--ft-display)]">
          Who are you looking for?
        </h1>
        <p data-testid="empty-state-subline" className="mt-2 text-ink-2 [font:var(--ft-body)]">
          Search for a name, or jump in with one of the starting points below.
        </p>

        <button
          type="button"
          onClick={onSearchClick}
          aria-label="Search"
          aria-haspopup="dialog"
          data-testid="empty-state-search"
          className="mt-6 w-full h-[52px] flex items-center gap-3 px-4 bg-surface border border-[var(--ft-accent)] rounded-[var(--ft-r-md)] text-left text-ink-3 hover:text-ink focus:outline-none focus:shadow-[var(--ft-focus)] transition-colors"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" className="flex-shrink-0">
            <circle cx="8.5" cy="8.5" r="6" />
            <line x1="13.2" y1="13.2" x2="18" y2="18" strokeLinecap="round" />
          </svg>
          <span className="flex-1 truncate [font:var(--ft-body)]">Search by name…</span>
          <kbd aria-hidden="true" className="[font:var(--ft-micro)] text-ink-3 flex-shrink-0">
            ⌘K
          </kbd>
        </button>

        {rows.length > 0 && (
          <div className="mt-10">
            <p
              data-testid="empty-state-eyebrow"
              className="[font:var(--ft-micro)] uppercase tracking-[var(--ft-micro-track)] text-ink-3"
            >
              Or start here
            </p>
            <ul data-testid="empty-state-start-rows" className="mt-3 space-y-2 list-none">
              {rows.map(row => (
                <li key={row.testId}>
                  <button
                    type="button"
                    onClick={() => onSelectPerson(row.person.gedcomId)}
                    data-testid={`empty-state-row-${row.testId}`}
                    className={`w-full min-h-11 flex items-center justify-between gap-3 px-4 py-2 rounded-[var(--ft-r-md)] bg-surface border text-left transition-colors focus:outline-none focus:shadow-[var(--ft-focus)] hover:bg-surface-1 ${
                      row.emphasize ? 'border-[var(--ft-brass-line)]' : 'border-line'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block [font:var(--ft-label)] text-ink-3">{row.label}</span>
                      <span className="block font-serif font-medium text-ink truncate">{row.person.name}</span>
                    </span>
                    {(row.person.birthYear || row.person.deathYear) && (
                      <span className="flex-shrink-0 [font:var(--ft-mono)] text-ink-3">
                        {row.person.birthYear ?? '?'}
                        {row.person.deathYear ? `–${row.person.deathYear}` : ''}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasCounts && (
          <div data-testid="empty-state-footer" className="mt-12 pt-4 border-t border-line flex items-center justify-between gap-3">
            <span data-testid="empty-state-person-count" className="[font:var(--ft-body)] text-ink-3">
              {personCount} {personCount === 1 ? 'person' : 'people'} in the tree
            </span>
            {Boolean(pendingCount) && (
              <span data-testid="empty-state-pending-pill" className={STATUS_PILL_PENDING_CLASS}>
                {pendingCount} pending
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
