'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type React from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  getViewportForBounds,
  type Node,
  type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'

import PersonNode from '@/components/PersonNode'
import UnionNode from '@/components/UnionNode'
import SearchBar from '@/components/SearchBar'
import { applyDagreLayout } from '@/lib/layout'
import { formatLifespan } from '@/lib/person'
import type { TreeResponse, PersonData } from '@/types/tree'
import { MIN_HOPS, DEFAULT_HOPS, MAX_HOPS, EDGE_STYLES, EDGE_TYPES } from '@/constants/tree'

interface Person { gedcomId: string; name: string }

const nodeTypes = { person: PersonNode, union: UnionNode }

const defaultEdgeStyle: React.CSSProperties = { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.5 }

const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
}

const depthBtnClass = 'w-6 h-6 flex items-center justify-center rounded-lg text-white/80 hover:bg-white/15 hover:text-white transition-colors text-sm font-medium'

/**
 * DepthControl overlay component for adjusting graph traversal depth.
 */
function DepthControl({ hops, onChange }: { hops: number; onChange: (hops: number) => void }) {
  return (
    <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-3 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <span className="text-xs text-white/60 select-none">Depth</span>
      <button
        data-testid="hops-decrease"
        onClick={() => onChange(Math.max(MIN_HOPS, hops - 1))}
        className={depthBtnClass}
        aria-label="Decrease depth"
      >
        −
      </button>
      <span data-testid="hops-value" className="text-sm text-white font-medium w-4 text-center select-none">
        {hops}
      </span>
      <button
        data-testid="hops-increase"
        onClick={() => onChange(Math.min(MAX_HOPS, hops + 1))}
        className={depthBtnClass}
        aria-label="Increase depth"
      >
        +
      </button>
    </div>
  )
}

/**
 * Toolbar overlay showing stats derived from currently laid-out nodes.
 */
function Toolbar({ personCount, unionCount }: { personCount: number; unionCount: number }) {
  if (personCount === 0) return null
  return (
    <div
      data-testid="toolbar"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-4 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
    >
      <span className="text-xs text-white/60 select-none">
        <span className="text-white font-medium">{personCount}</span> people
      </span>
      {unionCount > 0 && (
        <span className="text-xs text-white/60 select-none">
          <span className="text-white font-medium">{unionCount}</span> families
        </span>
      )}
    </div>
  )
}

/**
 * PersonDrawer side panel shown when a node is clicked.
 * Displays the selected person's details and provides a re-root action.
 */
function PersonDrawer({
  person,
  onClose,
  onReroot,
}: {
  person: PersonData
  onClose: () => void
  onReroot: (id: string) => void
}) {
  const dates = formatLifespan(person)

  return (
    <div
      data-testid="person-drawer"
      className="absolute top-0 right-0 h-full w-72 z-20 bg-[#0a1628]/90 backdrop-blur-xl border-l border-white/10 shadow-[-8px_0_32px_rgba(0,0,0,0.5)] flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <h2 className="text-white font-semibold text-base truncate flex-1 mr-2">
          {person.name || <span className="text-slate-500 italic">Unknown</span>}
        </h2>
        <button
          data-testid="person-drawer-close"
          onClick={onClose}
          aria-label="Close panel"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 px-5 py-4 space-y-3">
        {dates && (
          <p className="text-slate-400 text-sm">{dates}</p>
        )}
        <p className="text-slate-500 text-xs font-mono">{person.gedcomId}</p>
      </div>

      {/* Footer – re-root action */}
      <div className="px-5 py-4 border-t border-white/10">
        <button
          data-testid="person-drawer-reroot"
          onClick={() => { onReroot(person.gedcomId); onClose() }}
          className="w-full py-2 rounded-xl bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
        >
          Re-root tree here
        </button>
      </div>
    </div>
  )
}

/**
 * FlowCanvas component renders a React Flow visualization of the family tree.
 */
