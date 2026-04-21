/**
 * @fileoverview Home page component for the genealogical database application.
 * This is the main entry point that renders the FamilyTree visualization.
 */

'use client'
import FamilyTree from '@/components/FamilyTree'

/**
 * Home page component
 *
 * Renders the genealogical database interface with the family tree visualization.
 * This is a client component to support interactive features in the family tree.
 *
 * @returns {React.ReactNode} The home page containing the FamilyTree component
 */
export default function Home() {
  return <FamilyTree />
}
