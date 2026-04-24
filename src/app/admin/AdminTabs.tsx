'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

const TABS = { SUGGESTIONS: 'suggestions', HISTORY: 'history' } as const
type Tab = typeof TABS[keyof typeof TABS]

const TAB_IDS: Record<Tab, string> = {
  suggestions: 'tab-suggestions',
  history: 'tab-history',
}
const PANEL_IDS: Record<Tab, string> = {
  suggestions: 'panel-suggestions',
  history: 'panel-history',
}

const TAB_ACTIVE = 'px-4 py-2 rounded-xl text-sm font-medium bg-white/10 backdrop-blur-md border border-white/20 text-white shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-colors'
const TAB_INACTIVE = 'px-4 py-2 rounded-xl text-sm font-medium bg-transparent border border-transparent text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors'

/**
 * Accessible tab container for the admin page.
 *
 * Renders ARIA-compliant tab buttons and a single tab panel whose content
 * is supplied via slots, keeping tab-state logic out of the server page.
 *
 * @param suggestionsSlot - Content rendered when the "Pending Suggestions" tab is active
 * @param historySlot - Content rendered when the "Change History" tab is active
 */
export function AdminTabs({
  suggestionsSlot,
  historySlot,
}: {
  suggestionsSlot: ReactNode
  historySlot: ReactNode
}) {
  const [activeTab, setActiveTab] = useState<Tab>(TABS.SUGGESTIONS)

  return (
    <>
      <div role="tablist" className="flex gap-2 mb-6">
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
      </div>
      <div
        role="tabpanel"
        id={PANEL_IDS[activeTab]}
        aria-labelledby={TAB_IDS[activeTab]}
      >
        {activeTab === TABS.SUGGESTIONS ? suggestionsSlot : historySlot}
      </div>
    </>
  )
}
