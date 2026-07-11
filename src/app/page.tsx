/**
 * @fileoverview Home page component for the genealogical database application.
 * This is the main entry point that renders the FamilyTree visualization.
 */

'use client'
import { Suspense } from 'react'
import FamilyTree from '@/components/FamilyTree'

/**
 * Home page component
 *
 * Renders the genealogical database interface with the family tree visualization.
 * This is a client component to support interactive features in the family tree.
 * Wrapped in `Suspense` because `FamilyTree` reads `useSearchParams()` to resolve
 * deep-linked viewer state, which otherwise opts the whole page out of prerendering.
 *
 * @returns {React.ReactNode} The home page containing the FamilyTree component
 */
export default function Home() {
  return (
    <Suspense fallback={<div className="relative w-screen h-screen bg-[#050a18]" />}>
      <FamilyTree />
    </Suspense>
  )
}
