'use client'

import { useEffect, useState } from 'react'

interface Props {
  rootName: string
  rootId: string
  nodeCount: number
  personCount: number
  unionCount: number
  ancestorGens: number
  descendantGens: number
  depth: number
  onDepth: (n: number) => void
  canGoBack: boolean
  onBack: () => void
  onFit: () => void
}

export default function Toolbar({
  rootName,
  rootId,
  nodeCount,
  personCount,
  unionCount,
  ancestorGens,
  descendantGens,
  depth,
  onDepth,
  canGoBack,
  onBack,
  onFit,
}: Props) {
  const [localDepth, setLocalDepth] = useState(depth)
  useEffect(() => { setLocalDepth(depth) }, [depth])

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-900/80 backdrop-blur-xl border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
        <button
          onClick={onBack}
          disabled={!canGoBack}
          className="text-white/70 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed text-sm px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
          title="Previous root"
        >
          ← Back
        </button>
        <div className="w-px h-5 bg-white/10" />
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.22em] text-amber-200/60">
            Viewing
          </div>
          <div className="text-[13px] font-semibold text-white truncate max-w-[220px]">
            {rootName || rootId}
          </div>
        </div>
        <div className="w-px h-5 bg-white/10" />
        <Stat label="People" value={personCount} />
        <Stat label="Unions" value={unionCount} />
        <Stat label="Ancestors" value={ancestorGens} suffix="gen" />
        <Stat label="Descendants" value={descendantGens} suffix="gen" />
        <div className="w-px h-5 bg-white/10" />
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-[0.18em] text-white/40">
            Depth
          </label>
          <input
            type="range"
            min={1}
            max={12}
            value={localDepth}
            onChange={e => setLocalDepth(parseInt(e.target.value, 10))}
            onPointerUp={() => { if (localDepth !== depth) onDepth(localDepth) }}
            onKeyUp={() => { if (localDepth !== depth) onDepth(localDepth) }}
            className="w-24 accent-amber-300"
          />
          <span className="text-[11px] text-white/70 tabular-nums w-4 text-right">{localDepth}</span>
        </div>
        <div className="w-px h-5 bg-white/10" />
        <button
          onClick={onFit}
          className="text-white/70 hover:text-white text-xs px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
          title="Fit view"
        >
          ⤢ Fit
        </button>
      </div>
      <div className="hidden md:block text-[10px] text-white/30 tracking-wide pl-1">
        {nodeCount} / 500 nodes shown
      </div>
    </div>
  )
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[9px] uppercase tracking-[0.18em] text-white/40">{label}</div>
      <div className="text-[13px] text-white tabular-nums font-medium">
        {value}
        {suffix && <span className="text-white/40 text-[10px] ml-0.5">{suffix}</span>}
      </div>
    </div>
  )
}
