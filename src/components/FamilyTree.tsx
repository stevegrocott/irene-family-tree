'use client'

import { useEffect, useState, useCallback } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'

import PersonNode from '@/components/PersonNode'
import UnionNode from '@/components/UnionNode'
import { applyDagreLayout } from '@/lib/layout'
import type { TreeResponse } from '@/types/tree'

const nodeTypes = { person: PersonNode, union: UnionNode }

const defaultEdgeOptions = {
  type: 'smoothstep',
  style: { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.5 },
  animated: false,
}

interface FamilyTreeProps {
  rootId?: string
}

export default function FamilyTree({ rootId = '' }: FamilyTreeProps) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTree = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/tree/${rootId}`)
      if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`)
      const data: TreeResponse = await res.json()

      const rawNodes: Node[] = data.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        data: n.data,
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
    <div className="w-screen h-screen bg-[#050a18]">
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
    </div>
  )
}
