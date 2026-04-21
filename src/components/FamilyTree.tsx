'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'

import PersonNode from '@/components/PersonNode'
import UnionNode from '@/components/UnionNode'
import SearchBar from '@/components/SearchBar'
import PersonDrawer from '@/components/PersonDrawer'
import Toolbar from '@/components/Toolbar'
import { applyDagreLayout } from '@/lib/layout'
import type { TreeResponse, PersonData } from '@/types/tree'

const nodeTypes = { person: PersonNode, union: UnionNode }

const edgeStyleChild = {
  type: 'smoothstep' as const,
  style: { stroke: '#64748b', strokeWidth: 1.25, opacity: 0.55 },
  animated: false,
}
const edgeStyleUnion = {
  type: 'smoothstep' as const,
  style: {
    stroke: '#fbbf24',
    strokeWidth: 1.25,
    opacity: 0.45,
    strokeDasharray: '4 3',
  },
  animated: false,
}

function FlowCanvas({
  rootId,
  setRootId,
  depth,
  selectedPersonId,
  onSelectPerson,
  exposeStats,
  fitSignal,
}: {
  rootId: string
  setRootId: (id: string) => void
  depth: number
  selectedPersonId: string | null
  onSelectPerson: (id: string | null) => void
  exposeStats: (stats: { personCount: number; unionCount: number; ancestorGens: number; descendantGens: number; nodeCount: number; rootName: string }) => void
  fitSignal: number
}) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { fitView, setCenter, getNode } = useReactFlow()

  const fetchTree = useCallback(async () => {
    if (!rootId) return
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/tree/${encodeURIComponent(rootId)}?depth=${depth}`)
      if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`)
      const data: TreeResponse = await res.json()

      const rootInternal =
        data.nodes.find(n => n.type === 'person' && (n.data as PersonData).gedcomId === rootId)?.id ??
        null

      const rawNodes: Node[] = data.nodes.map(n => ({
        id: n.id,
        type: n.type,
        data: n.data,
        position: n.position,
      }))

      const rawEdges: Edge[] = data.edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        data: { kind: e.label },
        label: e.label, // consumed by layout for CHILD detection, hidden via CSS
        ...(e.label === 'CHILD' ? edgeStyleChild : edgeStyleUnion),
      }))

      const laid = applyDagreLayout(rawNodes, rawEdges, { rootId: rootInternal })

      let personCount = 0
      let unionCount = 0
      let minGen = 0
      let maxGen = 0
      let rootName = ''
      for (const n of laid.nodes) {
        if (n.type === 'person') {
          personCount++
          const pd = n.data as PersonData
          if (pd.isRoot) rootName = pd.name
          const g = pd.generation ?? 0
          if (g < minGen) minGen = g
          if (g > maxGen) maxGen = g
        } else unionCount++
      }

      setNodes(laid.nodes)
      setEdges(laid.edges)
      exposeStats({
        personCount,
        unionCount,
        ancestorGens: -minGen,
        descendantGens: maxGen,
        nodeCount: laid.nodes.length,
        rootName,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [rootId, depth, exposeStats])

  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  useEffect(() => {
    if (nodes.length === 0) return
    const root = nodes.find(n => (n.data as PersonData)?.isRoot)
    if (root) {
      // Center and zoom on root initially.
      setTimeout(() => setCenter(root.position.x + 100, root.position.y + 38, { zoom: 1, duration: 600 }), 80)
    } else {
      fitView({ duration: 500, padding: 0.15 })
    }
  }, [nodes, fitView, setCenter])

  useEffect(() => {
    if (fitSignal > 0) fitView({ duration: 500, padding: 0.15 })
  }, [fitSignal, fitView])

  // Focus-scroll to the currently selected person when drawer opens
  useEffect(() => {
    if (!selectedPersonId) return
    const n = nodes.find(x => (x.data as PersonData)?.gedcomId === selectedPersonId)
    if (n) {
      setCenter(n.position.x + 100, n.position.y + 38, { zoom: 1.2, duration: 500 })
    }
  }, [selectedPersonId, nodes, setCenter, getNode])

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-rose-300">
        {error}
      </div>
    )
  }

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          if (node.type === 'person') {
            onSelectPerson((node.data as PersonData).gedcomId)
          }
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type === 'person') {
            setRootId((node.data as PersonData).gedcomId)
          }
        }}
        onPaneClick={() => onSelectPerson(null)}
      >
        <Background variant={BackgroundVariant.Dots} color="#1e2a4a" gap={28} size={1} />
        <MiniMap
          pannable
          zoomable
          style={{
            background: '#0b1224',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
          }}
          maskColor="rgba(3, 7, 18, 0.75)"
          nodeColor={(n) => {
            const d = n.data as PersonData | undefined
            if (n.type !== 'person') return '#fbbf24'
            if (d?.isRoot) return '#fde68a'
            const g = d?.generation ?? 0
            if (g < 0) return '#818cf8'
            if (g > 0) return '#34d399'
            return '#94a3b8'
          }}
        />
        <Controls
          className="!bg-slate-900/80 !backdrop-blur !border !border-white/10 !rounded-lg !shadow-lg"
          showInteractive={false}
        />
      </ReactFlow>
      {loading && (
        <div className="absolute top-4 right-4 z-20 text-[11px] uppercase tracking-widest text-white/50 bg-slate-900/70 border border-white/10 rounded-full px-3 py-1">
          Loading…
        </div>
      )}
    </>
  )
}

