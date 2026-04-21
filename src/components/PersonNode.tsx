'use client'

import { Handle, Position, type NodeProps } from 'reactflow'
import type { PersonData } from '@/types/tree'

const SEX_BG: Record<string, string> = {
  M: '#dbeafe',
  F: '#fce7f3',
}

export default function PersonNode({ data }: NodeProps<PersonData>) {
  const bg = SEX_BG[data.sex] ?? '#f3f4f6'

  const dates = [
    data.birthYear ? `b. ${data.birthYear}` : null,
    data.deathYear ? `d. ${data.deathYear}` : null,
  ]
    .filter(Boolean)
    .join('  ')

  return (
    <div
      style={{
        background: bg,
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 12,
        minWidth: 140,
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 600 }}>{data.name}</div>
      {dates && <div style={{ color: '#666', marginTop: 2 }}>{dates}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
