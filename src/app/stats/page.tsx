/**
 * @fileoverview `/stats` page — a public, read-only overview of aggregate family
 * statistics (totals, trends, and superlatives) fetched from `GET /api/stats`.
 * Styled to match the dark glassmorphism theme used by the floating `Toolbar`
 * on the tree viewer (`bg-white/10 backdrop-blur-md border border-white/20`).
 */

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { StatsResponse } from '@/types/stats'

/** A single labelled value for a {@link BarChart} row. */
interface BarItem {
  label: string
  value: number
}

/**
 * Glassmorphism stat card matching the floating Toolbar's styling.
 *
 * @param {Object} props - Component props
 * @param {string} props.label - Small uppercase label describing the stat
 * @param {React.ReactNode} props.value - Headline value to display
 * @param {string} [props.hint] - Optional secondary detail shown below the value
 * @param {string} [props.testId] - Optional `data-testid` for the card
 * @returns {React.ReactElement} Rendered stat card
 */
function StatCard({
  label,
  value,
  hint,
  testId,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-5 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
    >
      <p className="text-xs text-white/50 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-2xl text-white font-semibold mt-1 truncate">{value}</p>
      {hint && <p className="text-xs text-white/40 mt-1 truncate">{hint}</p>}
    </div>
  )
}

/**
 * A pure-CSS horizontal bar chart: each row is a label plus a percentage-width
 * `div` sized relative to the largest value in the set. No chart library needed.
 *
 * @param {Object} props - Component props
 * @param {BarItem[]} props.items - Rows to render, in display order
 * @param {string} props.testId - `data-testid` for the chart container; each bar
 *   row gets `${testId}-bar` so tests/E2E can count rendered bars
 * @returns {React.ReactElement} Rendered bar chart, or a "no data" placeholder when empty
 */
function BarChart({ items, testId }: { items: BarItem[]; testId: string }) {
  if (items.length === 0) {
    return (
      <div data-testid={testId}>
        <p className="text-white/40 text-sm">No data available</p>
      </div>
    )
  }

  const max = Math.max(...items.map(item => item.value))

  return (
    <div data-testid={testId} className="space-y-2">
      {items.map(item => (
        <div key={item.label} data-testid={`${testId}-bar`} className="flex items-center gap-3">
          <span className="w-32 shrink-0 text-xs text-white/70 truncate" title={item.label}>
            {item.label}
          </span>
          <div className="flex-1 h-3.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full"
              style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-xs text-white/50 text-right">{item.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Link back to the tree viewer, shown on every state of the page. */
function BackLink() {
  return (
    <Link
      href="/"
      data-testid="stats-back-link"
      className="text-xs text-white/60 hover:text-white select-none transition-colors inline-flex items-center gap-1"
    >
      ← Back to tree
    </Link>
  )
}

/** Reusable chart section wrapper with title and bar chart. */
function ChartSection({
  title,
  testId,
  items,
}: {
  title: string
  testId: string
  items: BarItem[]
}) {
  return (
    <section className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <h2 className="text-white text-sm font-semibold mb-4">{title}</h2>
      <BarChart testId={testId} items={items} />
    </section>
  )
}

/**
 * `/stats` page component.
 *
 * Fetches `GET /api/stats` once on mount and renders the result as dark
 * glassmorphism stat cards plus pure-CSS bar charts for births-by-decade,
 * top surnames, and top birthplaces. Handles loading and error states, and
 * always offers a link back to the tree viewer.
 *
 * @returns {React.ReactElement} Rendered stats page
 */
export default function StatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/stats', { signal: ctrl.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: StatsResponse) => {
        setStats(data)
        setLoading(false)
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return
        console.error('Failed to load stats', err)
        setError('Could not load family statistics. Please check your database connection and refresh.')
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [])

  if (loading) {
    return (
      <main
        data-testid="stats-loading"
        className="min-h-screen w-full bg-[#050a18] flex items-center justify-center"
      >
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-6 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <p className="text-white/70 text-sm">Loading statistics…</p>
        </div>
      </main>
    )
  }

  if (error || !stats) {
    return (
      <main
        data-testid="stats-error"
        className="min-h-screen w-full bg-[#050a18] flex flex-col items-center justify-center gap-4 px-4"
      >
        <div className="bg-white/10 backdrop-blur-md border border-red-400/30 rounded-2xl p-6 max-w-sm text-center shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <p className="text-red-300 text-sm">{error ?? 'Could not load family statistics.'}</p>
        </div>
        <BackLink />
      </main>
    )
  }

  return (
    <main data-testid="stats-page" className="min-h-screen w-full bg-[#050a18] px-4 py-8 sm:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-white text-xl font-semibold tracking-wide">Family Statistics</h1>
          <BackLink />
        </div>

        <section className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard testId="stats-total-people" label="Total people" value={stats.totalPeople} />
          <StatCard testId="stats-union-count" label="Unions" value={stats.unionCount} />
          <StatCard
            testId="stats-average-lifespan"
            label="Average lifespan"
            value={stats.averageLifespan !== null ? `${Math.round(stats.averageLifespan)} yrs` : '—'}
          />
          <StatCard
            testId="stats-sex-breakdown"
            label="Sex breakdown"
            value={`${stats.sexBreakdown.male}M / ${stats.sexBreakdown.female}F`}
            hint={stats.sexBreakdown.unknown > 0 ? `${stats.sexBreakdown.unknown} unknown` : undefined}
          />
          <StatCard
            testId="stats-oldest-ancestor"
            label="Oldest known ancestor"
            value={stats.oldestAncestor ? stats.oldestAncestor.name || 'Unknown' : '—'}
            hint={stats.oldestAncestor ? `b. ${stats.oldestAncestor.birthYear}` : undefined}
          />
          <StatCard
            testId="stats-largest-union"
            label="Largest union"
            value={stats.largestUnion ? `${stats.largestUnion.childCount} children` : '—'}
            hint={
              stats.largestUnion
                ? stats.largestUnion.parents.filter(Boolean).join(' & ') || undefined
                : undefined
            }
          />
        </section>

        <ChartSection
          title="Births by decade"
          testId="stats-decades-chart"
          items={stats.birthsByDecade.map(d => ({ label: `${d.decade}s`, value: d.count }))}
        />

        <ChartSection
          title="Top surnames"
          testId="stats-surnames-chart"
          items={stats.topSurnames.map(s => ({ label: s.surname, value: s.count }))}
        />

        <ChartSection
          title="Top birthplaces"
          testId="stats-birthplaces-chart"
          items={stats.topBirthplaces.map(b => ({ label: b.birthPlace, value: b.count }))}
        />
      </div>
    </main>
  )
}
