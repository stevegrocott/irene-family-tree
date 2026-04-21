/**
 * @fileoverview PersonNode component for React Flow.
 * Renders a node representing a person in the family tree with their name and life dates.
 */

'use client'

import { Handle, Position, type NodeProps } from 'reactflow'
import type { PersonData } from '@/types/tree'

/**
 * Background colors for person nodes based on biological sex
 * @type {Record<string, string>}
 */
const SEX_BG: Record<string, string> = {
  M: '#dbeafe', // Light blue for males
  F: '#fce7f3', // Light pink for females
}

/**
 * PersonNode component for React Flow
 *
 * Displays an individual person in the family tree visualization.
 * The node shows the person's name and their birth/death years if available.
 * The background color is determined by biological sex (blue for male, pink for female).
 *
 * @param {NodeProps<PersonData>} props - React Flow node properties
 * @param {PersonData} props.data - The person's data including name, sex, birth and death years
 * @returns {React.ReactNode} A styled div containing the person's information with React Flow handles
 */
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
