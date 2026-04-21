'use client'
import { Handle, Position } from 'reactflow'

export default function UnionNode() {
  return (
    <div className="w-3 h-3 rounded-full bg-white/25 border border-white/40 shadow-[0_0_10px_rgba(255,255,255,0.5)]">
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