function FlowCanvas({
  rootId,
  onSelectRoot,
  persons,
}: {
  rootId: string
  onSelectRoot: (id: string) => void
  persons: Person[]
}) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [treeBounds, setTreeBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hops, setHops] = useState(DEFAULT_HOPS)
  const [selectedPerson, setSelectedPerson] = useState<PersonData | null>(null)
  const { setViewport } = useReactFlow()
  const abortRef = useRef<AbortController | null>(null)

  const personCount = useMemo(() => nodes.filter(n => n.type === 'person').length, [nodes])
  const unionCount  = useMemo(() => nodes.filter(n => n.type === 'union').length, [nodes])

  /**
   * Opens the PersonDrawer for the clicked person node.
   */
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type === 'person') {
      setSelectedPerson(node.data as PersonData)
    }
  }, [])

  /**
   * Fetches tree data from the API and updates graph visualization.
   */
  const fetchTree = useCallback(async () => {
    if (!rootId) return
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/tree/${rootId}?hops=${hops}`, { signal: abortRef.current.signal })
      if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`)
      const data: TreeResponse = await res.json()

      const rawNodes: Node[] = data.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        data: n.type === 'person'
          ? { ...n.data, isRoot: (n.data as PersonData).gedcomId === rootId }
          : n.data,
        position: n.position,
      }))

      const rawEdges: Edge[] = data.edges.map((e) => {
        const isChild = e.label === EDGE_TYPES.CHILD
        return {
          id: e.id,
          source: isChild ? e.target : e.source,
          target: isChild ? e.source : e.target,
          style: EDGE_STYLES[e.label] ?? defaultEdgeStyle,
          data: { relType: e.label },
        }
      })

      const laid = applyDagreLayout(rawNodes, rawEdges)
      setNodes(laid.nodes)
      setEdges(laid.edges)
      setTreeBounds(laid.bounds)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [rootId, hops])

  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  useEffect(() => {
    if (!treeBounds || nodes.length === 0) return
    const id = setTimeout(() => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const PADDING = 0.15
      const MIN_ZOOM = 0.18

      const idealZoom = Math.min(
        (vw * (1 - 2 * PADDING)) / treeBounds.width,
        (vh * (1 - 2 * PADDING)) / treeBounds.height,
      )

      if (idealZoom >= MIN_ZOOM) {
        setViewport(getViewportForBounds(treeBounds, vw, vh, MIN_ZOOM, 2, PADDING), { duration: 300 })
      } else {
        const rootNode = nodes.find(
          n => n.type === 'person' && (n.data as PersonData).gedcomId === rootId
        )
        if (rootNode) {
          setViewport({
            zoom: MIN_ZOOM,
            x: vw / 2 - (rootNode.position.x + 80) * MIN_ZOOM,
            y: vh / 2 - (rootNode.position.y + 34) * MIN_ZOOM,
          }, { duration: 300 })
        }
      }
    }, 50)
    return () => clearTimeout(id)
  }, [treeBounds, nodes, rootId, setViewport])

  return (
    <>
      <SearchBar onSelect={onSelectRoot} persons={persons} />
      <DepthControl hops={hops} onChange={setHops} />
      <Toolbar personCount={personCount} unionCount={unionCount} />
      {/* Loading/error overlays — ReactFlow stays mounted so its viewport is always initialized */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 z-10 pointer-events-none">
          Loading family tree…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400 z-10 pointer-events-none">
          {error}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
      >
        <Background variant={BackgroundVariant.Dots} color="#1e2a4a" gap={28} size={1} />
        <MiniMap
          style={{ background: '#0f172a' }}
          nodeColor="#6366f1"
          maskColor="rgba(0,0,0,0.6)"
        />
        <Controls />
      </ReactFlow>
      {selectedPerson && (
        <PersonDrawer
          person={selectedPerson}
          onClose={() => setSelectedPerson(null)}
          onReroot={(id) => { onSelectRoot(id); setSelectedPerson(null) }}
        />
      )}
    </>
  )
}

/**
 * FamilyTree page component.
 *
 * Main entry point for the family tree visualization. Fetches the persons list
 * once and passes it to child components (SearchBar) to avoid redundant requests.
 * Initializes the root person on mount from the fetched list.
 *
 * @component
 * @returns {React.ReactElement} Full-screen family tree visualization
 */
export default function FamilyTree() {
  const [rootId, setRootId] = useState('')
  const [persons, setPersons] = useState<Person[]>([])
  const [personsError, setPersonsError] = useState<string | null>(null)

  /**
   * Fetch the full persons list once. Use it to seed the initial root and
   * share with SearchBar so it doesn't make a duplicate request.
   */
  useEffect(() => {
    fetch('/api/persons')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Person[]) => {
        setPersons(data)
        const first = data.find(p => p.name?.trim()) ?? data[0]
        if (first) setRootId(first.gedcomId)
      })
      .catch((err) => {
        console.error('Failed to load persons', err)
        setPersonsError('Could not load family members. Please check your database connection and refresh.')
      })
  }, [])

  if (personsError) {
    return (
      <div className="relative w-screen h-screen bg-[#050a18] flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-md border border-red-400/30 rounded-2xl p-6 max-w-sm text-center shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <p className="text-red-300 text-sm">{personsError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-screen h-screen bg-[#050a18]">
      <ReactFlowProvider>
        <FlowCanvas rootId={rootId} onSelectRoot={setRootId} persons={persons} />
      </ReactFlowProvider>
    </div>
  )
}
