'use client'

import { Handle, Position, type NodeProps } from 'reactflow'
import type { UnionData } from '@/types/tree'

export default function UnionNode({ data }: NodeProps<UnionData>) {
  const year = data.marriageYear
  const place = data.marriagePlace
  const hasInfo = year || place
  const title = hasInfo
    ? `Married ${year ?? ''}${year && place ? ' · ' : ''}${place ?? ''}`
    : 'Union'

  return (
    <div
      title={title}
      className="relative flex items-center justify-center group"
      style={{ width: 14, height: 14 }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        className="h-2 w-2 rounded-full bg-amber-300/70 group-hover:bg-amber-200 transition-colors"
        style={{ boxShadow: '0 0 8px rgba(252, 211, 77, 0.45)' }}
      />
      {year && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[9px] text-amber-200/70 whitespace-nowrap tabular-nums opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          ♥ {year}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
