/**
 * @fileoverview UnionNode component for React Flow.
 * Renders a small connector node representing a relationship/union between two people in the family tree.
 */

'use client'
import { NodeProps, Handle, Position } from 'reactflow'
import { UnionData } from '@/types/tree'

/**
 * UnionNode component for React Flow
 *
 * Displays a small circular connector node that represents a union/relationship between two people.
 * Shows a hover tooltip with marriage year and place when available.
 * Handles are hidden (opacity: 0) to keep the visual clean while maintaining connections internally.
 *
 * @param {NodeProps<UnionData>} props - React Flow node props with union data
 * @returns {React.ReactNode} A small circular div styled as a connection point with hidden handles
 */
export default function UnionNode({ data }: NodeProps<UnionData>) {
  const parts: string[] = []
  if (data.marriageYear) parts.push(`m. ${data.marriageYear}`)
  if (data.marriagePlace) parts.push(data.marriagePlace)
  const tooltip = parts.join(' · ')

  return (
    <div
      className="group relative w-3 h-3 rounded-full bg-amber-400/60 border border-white/40 shadow-[0_0_10px_rgba(255,255,255,0.5)]"
      title={tooltip}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      {tooltip && (
        <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap rounded bg-black/75 px-2 py-0.5 text-xs text-white pointer-events-none">
          {tooltip}
        </span>
      )}
    </div>
  )
}
