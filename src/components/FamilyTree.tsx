'use client'

import { useEffect, useState, useCallback } from 'react'
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
import { applyDagreLayout } from '@/lib/layout'
import type { TreeResponse } from '@/types/tree'

const nodeTypes = { person: PersonNode, union: UnionNode }

const defaultEdgeOptions = {
  type: 'smoothstep',
  style: { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.5 },
  animated: false,
}

function FlowCanvas({ rootId, onSelectRoot }: { rootId: string; onSelectRoot: (id: string) => void }) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { fitView } = useReactFlow()

  const fetchTree = useCallback(async () => {
    if (!rootId) return
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/tree/${rootId}`)
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

      const rawEdges: Edge[] = data.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
      }))

      const laid = applyDagreLayout(rawNodes, rawEdges)
      setNodes(laid.nodes)
      setEdges(laid.edges)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [rootId])

  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  useEffect(() => {
    if (nodes.length > 0) {
      fitView()
    }
  }, [nodes, fitView])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        Loading family tree…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        {error}
      </div>
    )
  }

  return (
    <>
      <SearchBar onSelect={onSelectRoot} />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        proOptions={{ hideAttribution: true }}
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
        if (persons.length > 0) setRootId(persons[0].gedcomId)
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
