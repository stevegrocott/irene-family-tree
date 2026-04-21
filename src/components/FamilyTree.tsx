'use client'

import { useEffect, useState, useCallback } from 'react'
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
import type { TreeResponse } from '@/types/tree'

const nodeTypes = { person: PersonNode, union: UnionNode }

const EDGE_STYLES: Record<string, React.CSSProperties> = {
  UNION: { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.6 },
  CHILD: { stroke: '#a78bfa', strokeWidth: 1, opacity: 0.45 },
}
const defaultEdgeStyle: React.CSSProperties = { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.5 }

const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
}

function DepthControl({ hops, onChange }: { hops: number; onChange: (hops: number) => void }) {
  return (
    <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-3 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <span className="text-xs text-white/60 select-none">Depth</span>
      <button
        data-testid="hops-decrease"
        onClick={() => onChange(Math.max(1, hops - 1))}
        className="w-6 h-6 flex items-center justify-center rounded-lg text-white/80 hover:bg-white/15 hover:text-white transition-colors text-sm font-medium"
        aria-label="Decrease depth"
      >
        −
      </button>
      <span data-testid="hops-value" className="text-sm text-white font-medium w-4 text-center select-none">
        {hops}
      </span>
      <button
        data-testid="hops-increase"
        onClick={() => onChange(Math.min(16, hops + 1))}
        className="w-6 h-6 flex items-center justify-center rounded-lg text-white/80 hover:bg-white/15 hover:text-white transition-colors text-sm font-medium"
        aria-label="Increase depth"
      >
        +
      </button>
    </div>
  )
}

function FlowCanvas({ rootId, onSelectRoot }: { rootId: string; onSelectRoot: (id: string) => void }) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [treeBounds, setTreeBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hops, setHops] = useState(8)
  const { setViewport } = useReactFlow()

  const fetchTree = useCallback(async () => {
    if (!rootId) return
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/tree/${rootId}?hops=${hops}`)
      if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`)
      const data: TreeResponse = await res.json()

      const rawNodes: Node[] = data.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        data: n.type === 'person'
          ? { ...n.data, isRoot: (n.data as import('@/types/tree').PersonData).gedcomId === rootId }
          : n.data,
        position: n.position,
      }))

      const rawEdges: Edge[] = data.edges.map((e) => {
        // CHILD edges: Neo4j direction is child→union, but union is rendered above.
        // Swap source/target so React Flow routes top-down (union→person).
        const isChild = e.label === 'CHILD'
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

      // Ideal zoom to fit the entire tree
      const idealZoom = Math.min(
        (vw * (1 - 2 * PADDING)) / treeBounds.width,
        (vh * (1 - 2 * PADDING)) / treeBounds.height,
      )

      if (idealZoom >= MIN_ZOOM) {
        // Tree fits at a readable zoom — center the full tree
        setViewport(getViewportForBounds(treeBounds, vw, vh, MIN_ZOOM, 2, PADDING), { duration: 300 })
      } else {
        // Tree is wider than viewport at MIN_ZOOM — center on the root person instead
        const rootNode = nodes.find(
          n => n.type === 'person' && (n.data as import('@/types/tree').PersonData).gedcomId === rootId
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
      <SearchBar onSelect={onSelectRoot} />
      <DepthControl hops={hops} onChange={setHops} />
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
        onNodeClick={(_event, node) => {
          if (node.type === 'person') {
            onSelectRoot((node.data as import('@/types/tree').PersonData).gedcomId)
          }
        }}
      >
        <Background variant={BackgroundVariant.Dots} color="#1e2a4a" gap={28} size={1} />
        <MiniMap
          style={{ background: '#0f172a' }}
          nodeColor="#6366f1"
          maskColor="rgba(0,0,0,0.6)"
        />
        <Controls />
      </ReactFlow>
    </>
  )
}

export default function FamilyTree() {
  const [rootId, setRootId] = useState('')

  useEffect(() => {
    fetch('/api/persons')
      .then(r => r.json())
      .then((persons: Array<{ gedcomId: string; name: string }>) => {
        const first = persons.find(p => p.name?.trim()) ?? persons[0]
        if (first) setRootId(first.gedcomId)
      })
  }, [])

  return (
    <div className="relative w-screen h-screen bg-[#050a18]">
      <ReactFlowProvider>
        <FlowCanvas rootId={rootId} onSelectRoot={setRootId} />
      </ReactFlowProvider>
    </div>
  )
}