export default function FamilyTree() {
  const [rootId, setRootIdState] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [depth, setDepth] = useState(6)
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [stats, setStats] = useState({
    personCount: 0,
    unionCount: 0,
    ancestorGens: 0,
    descendantGens: 0,
    nodeCount: 0,
    rootName: '',
  })
  const [fitSignal, setFitSignal] = useState(0)
  const didInit = useRef(false)

  // Initial root selection — prefer someone with both birth and death year and a place
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    fetch('/api/persons')
      .then(r => r.json())
      .then((persons: Array<{ gedcomId: string; name: string; birthYear: string | null; deathYear: string | null; birthPlace: string | null }>) => {
        const richest = persons.find(p => p.birthYear && p.deathYear && p.birthPlace)
        const withDates = persons.find(p => p.birthYear || p.deathYear)
        const withName = persons.find(p => p.name && p.name.trim().length > 2)
        const chosen = richest ?? withDates ?? withName ?? persons[0]
        if (chosen) setRootIdState(chosen.gedcomId)
      })
  }, [])

  const setRootId = useCallback((id: string) => {
    setRootIdState(prev => {
      if (prev === id) return prev
      setHistory(h => (prev ? [...h, prev] : h))
      return id
    })
  }, [])

  const goBack = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      setRootIdState(prev)
      return h.slice(0, -1)
    })
  }, [])

  const exposeStats = useCallback((s: typeof stats) => setStats(s), [])

  const toolbarProps = useMemo(() => ({
    rootId,
    rootName: stats.rootName,
    nodeCount: stats.nodeCount,
    personCount: stats.personCount,
    unionCount: stats.unionCount,
    ancestorGens: stats.ancestorGens,
    descendantGens: stats.descendantGens,
    depth,
    onDepth: setDepth,
    canGoBack: history.length > 0,
    onBack: goBack,
    onFit: () => setFitSignal(x => x + 1),
  }), [rootId, stats, depth, history.length, goBack])

  return (
    <div className="relative w-screen h-screen bg-[radial-gradient(ellipse_at_center,_#0a1124_0%,_#030711_70%)] overflow-hidden">
      {/* Soft aurora backdrop */}
      <div className="pointer-events-none absolute inset-0 opacity-50">
        <div className="absolute -top-32 -left-32 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute top-1/4 right-0 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <ReactFlowProvider>
        <SearchBar onSelect={(id) => { setRootId(id); setSelectedPersonId(id) }} />
        <Toolbar {...toolbarProps} />
        <FlowCanvas
          rootId={rootId}
          setRootId={setRootId}
          depth={depth}
          selectedPersonId={selectedPersonId}
          onSelectPerson={setSelectedPersonId}
          exposeStats={exposeStats}
          fitSignal={fitSignal}
        />
        <PersonDrawer
          personId={selectedPersonId}
          onClose={() => setSelectedPersonId(null)}
          onFocus={(id) => { setRootId(id); setSelectedPersonId(id) }}
          onSelect={(id) => setSelectedPersonId(id)}
        />
        <Legend />
      </ReactFlowProvider>
    </div>
  )
}

function Legend() {
  return (
    <div className="absolute bottom-4 left-4 z-10 bg-slate-900/70 backdrop-blur border border-white/10 rounded-xl px-3 py-2 text-[10px] text-white/60 space-y-1 leading-tight">
      <div className="uppercase tracking-[0.2em] text-white/35 text-[9px] mb-1">Legend</div>
      <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" />Male</div>
      <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-pink-400" />Female</div>
      <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" />Marriage</div>
      <div className="flex items-center gap-2 pt-1"><span className="h-3 w-3 rounded border-2 border-amber-300" />★ Root (click to open, dbl-click to focus)</div>
    </div>
  )
}
