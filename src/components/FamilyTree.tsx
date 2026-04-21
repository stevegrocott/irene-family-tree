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
import dagre from '@dagrejs/dagre'
import 'reactflow/dist/style.css'

import PersonNode from '@/components/PersonNode'
import type { TreeResponse } from '@/types/tree'

const nodeTypes = { person: PersonNode }

const defaultEdgeOptions = {
  style: { stroke: '#94a3b8', strokeWidth: 1.5 },
  animated: false,
}

const NODE_WIDTH = 180
const NODE_HEIGHT = 70

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80 })

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach((e) => g.setEdge(e.source, e.target))

  dagre.layout(g)

  return nodes.map((n) => {
    const { x, y } = g.node(n.id)
    return { ...n, position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 } }
  })
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

      setNodes(applyDagreLayout(rawNodes, rawEdges))
      setEdges(rawEdges)
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
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} color="#1e2a4a" gap={20} size={1.5} />
      <MiniMap
        style={{ background: '#0f172a' }}
        nodeColor="#334155"
        maskColor="rgba(0,0,0,0.6)"
      />
      <Controls />
    </ReactFlow>
  )
}
