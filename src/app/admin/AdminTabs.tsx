'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

type Tab = 'suggestions' | 'history'

export function AdminTabs({
  suggestionsSlot,
  historySlot,
}: {
  suggestionsSlot: ReactNode
  historySlot: ReactNode
}) {
  const [activeTab, setActiveTab] = useState<Tab>('suggestions')

  return (
    <div>
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('suggestions')}
          className={
            activeTab === 'suggestions'
              ? 'px-4 py-2 rounded-xl text-sm font-medium bg-white/10 backdrop-blur-md border border-white/20 text-white shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-colors'
              : 'px-4 py-2 rounded-xl text-sm font-medium bg-transparent border border-transparent text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors'
          }
        >
          Pending Suggestions
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={
            activeTab === 'history'
              ? 'px-4 py-2 rounded-xl text-sm font-medium bg-white/10 backdrop-blur-md border border-white/20 text-white shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-colors'
              : 'px-4 py-2 rounded-xl text-sm font-medium bg-transparent border border-transparent text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors'
          }
        >
          Change History
        </button>
      </div>
      {activeTab === 'suggestions' ? suggestionsSlot : historySlot}
    </div>
  )
}
