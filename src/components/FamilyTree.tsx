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
import SearchBar, { type Person } from '@/components/SearchBar'
import PersonDrawer from '@/components/PersonDrawer'
import Toolbar from '@/components/Toolbar'
import { applyDagreLayout } from '@/lib/layout'
import { REL, type TreeResponse, type PersonData } from '@/types/tree'

const nodeTypes = { person: PersonNode, union: UnionNode }

const baseEdge = {
  type: 'smoothstep' as const,
  animated: false,
}
const edgeStyleChild = {
  ...baseEdge,
  style: { stroke: '#64748b', strokeWidth: 1.25, opacity: 0.55 },
}
const edgeStyleUnion = {
  ...baseEdge,
  style: { stroke: '#fbbf24', strokeWidth: 1.25, opacity: 0.45, strokeDasharray: '4 3' },
}

interface Stats {
  personCount: number
  unionCount: number
  ancestorGens: number
  descendantGens: number
  nodeCount: number
  rootName: string
}

const PERSON_NODE_CENTER_X = 100
const PERSON_NODE_CENTER_Y = 38

function pickDefaultRoot(persons: Person[]): Person | undefined {
  return (
    persons.find(p => p.birthYear && p.deathYear && p.birthPlace) ??
    persons.find(p => p.birthYear || p.deathYear) ??
    persons.find(p => p.name && p.name.trim().length > 2) ??
    persons[0]
  )
}

function minimapNodeColor(n: Node) {
  const d = n.data as PersonData | undefined
  if (n.type !== 'person') return '#fbbf24'
  if (d?.isRoot) return '#fde68a'
  const g = d?.generation ?? 0
  if (g < 0) return '#818cf8'
  if (g > 0) return '#34d399'
  return '#94a3b8'
}

function FlowCanvas({
  rootId,
  setRootId,
  depth,
  selectedPersonId,
  onSelectPerson,
  onStats,
  fitSignal,
}: {
  rootId: string
  setRootId: (id: string) => void
  depth: number
  selectedPersonId: string | null
  onSelectPerson: (id: string | null) => void
  onStats: (stats: Stats) => void
  fitSignal: number
}) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { fitView, setCenter, getNode } = useReactFlow()
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  useEffect(() => {
    if (!rootId) return
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/tree/${encodeURIComponent(rootId)}?depth=${depth}`)
        if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`)
        const data: TreeResponse = await res.json()
        if (cancelled) return

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
          label: e.label,
          ...(e.label === REL.CHILD ? edgeStyleChild : edgeStyleUnion),
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
        onStatsRef.current({
          personCount,
          unionCount,
          ancestorGens: -minGen,
          descendantGens: maxGen,
          nodeCount: laid.nodes.length,
          rootName,
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [rootId, depth])

  useEffect(() => {
    if (nodes.length === 0) return
    const root = nodes.find(n => (n.data as PersonData)?.isRoot)
    if (!root) {
      fitView({ duration: 500, padding: 0.15 })
      return
    }
    const t = setTimeout(
      () => setCenter(root.position.x + PERSON_NODE_CENTER_X, root.position.y + PERSON_NODE_CENTER_Y, { zoom: 1, duration: 600 }),
      80,
    )
    return () => clearTimeout(t)
  }, [nodes, fitView, setCenter])

  useEffect(() => {
    if (fitSignal > 0) fitView({ duration: 500, padding: 0.15 })
  }, [fitSignal, fitView])

  useEffect(() => {
    if (!selectedPersonId) return
    // Intentionally not depending on `nodes`: we only want to recenter when the
    // selection changes, not on every tree refetch.
    const match = getNode(selectedPersonId)
    const direct = match
      ? match
      : (nodesRef.current.find(x => (x.data as PersonData)?.gedcomId === selectedPersonId) ?? null)
    if (direct) {
      setCenter(direct.position.x + PERSON_NODE_CENTER_X, direct.position.y + PERSON_NODE_CENTER_Y, { zoom: 1.2, duration: 500 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersonId])

  if (error) {
    return <div className="flex items-center justify-center h-full text-rose-300">{error}</div>
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
          if (node.type === 'person') onSelectPerson((node.data as PersonData).gedcomId)
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type === 'person') setRootId((node.data as PersonData).gedcomId)
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
          nodeColor={minimapNodeColor}
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
  const [persons, setPersons] = useState<Person[]>([])
  const [rootId, setRootIdState] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [depth, setDepth] = useState(6)
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats>({
    personCount: 0,
    unionCount: 0,
    ancestorGens: 0,
    descendantGens: 0,
    nodeCount: 0,
    rootName: '',
  })
  const [fitSignal, setFitSignal] = useState(0)
  const didInit = useRef(false)

  useEffect(() => {
    fetch('/api/persons')
      .then(r => r.json() as Promise<Person[]>)
      .then(list => {
        setPersons(list)
        if (!didInit.current) {
          didInit.current = true
          const chosen = pickDefaultRoot(list)
          if (chosen) setRootIdState(chosen.gedcomId)
        }
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
      setRootIdState(h[h.length - 1])
      return h.slice(0, -1)
    })
  }, [])

  const onFit = useCallback(() => setFitSignal(x => x + 1), [])

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
    onFit,
  }), [rootId, stats, depth, history.length, goBack, onFit])

  return (
    <div className="relative w-screen h-screen bg-[radial-gradient(ellipse_at_center,_#0a1124_0%,_#030711_70%)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-50">
        <div className="absolute -top-32 -left-32 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute top-1/4 right-0 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <ReactFlowProvider>
        <SearchBar
          persons={persons}
          onSelect={(id) => { setRootId(id); setSelectedPersonId(id) }}
        />
        <Toolbar {...toolbarProps} />
        <FlowCanvas
          rootId={rootId}
          setRootId={setRootId}
          depth={depth}
          selectedPersonId={selectedPersonId}
          onSelectPerson={setSelectedPersonId}
          onStats={setStats}
          fitSignal={fitSignal}
        />
        <PersonDrawer
          personId={selectedPersonId}
          onClose={() => setSelectedPersonId(null)}
          onFocus={(id) => { setRootId(id); setSelectedPersonId(id) }}
          onSelect={setSelectedPersonId}
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
