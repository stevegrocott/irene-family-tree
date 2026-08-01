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
export default function UnionNode({ data, marriageYear: propYear, marriagePlace: propPlace }: NodeProps<UnionData> & { marriageYear?: string | null; marriagePlace?: string | null }) {
  const marriageYear = data?.marriageYear ?? propYear
  const marriagePlace = data?.marriagePlace ?? propPlace
  const parts: string[] = []
  if (marriageYear) parts.push(`m. ${marriageYear}`)
  if (marriagePlace) parts.push(marriagePlace)
  const tooltip = parts.join(' · ')

  return (
    <div
      className="group relative w-1.5 h-1.5 rounded-full bg-brass"
      title={tooltip || undefined}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      {tooltip && (
        <span
          className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap rounded-md border border-line bg-surface text-ink px-2 py-0.5 pointer-events-none"
          style={{ font: 'var(--ft-mono)', boxShadow: 'var(--ft-shadow-2)' }}
        >
          {tooltip}
        </span>
      )}
    </div>
  )
}
