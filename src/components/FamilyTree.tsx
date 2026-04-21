/**
 * @fileoverview Interactive family tree visualisation component.
 * Renders a ReactFlow canvas that fetches person/relationship data from the API,
 * applies a dagre hierarchical layout, and supports search, depth control,
 * node selection, and re-rooting the tree at any person.
 */

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

/**
 * Minimal person summary used for the search bar and root selection.
 * @property gedcomId - GEDCOM identifier of the person
 * @property name - Display name of the person
 */
interface Person { gedcomId: string; name: string }

/** Map of custom node types for ReactFlow visualization. */
const nodeTypes = { person: PersonNode, union: UnionNode }

/** Default edge styling applied to all edges. */
const defaultEdgeStyle: React.CSSProperties = { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.5 }

/** Default configuration for all edges in the flow. */
const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
}

/** Tailwind classes applied to depth control buttons. */
const depthBtnClass = 'w-6 h-6 flex items-center justify-center rounded-lg text-white/80 hover:bg-white/15 hover:text-white transition-colors text-sm font-medium'

/**
 * Control for adjusting tree depth (number of hops from root).
 * Allows user to expand or collapse the family tree visualization.
 *
 * @param {number} hops - Current depth value between MIN_HOPS and MAX_HOPS
 * @param {Function} onChange - Callback fired when user adjusts the depth
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
 * Displays count of people and families currently visible in the tree.
 * Hidden when no people are displayed.
 *
 * @param {number} personCount - Number of person nodes displayed
 * @param {number} unionCount - Number of union (family) nodes displayed
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
 * Side drawer panel showing details for a selected person.
 * Displays name, dates, and GEDCOM ID. Allows re-rooting the tree at this person.
 *
 * @param {PersonData} person - Person to display details for
 * @param {Function} onClose - Called when user closes the drawer
 * @param {Function} onReroot - Called with person's gedcomId to re-root the tree
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
 * Main canvas for rendering the family tree using ReactFlow.
 * Fetches tree data from API, applies hierarchical layout, and handles user interactions
 * (node selection, depth adjustment, pan/zoom).
 *
 * @param {string} rootId - GEDCOM ID of the tree root person
 * @param {Function} onSelectRoot - Called when user selects a new root person
 * @param {Person[]} persons - Available people for search/selection
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

  /** Counts of person and union nodes currently rendered, derived from `nodes`. */
  const { personCount, unionCount } = useMemo(() => {
    let personCount = 0, unionCount = 0
    for (const n of nodes) {
      if (n.type === 'person') personCount++
      else if (n.type === 'union') unionCount++
    }
    return { personCount, unionCount }
  }, [nodes])

  /**
   * Opens the person drawer when a person node is clicked.
   *
   * @param _event - Unused mouse event from ReactFlow
   * @param node - The clicked ReactFlow node
   */
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type === 'person') {
      setSelectedPerson(node.data as PersonData)
    }
  }, [])

  /**
   * Fetches tree data for the current `rootId` and `hops` depth, applies dagre
   * layout, and updates the node/edge state. Aborts any in-flight request first.
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

      const laid = applyDagreLayout(rawNodes, rawEdges, { rootId })
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

  /** Re-fetches the tree whenever `rootId` or `hops` changes. */
  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  /**
   * Fits the viewport to the tree bounds after layout completes.
   * Falls back to centering on the root node when the tree is too large to fit at MIN_ZOOM.
   */
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
 * Root component for the interactive family tree visualization.
 * Fetches available people and renders the tree canvas with search and navigation.
 */
export default function FamilyTree() {
  const [rootId, setRootId] = useState('')
  const [persons, setPersons] = useState<Person[]>([])
  const [personsError, setPersonsError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/persons', { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Person[]) => {
        setPersons(data)
        const defaultPerson = data.find(p => p.gedcomId === '@I85@') ?? data.find(p => p.name?.trim()) ?? data[0]
        if (defaultPerson) setRootId(defaultPerson.gedcomId)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        console.error('Failed to load persons', err)
        setPersonsError('Could not load family members. Please check your database connection and refresh.')
      })
    return () => ctrl.abort()
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
