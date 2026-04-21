/**
 * @fileoverview UnionNode component for React Flow.
 * Renders a small connector node representing a relationship/union between two people in the family tree.
 */

'use client'
import { Handle, Position } from 'reactflow'

/**
 * UnionNode component for React Flow
 *
 * Displays a small circular connector node that represents a union/relationship between two people.
 * This is a minimal visual element used to connect parent nodes to their children.
 * Handles are hidden (opacity: 0) to keep the visual clean while maintaining connections internally.
 *
 * @returns {React.ReactNode} A small circular div styled as a connection point with hidden handles
 */
export default function UnionNode() {
  return (
    <div className="w-3 h-3 rounded-full bg-white/25 border border-white/40 shadow-[0_0_10px_rgba(255,255,255,0.5)]">
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
