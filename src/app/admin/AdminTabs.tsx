'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

const TABS = { SUGGESTIONS: 'suggestions', HISTORY: 'history', DUPLICATES: 'duplicates' } as const
type Tab = typeof TABS[keyof typeof TABS]

const TAB_IDS: Record<Tab, string> = {
  suggestions: 'tab-suggestions',
  history: 'tab-history',
  duplicates: 'tab-duplicates',
}
const PANEL_IDS: Record<Tab, string> = {
  suggestions: 'panel-suggestions',
  history: 'panel-history',
  duplicates: 'panel-duplicates',
}

const TAB_BASE = 'inline-flex items-center gap-2 px-3 py-1 [font:var(--ft-label)] border-b-2 transition-colors'
const TAB_ACTIVE = `${TAB_BASE} border-accent text-ink`
const TAB_INACTIVE = `${TAB_BASE} border-transparent text-ink-3 hover:text-ink-2`

const COUNT_BADGE_CLASS = 'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-[var(--ft-pending-soft)] text-[var(--ft-pending)] text-[11px] font-semibold leading-none'

/**
 * Accessible tab container for the admin page.
 *
 * Renders ARIA-compliant tab buttons and a single tab panel whose content
 * is supplied via slots, keeping tab-state logic out of the server page.
 *
 * @param suggestionsSlot - Content rendered when the "Pending Suggestions" tab is active
 * @param historySlot - Content rendered when the "Change History" tab is active
 * @param duplicatesSlot - Content rendered when the "Duplicates" tab is active
 * @param suggestionsCount - Number shown in the count badge next to "Pending Suggestions"
 */
export function AdminTabs({
  suggestionsSlot,
  historySlot,
  duplicatesSlot,
  suggestionsCount = 0,
}: {
  suggestionsSlot: ReactNode
  historySlot: ReactNode
  duplicatesSlot: ReactNode
  suggestionsCount?: number
}) {
  const [activeTab, setActiveTab] = useState<Tab>(TABS.SUGGESTIONS)

  return (
    <>
      <div role="tablist" className="flex gap-2 mb-6 border-b border-line">
        <button
          type="button"
          role="tab"
          id={TAB_IDS[TABS.SUGGESTIONS]}
          aria-selected={activeTab === TABS.SUGGESTIONS}
          aria-controls={PANEL_IDS[TABS.SUGGESTIONS]}
          onClick={() => setActiveTab(TABS.SUGGESTIONS)}
          className={activeTab === TABS.SUGGESTIONS ? TAB_ACTIVE : TAB_INACTIVE}
        >
          Pending Suggestions
          <span className={COUNT_BADGE_CLASS} data-testid="suggestions-count-badge">
            {suggestionsCount}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          id={TAB_IDS[TABS.HISTORY]}
          aria-selected={activeTab === TABS.HISTORY}
          aria-controls={PANEL_IDS[TABS.HISTORY]}
          onClick={() => setActiveTab(TABS.HISTORY)}
          className={activeTab === TABS.HISTORY ? TAB_ACTIVE : TAB_INACTIVE}
        >
          Change History
        </button>
        <button
          type="button"
          role="tab"
          id={TAB_IDS[TABS.DUPLICATES]}
          aria-selected={activeTab === TABS.DUPLICATES}
          aria-controls={PANEL_IDS[TABS.DUPLICATES]}
          onClick={() => setActiveTab(TABS.DUPLICATES)}
          className={activeTab === TABS.DUPLICATES ? TAB_ACTIVE : TAB_INACTIVE}
        >
          Duplicates
        </button>
      </div>
      <div
        role="tabpanel"
        id={PANEL_IDS[TABS.SUGGESTIONS]}
        aria-labelledby={TAB_IDS[TABS.SUGGESTIONS]}
        hidden={activeTab !== TABS.SUGGESTIONS}
      >
        {suggestionsSlot}
      </div>
      <div
        role="tabpanel"
        id={PANEL_IDS[TABS.HISTORY]}
        aria-labelledby={TAB_IDS[TABS.HISTORY]}
        hidden={activeTab !== TABS.HISTORY}
      >
        {historySlot}
      </div>
      <div
        role="tabpanel"
        id={PANEL_IDS[TABS.DUPLICATES]}
        aria-labelledby={TAB_IDS[TABS.DUPLICATES]}
        hidden={activeTab !== TABS.DUPLICATES}
      >
        {duplicatesSlot}
      </div>
    </>
  )
}
