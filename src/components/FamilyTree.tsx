/**
 * @fileoverview Interactive family tree visualisation component.
 * Renders a ReactFlow canvas that fetches person/relationship data from the API,
 * applies a dagre hierarchical layout, and supports search, depth control,
 * node selection, and re-rooting the tree at any person.
 */

'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type React from 'react'
import { useSession, signIn } from 'next-auth/react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  getViewportForBounds,
  type Node,
  type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'

import PersonNode from '@/components/PersonNode'
import UnionNode from '@/components/UnionNode'
import SearchBar from '@/components/SearchBar'
import { applyDagreLayout } from '@/lib/layout'
import { formatLifespan } from '@/lib/person'
import type { TreeResponse, PersonData, PersonDetailResponse, PersonSummary } from '@/types/tree'
import { DEFAULT_HOPS, MIN_HOPS, MAX_HOPS, EDGE_STYLES, EDGE_TYPES, DEFAULT_ROOT_GEDCOM_ID } from '@/constants/tree'

/**
 * Minimal person summary used for the search bar and root selection.
 * @property gedcomId - GEDCOM identifier of the person
 * @property name - Display name of the person
 * @property sex - Biological sex code ('M', 'F', or null)
 * @property birthYear - Four-digit birth year string, or null if unknown
 * @property birthPlace - Free-text birth location, or null if unknown
 */
interface Person { gedcomId: string; name: string; sex: string | null; birthYear: string | null; birthPlace: string | null }

/** Map of custom node types for ReactFlow visualization. */
const nodeTypes = { person: PersonNode, union: UnionNode }

/** Default edge styling applied to all edges. */
const defaultEdgeStyle: React.CSSProperties = { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.5 }

/** Default configuration for all edges in the flow. */
const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
}

/**
 * Floating toolbar displaying tree statistics and depth control.
 * Shows ancestor/descendant counts and allows users to adjust the viewing depth (hops).
 *
 * @param {Object} props - Component props
 * @param {Node[]} props.nodes - All nodes in the current tree visualization
 * @param {string} props.rootName - Display name of the current root person
 * @param {number} props.hops - Current viewing depth (hops)
 * @param {Function} props.onHopsChange - Callback when user adjusts the depth slider
 * @returns {React.ReactElement | null} Rendered toolbar or null if no persons are visible
 */
export function Toolbar({
  nodes,
  rootName,
  hops,
  onHopsChange,
  sliderMax = MAX_HOPS,
}: {
  nodes: Node[]
  rootName: string
  hops: number
  onHopsChange: (hops: number) => void
  sliderMax?: number
}) {
  const ancestorGens = nodes.filter(n => n.type === 'person').map(n => (n.data as PersonData).generation).filter((g): g is number => typeof g === 'number' && g < 0)
  const ancestors = ancestorGens.length > 0 ? Math.abs(Math.min(...ancestorGens)) : 0
  const descendantGens = nodes.filter(n => n.type === 'person').map(n => (n.data as PersonData).generation).filter((g): g is number => typeof g === 'number' && g > 0)
  const descendants = descendantGens.length > 0 ? Math.max(...descendantGens) : 0
  const personCount = nodes.filter(n => n.type === 'person').length
  if (personCount === 0) return null
  return (
    <div
      data-testid="toolbar"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-4 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
    >
      <span data-testid="toolbar-person-count" className="text-xs text-white/60 select-none">
        <span className="text-white font-medium">{personCount}</span> people
      </span>
      <span data-testid="toolbar-gen-up" className="text-xs text-white/60 select-none">
        <span className="text-white font-medium">{ancestors}</span> gen up
      </span>
      <span data-testid="toolbar-gen-down" className="text-xs text-white/60 select-none">
        <span className="text-white font-medium">{descendants}</span> gen down
      </span>
      <span data-testid="toolbar-viewing" className="text-xs text-white/60 select-none">
        VIEWING: <span className="text-white font-medium">{rootName}</span>
      </span>
      <input
        type="range"
        data-testid="toolbar-depth-slider"
        min={MIN_HOPS}
        max={sliderMax}
        value={hops}
        onChange={e => onHopsChange(Number(e.target.value))}
        className="w-24"
        aria-label="Depth"
      />
    </div>
  )
}

/**
 * A list row displaying a person with clickable actions to select or re-root the tree.
 * Double-click to re-root, single-click to select. Shows name and birth year.
 *
 * @param {Object} props - Component props
 * @param {PersonSummary} props.person - Person to display
 * @param {Function} props.onSelect - Called with person's gedcomId on single click
 * @param {Function} props.onReroot - Called with person's gedcomId on double click or focus button
 * @param {boolean} [props.small=false] - Render in compact styling for nested lists
 * @returns {React.ReactElement} Rendered person row
 */
function RelativeRow({
  person,
  onSelect,
  onReroot,
  small = false,
}: {
  person: PersonSummary
  onSelect: (id: string) => void
  onReroot: (id: string) => void
  small?: boolean
}) {
  return (
    <div className="flex items-center group">
      <button
        className={`flex-1 text-left px-3 rounded-lg hover:bg-white/10 transition-colors ${small ? 'py-1.5 text-xs text-white/60 hover:text-white/80' : 'py-2 text-sm text-white/80 hover:text-white'}`}
        onClick={() => onSelect(person.gedcomId)}
        onDoubleClick={() => onReroot(person.gedcomId)}
      >
        <span className="font-medium">{person.name || 'Unknown'}</span>
        {person.birthYear && (
          <span className={`ml-2 text-xs ${small ? 'text-slate-600' : 'text-slate-500'}`}>{person.birthYear}</span>
        )}
      </button>
      <button
        data-testid="relative-focus"
        aria-label={`Focus tree on ${person.name || 'person'}`}
        onClick={() => onReroot(person.gedcomId)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 mr-1 rounded text-white/40 hover:text-indigo-400 hover:bg-white/10 flex-shrink-0"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="2" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      </button>
    </div>
  )
}

/**
 * A shared header/container for sub-views within the PersonDrawer.
 * Provides a back button and title for nested views like edit and add-relative modes.
 *
 * @param {Object} props - Component props
 * @param {string} props.title - Title to display in the header
 * @param {Function} props.onBack - Called when user clicks the back button
 * @param {React.ReactNode} props.children - Content to render below the header
 * @returns {React.ReactElement} Rendered drawer sub-view container
 */
function DrawerSubView({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div
      data-testid="drawer-sub-view"
      className="absolute top-0 right-0 h-full w-80 z-20 bg-[#0a1628]/90 backdrop-blur-xl border-l border-white/10 shadow-[-8px_0_32px_rgba(0,0,0,0.5)] flex flex-col"
    >
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
        <button
          onClick={onBack}
          aria-label="Back"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          ←
        </button>
        <h2 className="text-white font-semibold text-sm truncate flex-1">{title}</h2>
      </div>
      {children}
    </div>
  )
}

/**
 * Side drawer panel showing details for a selected person.
 * Fetches and displays name, dates, GEDCOM ID, and immediate relatives
 * (parents, siblings, marriages). Allows re-rooting or navigating to relatives.
 * When signed in, shows buttons to add relatives via search or create form.
 *
 * @param {PersonData} person - Person to display details for
 * @param {Function} onClose - Called when user closes the drawer
 * @param {Function} onReroot - Called with person's gedcomId to re-root the tree
 * @param {Function} onSelectPerson - Called with gedcomId to open another person's drawer
 * @param {Function} [onSelectRoot] - Called to refresh the tree after adding a relative
 */
export function PersonDrawer({
  person,
  onClose,
  onReroot,
  onSelectPerson,
  onSelectRoot,
}: {
  person: PersonData
  onClose: () => void
  onReroot: (id: string) => void
  onSelectPerson: (id: string) => void
  onSelectRoot?: (id: string) => void
}) {
  const { data: session, status } = useSession()
  const isSignedIn = status === 'authenticated'
  const isAdmin = session?.user?.role === 'admin'

  const dates = formatLifespan(person)
  const [detail, setDetail] = useState<PersonDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailVersion, setDetailVersion] = useState(0)

  const [mode, setMode] = useState<'view' | 'add-relative' | 'edit'>('view')

  const [editBirthPlace, setEditBirthPlace] = useState('')
  const [addRelativeType, setAddRelativeType] = useState<'parent' | 'spouse' | 'child'>('child')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Person[]>([])
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)

  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [newBirthYear, setNewBirthYear] = useState('')
  const [newSex, setNewSex] = useState('U')

  const [editGivenName, setEditGivenName] = useState('')
  const [editFamilyName, setEditFamilyName] = useState('')
  const [editSex, setEditSex] = useState('U')
  const [editBirthYear, setEditBirthYear] = useState('')
  const [editDiedYear, setEditDiedYear] = useState('')
  const [editDeathPlace, setEditDeathPlace] = useState('')
  const [editOccupation, setEditOccupation] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [showEditBirthPlace, setShowEditBirthPlace] = useState(false)
  const [showEditDiedYear, setShowEditDiedYear] = useState(false)
  const [showEditDeathPlace, setShowEditDeathPlace] = useState(false)
  const [showEditOccupation, setShowEditOccupation] = useState(false)
  const [showEditNotes, setShowEditNotes] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [suggestionSubmitted, setSuggestionSubmitted] = useState(false)
  const [pendingRemoveParentId, setPendingRemoveParentId] = useState<string | null>(null)

  const [myChanges, setMyChanges] = useState<{
    createChange: { id: string; changeType: string; targetId: string; newValue: Record<string, unknown>; appliedAt: string } | null
    relationshipChanges: Array<{ id: string; newValue: Record<string, unknown>; appliedAt: string }>
    updateChanges: Array<{ id: string; newValue: Record<string, unknown>; appliedAt: string }>
  } | null>(null)

  useEffect(() => {
    setDetail(null)
    setDetailLoading(true)
    const ctrl = new AbortController()
    let cancelled = false
    fetch(`/api/person/${encodeURIComponent(person.gedcomId)}`, { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<PersonDetailResponse>
      })
      .then(data => { if (!cancelled) setDetail(data) })
      .catch(err => {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Failed to fetch person detail', err)
        }
      })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true; ctrl.abort() }
  }, [person.gedcomId, detailVersion])

  useEffect(() => {
    setMyChanges(null)
    const ctrl = new AbortController()
    let cancelled = false
    fetch(`/api/person/${encodeURIComponent(person.gedcomId)}/my-changes`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return
        // Only accept responses that match the expected shape; guards against
        // unmocked test environments that might serve arbitrary JSON here.
        if (
          Array.isArray(data.relationshipChanges) &&
          Array.isArray(data.updateChanges) &&
          (data.createChange === null ||
            (typeof data.createChange === 'object' && typeof data.createChange.id === 'string'))
        ) {
          setMyChanges(data)
        }
      })
      .catch(err => {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Failed to fetch my-changes', err)
        }
      })
    return () => { cancelled = true; ctrl.abort() }
  }, [person.gedcomId, detailVersion])

  /**
   * Revert a change via POST /api/changes/[id]/revert.
   * Returns `{ ok: true }` on 2xx or `{ ok: false, detail }` on failure,
   * pulling a human-readable message from `conflictingChange.detail` or
   * `error` in the response body.
   */
  const revertChangeRequest = async (
    changeId: string
  ): Promise<{ ok: true } | { ok: false; detail: string }> => {
    const res = await fetch(`/api/changes/${encodeURIComponent(changeId)}/revert`, { method: 'POST' })
    if (res.ok) return { ok: true }
    const body = await res.json().catch(() => ({}))
    const detail = body?.conflictingChange?.detail ?? body?.error ?? 'Revert failed'
    return { ok: false, detail: String(detail) }
  }

  useEffect(() => {
    if (mode !== 'add-relative' || !searchQuery.trim()) {
      if (searchResults.length > 0) setSearchResults([])
      return
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (searchAbortRef.current) searchAbortRef.current.abort()
    searchTimerRef.current = setTimeout(() => {
      const abortCtrl = new AbortController()
      searchAbortRef.current = abortCtrl
      fetch(`/api/persons?q=${encodeURIComponent(searchQuery)}`, { signal: abortCtrl.signal })
        .then(r => r.ok ? r.json() as Promise<Person[]> : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(data => { if (!abortCtrl.signal.aborted) setSearchResults(data) })
        .catch(err => { if (err instanceof Error && err.name !== 'AbortError') console.error('Search failed', err) })
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      if (searchAbortRef.current) searchAbortRef.current.abort()
    }
  }, [searchQuery, mode])

  /** Clears all form state for adding a relative, preparing for a new add-relative flow. */
  const resetAddRelativeForm = () => {
    setSearchQuery('')
    setSearchResults([])
    setGivenName('')
    setFamilyName('')
    setNewBirthYear('')
    setNewSex('U')
  }

  /**
   * Opens the add-relative sub-view for the specified relationship type.
   * @param {string} type - Relationship type: 'parent', 'spouse', or 'child'
   */
  const openAddRelative = (type: 'parent' | 'spouse' | 'child') => {
    setAddRelativeType(type)
    resetAddRelativeForm()
    setActionError(null)
    setSuggestionSubmitted(false)
    setMode('add-relative')
  }

  /**
   * Links an existing person as a relative and returns to view mode.
   * Refreshes the person detail and parent drawer after successful link.
   * @param {Person} relative - The person to link as a relative
   */
  const handleSelectRelative = async (relative: Person) => {
    setIsSubmitting(true)
    try {
      if (addRelativeType === 'parent' && !isAdmin) {
        const res = await fetch('/api/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            changeType: 'ADD_RELATIONSHIP',
            payload: { type: 'parent', targetId: relative.gedcomId, childId: person.gedcomId },
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setSuggestionSubmitted(true)
        return
      }
      const res = await fetch(`/api/person/${encodeURIComponent(person.gedcomId)}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: relative.gedcomId, type: addRelativeType }),
      })
      if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`)
      resetAddRelativeForm()
      setMode('view')
      setDetailVersion(v => v + 1)
      onSelectRoot?.(person.gedcomId)
    } catch (err) {
      console.error('Failed to add relative', err)
      setActionError(addRelativeType === 'parent' && !isAdmin
        ? 'Failed to submit suggestion. Please try again.'
        : 'Failed to add relative. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Creates a new person and links them as a relative in a single operation.
   * Silently fails if no name is provided. Refreshes person detail on success.
   */
  const handleCreateAndLink = async () => {
    if (!givenName.trim() || !familyName.trim()) {
      setActionError('Both given name and family name are required.')
      return
    }
    const fullName = `${givenName.trim()} ${familyName.trim()}`
    setIsSubmitting(true)
    try {
      const createRes = await fetch('/api/persons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fullName, sex: newSex || null, birthYear: newBirthYear || null }),
      })
      if (!createRes.ok) throw new Error(`HTTP ${createRes.status}`)
      const newPerson = await createRes.json() as Person
      const linkRes = await fetch(`/api/person/${encodeURIComponent(person.gedcomId)}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: newPerson.gedcomId, type: addRelativeType }),
      })
      if (!linkRes.ok && linkRes.status !== 409) throw new Error(`HTTP ${linkRes.status}`)
      resetAddRelativeForm()
      setMode('view')
      setDetailVersion(v => v + 1)
      onSelectRoot?.(person.gedcomId)
    } catch (err) {
      console.error('Failed to create and link relative', err)
      setActionError('Failed to create and link person. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * True when the detail record has direct edges (parents or marriages) on the Person
   * node. Used to disable the delete-person button because a `CREATE_PERSON` revert is
   * only safe when the Person has no UNION/CHILD edges. Siblings are intentionally
   * omitted: they are derived from shared parents, not direct edges on this node, so
   * they don't block `DETACH DELETE`. The server guard (edge count on the node) is the
   * source of truth; this local check just pre-disables for obvious cases.
   */
  const detailHasRelationships = !!(
    detail && (detail.parents.length > 0 || detail.marriages.length > 0)
  )

  /**
   * Deletes the current person by reverting the author's CREATE_PERSON change.
   * Only callable when `myChanges.createChange` is present (caller enforces button visibility).
   * Prompts for confirmation, then on success closes the drawer and refreshes the tree.
   * On 409 surfaces the server's conflict detail inline via `actionError`.
   */
  const handleDeletePerson = async () => {
    if (isSubmitting) return
    if (!myChanges?.createChange) return
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${person.name || 'this person'}? This cannot be undone.`)) return
    setIsSubmitting(true)
    try {
      const result = await revertChangeRequest(myChanges.createChange.id)
      if (result.ok) {
        setMyChanges(null)
        onSelectRoot?.(person.gedcomId) // nudges tree refetch in the parent canvas
        onClose()
      } else {
        setActionError(result.detail)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Removes a marriage/union by reverting the author's ADD_RELATIONSHIP change for it.
   * On success, bumps `detailVersion` so both the person detail and `my-changes`
   * re-fetch (the marriage disappears from the list). On 409 surfaces the detail
   * inline via `actionError`.
   * @param {string} changeId - id of the `ADD_RELATIONSHIP` Change to revert
   */
  const handleRemoveMarriage = async (changeId: string) => {
    if (isSubmitting) return
    if (typeof window !== 'undefined' && !window.confirm('Remove this marriage? This cannot be undone.')) return
    setIsSubmitting(true)
    try {
      const result = await revertChangeRequest(changeId)
      if (result.ok) {
        onSelectRoot?.(person.gedcomId)
        setDetailVersion(v => v + 1)
      } else {
        setActionError(result.detail)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Reverts an `ADD_RELATIONSHIP` change of `type: 'parent'`, removing the
   * Union node and its UNION/CHILD edges. Bumps `detailVersion` so the drawer
   * refetches detail and `my-changes`. On 409 surfaces the detail inline.
   */
  const handleRemoveParent = async (changeId: string) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await revertChangeRequest(changeId)
      if (result.ok) {
        onSelectRoot?.(person.gedcomId)
        setDetailVersion(v => v + 1)
      } else {
        setActionError(result.detail)
      }
    } finally {
      setIsSubmitting(false)
      setPendingRemoveParentId(null)
    }
  }

  /**
   * Reverts one of this author's UPDATE_PERSON changes on this person.
   * On success, bumps `detailVersion` so the "Your edits" list shrinks and the
   * person detail reflects the restored previousValue. On 409 surfaces the detail
   * inline via `actionError`.
   * @param {string} changeId - id of the `UPDATE_PERSON` Change to revert
   */
  const handleRevertEdit = async (changeId: string) => {
    if (isSubmitting) return
    if (typeof window !== 'undefined' && !window.confirm('Revert this edit? The previous values will be restored.')) return
    setIsSubmitting(true)
    try {
      const result = await revertChangeRequest(changeId)
      if (result.ok) {
        onSelectRoot?.(person.gedcomId)
        setDetailVersion(v => v + 1)
      } else {
        setActionError(result.detail)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  /** Opens the edit sub-view, initializing all edit fields from current person/detail. */
  const openEdit = () => {
    setEditGivenName(person.givenName ?? '')
    setEditFamilyName(person.surname ?? '')
    setEditSex(person.sex ?? 'U')
    setEditBirthYear(person.birthYear ?? '')
    setEditBirthPlace(detail?.birthPlace ?? '')
    setEditDiedYear(person.deathYear ?? '')
    setEditDeathPlace(person.deathPlace ?? '')
    setEditOccupation(person.occupation ?? '')
    setEditNotes(person.notes ?? '')
    setShowEditBirthPlace(!!(detail?.birthPlace))
    setShowEditDiedYear(!!(person.deathYear))
    setShowEditDeathPlace(!!(person.deathPlace))
    setShowEditOccupation(!!(person.occupation))
    setShowEditNotes(!!(person.notes))
    setActionError(null)
    setMode('edit')
  }

  /** Discards pending edits and returns to view mode. */
  const handleCancelEdit = () => {
    setEditGivenName(person.givenName ?? '')
    setEditFamilyName(person.surname ?? '')
    setEditSex(person.sex ?? 'U')
    setEditBirthYear(person.birthYear ?? '')
    setEditBirthPlace(detail?.birthPlace ?? '')
    setEditDiedYear(person.deathYear ?? '')
    setEditDeathPlace(person.deathPlace ?? '')
    setEditOccupation(person.occupation ?? '')
    setEditNotes(person.notes ?? '')
    setShowEditBirthPlace(!!(detail?.birthPlace))
    setShowEditDiedYear(!!(person.deathYear))
    setShowEditDeathPlace(!!(person.deathPlace))
    setShowEditOccupation(!!(person.occupation))
    setShowEditNotes(!!(person.notes))
    setActionError(null)
    setMode('view')
  }

  /**
   * PATCHes the person record with the current edit-form values and returns to view mode.
   * Increments `detailVersion` to trigger a re-fetch of the updated person detail.
   */
  const handleSaveEdit = async () => {
    try {
      const res = await fetch(`/api/person/${encodeURIComponent(person.gedcomId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: [editGivenName.trim(), editFamilyName.trim()].filter(Boolean).join(' ') || null,
          sex: editSex,
          birthYear: editBirthYear.trim() || null,
          birthPlace: showEditBirthPlace ? (editBirthPlace.trim() || null) : null,
          deathYear: showEditDiedYear ? (editDiedYear.trim() || null) : null,
          deathPlace: showEditDeathPlace ? (editDeathPlace.trim() || null) : null,
          occupation: showEditOccupation ? (editOccupation.trim() || null) : null,
          notes: showEditNotes ? (editNotes.trim() || null) : null,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMode('view')
      setDetailVersion(v => v + 1)
    } catch (err) {
      console.error('Failed to save edit', err)
      setActionError('Failed to save changes. Please try again.')
    }
  }

  const handleSuggestChange = async () => {
    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changeType: 'UPDATE_PERSON',
          payload: {
            targetId: person.gedcomId,
            name: [editGivenName.trim(), editFamilyName.trim()].filter(Boolean).join(' ') || null,
            sex: editSex,
            birthYear: editBirthYear.trim() || null,
            birthPlace: showEditBirthPlace ? (editBirthPlace.trim() || null) : null,
            deathYear: showEditDiedYear ? (editDiedYear.trim() || null) : null,
            deathPlace: showEditDeathPlace ? (editDeathPlace.trim() || null) : null,
            occupation: showEditOccupation ? (editOccupation.trim() || null) : null,
            notes: showEditNotes ? (editNotes.trim() || null) : null,
          },
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMode('view')
    } catch (err) {
      console.error('Failed to submit suggestion', err)
      setActionError('Failed to submit suggestion. Please try again.')
    }
  }

  if (mode === 'edit') {
    return (
      <DrawerSubView title={`Edit ${person.name || 'person'}`} onBack={() => setMode('view')}>
        <div
          data-testid="person-drawer-edit-form"
          className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
        >
          <div>
            <label htmlFor="edit-given-name" className="text-xs text-slate-400 block mb-1">Given name</label>
            <input
              id="edit-given-name"
              type="text"
              value={editGivenName}
              onChange={e => setEditGivenName(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label htmlFor="edit-family-name" className="text-xs text-slate-400 block mb-1">Family name</label>
            <input
              id="edit-family-name"
              type="text"
              value={editFamilyName}
              onChange={e => setEditFamilyName(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">Sex</p>
            <div className="flex gap-2">
              {(['M', 'F', 'U'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setEditSex(s)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${editSex === s ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}
                >
                  {s === 'M' ? 'Male' : s === 'F' ? 'Female' : 'Unknown'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="edit-birth-year" className="text-xs text-slate-400 block mb-1">Born year</label>
            <input
              id="edit-birth-year"
              type="text"
              value={editBirthYear}
              onChange={e => setEditBirthYear(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
            />
          </div>
          {showEditBirthPlace ? (
            <div>
              <label htmlFor="edit-birth-place" className="text-xs text-slate-400 block mb-1">Birth place</label>
              <input
                id="edit-birth-place"
                type="text"
                value={editBirthPlace}
                onChange={e => setEditBirthPlace(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setShowEditBirthPlace(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              + Add birth place
            </button>
          )}
          {showEditDiedYear ? (
            <div>
              <label htmlFor="edit-died-year" className="text-xs text-slate-400 block mb-1">Died year</label>
              <input
                id="edit-died-year"
                type="text"
                value={editDiedYear}
                onChange={e => setEditDiedYear(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setShowEditDiedYear(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              + Add died year
            </button>
          )}
          {showEditDeathPlace ? (
            <div>
              <label htmlFor="edit-death-place" className="text-xs text-slate-400 block mb-1">Death place</label>
              <input
                id="edit-death-place"
                type="text"
                value={editDeathPlace}
                onChange={e => setEditDeathPlace(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setShowEditDeathPlace(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              + Add death place
            </button>
          )}
          {showEditOccupation ? (
            <div>
              <label htmlFor="edit-occupation" className="text-xs text-slate-400 block mb-1">Occupation</label>
              <input
                id="edit-occupation"
                type="text"
                value={editOccupation}
                onChange={e => setEditOccupation(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setShowEditOccupation(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              + Add occupation
            </button>
          )}
          {showEditNotes ? (
            <div>
              <label htmlFor="edit-notes" className="text-xs text-slate-400 block mb-1">Notes</label>
              <textarea
                id="edit-notes"
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400 resize-none"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setShowEditNotes(true)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              + Add notes
            </button>
          )}
          {myChanges && myChanges.updateChanges.length > 0 && (
            <section
              data-testid="person-drawer-your-edits"
              className="pt-3 mt-3 border-t border-white/10 space-y-2"
            >
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Your edits to this person
              </h3>
              <ul className="space-y-2">
                {myChanges.updateChanges.map(c => (
                  <li
                    key={c.id}
                    data-testid={`your-edit-${c.id}`}
                    className="flex items-center gap-2 text-xs text-white/70"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="block truncate text-white/80">
                        {Object.keys(c.newValue).join(', ') || '(no fields)'}
                      </span>
                      <time className="block text-[10px] text-slate-500">
                        {new Date(c.appliedAt).toISOString()}
                      </time>
                    </div>
                    <button
                      type="button"
                      data-testid={`your-edit-revert-${c.id}`}
                      onClick={() => handleRevertEdit(c.id)}
                      disabled={isSubmitting}
                      className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Revert
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {actionError && (
            <p data-testid="person-drawer-edit-action-error" className="text-red-400 text-xs">{actionError}</p>
          )}
          <div className="flex gap-2">
            <button
              data-testid="person-drawer-cancel"
              onClick={handleCancelEdit}
              className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            {isAdmin ? (
              <button
                onClick={handleSaveEdit}
                className="flex-1 py-2 rounded-xl bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
              >
                Save change
              </button>
            ) : (
              <button
                data-testid="suggest-change"
                onClick={handleSuggestChange}
                className="flex-1 py-2 rounded-xl bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
              >
                Suggest this change
              </button>
            )}
          </div>
        </div>
      </DrawerSubView>
    )
  }

  if (mode === 'add-relative') {
    if (suggestionSubmitted) {
      return (
        <DrawerSubView title={`Add a ${addRelativeType} for ${person.name || 'person'}`} onBack={() => { setSuggestionSubmitted(false); setMode('view') }}>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <p
              data-testid="suggestion-submitted"
              className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2"
            >
              Suggestion submitted
            </p>
            <p className="text-xs text-slate-400">
              An admin will review your suggestion before it appears on the tree.
            </p>
            <button
              onClick={() => { setSuggestionSubmitted(false); setMode('view') }}
              className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </DrawerSubView>
      )
    }
    return (
      <DrawerSubView title={`Add a ${addRelativeType} for ${person.name || 'person'}`} onBack={() => setMode('view')}>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <input
              data-testid="add-relative-search"
              type="text"
              placeholder={`Search for a ${addRelativeType}…`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
            />
            {searchResults.length > 0 && (
              <ul className="mt-2 space-y-1">
                {searchResults.map(p => (
                  <li key={p.gedcomId}>
                    <button
                      onClick={() => handleSelectRelative(p)}
                      disabled={isSubmitting}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-white/80 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="font-medium">{p.name || 'Unknown'}</span>
                      {p.birthYear && <span className="ml-2 text-xs text-slate-500">{p.birthYear}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <hr className="border-white/10" />

          <div className="space-y-3">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Or create new</p>
            <div className="space-y-2">
              <div>
                <label htmlFor="create-given-name" className="text-xs text-slate-400 block mb-1">Given name</label>
                <input
                  id="create-given-name"
                  type="text"
                  value={givenName}
                  onChange={e => setGivenName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label htmlFor="create-family-name" className="text-xs text-slate-400 block mb-1">Family name</label>
                <input
                  id="create-family-name"
                  type="text"
                  value={familyName}
                  onChange={e => setFamilyName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label htmlFor="create-birth-year" className="text-xs text-slate-400 block mb-1">Birth year</label>
                <input
                  id="create-birth-year"
                  type="text"
                  value={newBirthYear}
                  onChange={e => setNewBirthYear(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label htmlFor="create-sex" className="text-xs text-slate-400 block mb-1">Sex</label>
                <select
                  id="create-sex"
                  value={newSex}
                  onChange={e => setNewSex(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-[#0a1628] border border-white/20 text-white text-sm focus:outline-none focus:border-indigo-400"
                >
                  <option value="U">Unknown</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>
            </div>
            {actionError && (
              <p className="text-red-400 text-xs">{actionError}</p>
            )}
            <button
              onClick={handleCreateAndLink}
              disabled={isSubmitting}
              className="w-full py-2 rounded-xl bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save change
            </button>
          </div>
        </div>
      </DrawerSubView>
    )
  }

  return (
    <div
      data-testid="person-drawer"
      className="absolute top-0 right-0 h-full w-80 z-20 bg-[#0a1628]/90 backdrop-blur-xl border-l border-white/10 shadow-[-8px_0_32px_rgba(0,0,0,0.5)] flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <h2 className="text-white font-semibold text-base truncate flex-1 mr-2">
          {person.name || <span className="text-slate-500 italic">Unknown</span>}
        </h2>
        {isSignedIn && (
          <button
            data-testid="person-drawer-edit"
            onClick={openEdit}
            aria-label="Edit person"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors mr-1"
          >
            ✎
          </button>
        )}
        <button
          data-testid="person-drawer-close"
          onClick={onClose}
          aria-label="Close panel"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {dates && (
          <p className="text-slate-400 text-sm">{dates}</p>
        )}
        <p className="text-slate-500 text-xs font-mono">{person.gedcomId}</p>

        {detailLoading && (
          <div className="flex items-center justify-center py-6">
            <div
              className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"
              aria-label="Loading"
            />
          </div>
        )}

        {detail && (
          <>
            {detail.birthPlace && (
              <p className="text-slate-400 text-xs">Born: {detail.birthPlace}</p>
            )}

            <section data-testid="person-drawer-parents">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Parents</h3>
              {detail.parents.length === 0 ? (
                <p className="text-slate-600 text-xs italic">None recorded</p>
              ) : (
                <ul className="space-y-1">
                  {detail.parents.map(p => {
                    const removableChange = myChanges?.relationshipChanges?.find(
                      c => c.newValue.type === 'parent' && c.newValue.targetId === p.gedcomId
                    )
                    return (
                      <li key={p.gedcomId} className="flex items-center gap-1">
                        <div className="flex-1 min-w-0">
                          <RelativeRow person={p} onSelect={onSelectPerson} onReroot={onReroot} />
                        </div>
                        {removableChange && pendingRemoveParentId !== removableChange.id && (
                          <button
                            type="button"
                            data-testid={`parent-remove-${p.gedcomId}`}
                            aria-label="Remove parent"
                            title="Remove parent"
                            onClick={() => setPendingRemoveParentId(removableChange.id)}
                            disabled={isSubmitting}
                            className="w-6 h-6 flex items-center justify-center rounded-lg text-white/40 hover:text-red-400 hover:bg-white/10 transition-colors text-sm leading-none flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            ×
                          </button>
                        )}
                        {removableChange && pendingRemoveParentId === removableChange.id && (
                          <div className="flex items-center gap-1 flex-shrink-0" role="group" aria-label="Confirm remove parent">
                            <span className="text-xs text-slate-400">Remove?</span>
                            <button
                              type="button"
                              data-testid={`parent-remove-confirm-${p.gedcomId}`}
                              aria-label="Confirm remove parent"
                              onClick={() => handleRemoveParent(removableChange.id)}
                              disabled={isSubmitting}
                              className="px-2 h-6 flex items-center justify-center rounded-lg bg-red-500/80 hover:bg-red-500 text-white transition-colors text-xs leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              data-testid={`parent-remove-cancel-${p.gedcomId}`}
                              aria-label="Cancel remove parent"
                              onClick={() => setPendingRemoveParentId(null)}
                              disabled={isSubmitting}
                              className="px-2 h-6 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white/80 transition-colors text-xs leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              No
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {isSignedIn && (
                <button
                  onClick={() => openAddRelative('parent')}
                  className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  + Add parent
                </button>
              )}
            </section>

            <section data-testid="person-drawer-siblings">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Siblings</h3>
              {detail.siblings.length === 0 ? (
                <p className="text-slate-600 text-xs italic">None recorded</p>
              ) : (
                <ul className="space-y-1">
                  {detail.siblings.map(s => <li key={s.gedcomId}><RelativeRow person={s} onSelect={onSelectPerson} onReroot={onReroot} /></li>)}
                </ul>
              )}
            </section>

            <section data-testid="person-drawer-marriages">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Marriages</h3>
              {detail.marriages.length === 0 ? (
                <p className="text-slate-600 text-xs italic">None recorded</p>
              ) : (
                <ul className="space-y-3">
                  {detail.marriages.map(m => {
                    const removableChange = myChanges?.relationshipChanges?.find(
                      c => c.newValue.unionId === m.unionId
                    )
                    return (
                      <li key={m.unionId} className="space-y-1">
                        <div className="flex items-center gap-1">
                          <div className="flex-1 min-w-0">
                            {m.spouse && <RelativeRow person={m.spouse} onSelect={onSelectPerson} onReroot={onReroot} />}
                          </div>
                          {removableChange && (
                            <button
                              type="button"
                              data-testid={`marriage-remove-${m.unionId}`}
                              aria-label="Remove marriage"
                              title="Remove marriage"
                              onClick={() => handleRemoveMarriage(removableChange.id)}
                              disabled={isSubmitting}
                              className="w-6 h-6 flex items-center justify-center rounded-lg text-white/40 hover:text-red-400 hover:bg-white/10 transition-colors text-sm leading-none flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        {m.children.length > 0 && (
                          <ul className="pl-4 space-y-1">
                            {m.children.map(c => <li key={c.gedcomId}><RelativeRow person={c} onSelect={onSelectPerson} onReroot={onReroot} small /></li>)}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {isSignedIn && (
                <div className="mt-2 flex gap-3">
                  <button
                    onClick={() => openAddRelative('spouse')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    + Add spouse
                  </button>
                  <button
                    onClick={() => openAddRelative('child')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    + Add child
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Footer – re-root action + unauthenticated CTA */}
      <div className="px-5 py-4 border-t border-white/10 space-y-2">
        <button
          data-testid="person-drawer-reroot"
          onClick={() => { onReroot(person.gedcomId); onClose() }}
          className="w-full py-2 rounded-xl bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors uppercase tracking-wide"
        >
          FOCUS TREE ON {(person.name || 'PERSON').toUpperCase()}
        </button>
        {myChanges?.createChange && (
          <button
            data-testid="person-drawer-delete"
            onClick={handleDeletePerson}
            disabled={detailHasRelationships || isSubmitting}
            title={detailHasRelationships ? 'Has relationships — contact an admin' : undefined}
            aria-label={`Delete ${person.name || 'person'}`}
            className="w-full py-2 rounded-xl bg-red-500/80 hover:bg-red-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-500/80"
          >
            Delete this person
          </button>
        )}
        {actionError && (
          <p data-testid="person-drawer-action-error" className="text-red-400 text-xs">{actionError}</p>
        )}
        {!isSignedIn && (
          <button
            onClick={() => signIn('google')}
            className="w-full py-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors text-center"
          >
            Sign in to suggest edits
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Main canvas for rendering the family tree using ReactFlow.
 * Fetches tree data from API, applies hierarchical layout, and handles user interactions
 * (node selection, depth adjustment, pan/zoom).
 *
 * @param {string} rootId - GEDCOM ID of the tree root person
 * @param {Function} onSelectRoot - Called when user selects a new root person
 * @param {Person[]} persons - Available people for search/selection
 */
function FlowCanvas({
  rootId,
  onSelectRoot,
  persons,
}: {
  rootId: string
  onSelectRoot: (id: string) => void
  persons: Person[]
}) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [treeBounds, setTreeBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hops, setHops] = useState(DEFAULT_HOPS)
  const [actualMaxDepth, setActualMaxDepth] = useState<number>(MAX_HOPS)
  const [selectedPerson, setSelectedPerson] = useState<PersonData | null>(null)
  const { setViewport } = useReactFlow()
  const abortRef = useRef<AbortController | null>(null)

  /** Display name of the current root person, derived from `nodes` and `rootId`. */
  const rootName = useMemo(() => {
    const rootNode = nodes.find(n => n.type === 'person' && (n.data as PersonData).gedcomId === rootId)
    return rootNode ? (rootNode.data as PersonData).name ?? '' : ''
  }, [nodes, rootId])

  /**
   * Opens the person drawer when a person node is clicked.
   *
   * @param _event - Unused mouse event from ReactFlow
   * @param node - The clicked ReactFlow node
   */
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type === 'person') {
      setSelectedPerson(node.data as PersonData)
    }
  }, [])

  /**
   * Fetches tree data for the current `rootId` and `hops` depth, applies dagre
   * layout, and updates the node/edge state. Aborts any in-flight request first.
   */
  const fetchTree = useCallback(async () => {
    if (!rootId) return
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/tree/${rootId}?hops=${hops}`, { signal: abortRef.current.signal })
      if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`)
      const data: TreeResponse = await res.json()

      const rawNodes: Node[] = data.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        data: n.type === 'person'
          ? { ...n.data, isRoot: (n.data as PersonData).gedcomId === rootId }
          : n.data,
        position: n.position,
      }))

      const rawEdges: Edge[] = data.edges.map((e) => {
        const isChild = e.label === EDGE_TYPES.CHILD
        return {
          id: e.id,
          source: isChild ? e.target : e.source,
          target: isChild ? e.source : e.target,
          style: EDGE_STYLES[e.label] ?? defaultEdgeStyle,
          data: { relType: e.label },
        }
      })

      const laid = applyDagreLayout(rawNodes, rawEdges, { rootId })
      setNodes(laid.nodes)
      const laidPersonGens = laid.nodes
        .filter(n => n.type === 'person')
        .map(n => (n.data as PersonData).generation)
        .filter((g): g is number => typeof g === 'number')
      const laidAncestorGens = laidPersonGens.filter(g => g < 0)
      const laidDescendantGens = laidPersonGens.filter(g => g > 0)
      setActualMaxDepth(Math.max(
        1,
        laidAncestorGens.length > 0 ? Math.abs(Math.min(...laidAncestorGens)) : 0,
        laidDescendantGens.length > 0 ? Math.max(...laidDescendantGens) : 0,
      ))
      setEdges(laid.edges)
      setTreeBounds(laid.bounds)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [rootId, hops])

  /** Re-fetches the tree whenever `rootId` or `hops` changes. */
  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  /**
   * Fits the viewport to the tree bounds after layout completes.
   * Falls back to centering on the root node when the tree is too large to fit at MIN_ZOOM.
   */
  useEffect(() => {
    if (!treeBounds || nodes.length === 0) return
    const id = setTimeout(() => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const PADDING = 0.15
      const MIN_ZOOM = 0.18

      const idealZoom = Math.min(
        (vw * (1 - 2 * PADDING)) / treeBounds.width,
        (vh * (1 - 2 * PADDING)) / treeBounds.height,
      )

      if (idealZoom >= MIN_ZOOM) {
        setViewport(getViewportForBounds(treeBounds, vw, vh, MIN_ZOOM, 2, PADDING), { duration: 300 })
      } else {
        const rootNode = nodes.find(
          n => n.type === 'person' && (n.data as PersonData).gedcomId === rootId
        )
        if (rootNode) {
          setViewport({
            zoom: MIN_ZOOM,
            x: vw / 2 - (rootNode.position.x + 80) * MIN_ZOOM,
            y: vh / 2 - (rootNode.position.y + 34) * MIN_ZOOM,
          }, { duration: 300 })
        }
      }
    }, 50)
    return () => clearTimeout(id)
  }, [treeBounds, nodes, rootId, setViewport])

  return (
    <>
      <SearchBar onSelect={onSelectRoot} persons={persons} />
      <Toolbar
        nodes={nodes}
        rootName={rootName}
        hops={hops}
        onHopsChange={setHops}
        sliderMax={actualMaxDepth}
      />
      {/* Loading/error overlays — ReactFlow stays mounted so its viewport is always initialized */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 z-10 pointer-events-none">
          Loading family tree…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400 z-10 pointer-events-none">
          {error}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
      >
        <Background variant={BackgroundVariant.Dots} color="#1e2a4a" gap={28} size={1} />
        <MiniMap
          style={{ background: '#0f172a' }}
          nodeColor="#6366f1"
          maskColor="rgba(0,0,0,0.6)"
        />
        <Controls />
      </ReactFlow>
      {selectedPerson && (
        <PersonDrawer
          person={selectedPerson}
          onClose={() => setSelectedPerson(null)}
          onReroot={(id) => { onSelectRoot(id); setSelectedPerson(null) }}
          onSelectPerson={(id) => {
            const node = nodes.find(n => n.type === 'person' && (n.data as PersonData).gedcomId === id)
            if (node) {
              setSelectedPerson(node.data as PersonData)
            } else {
              // Person may not be in the current tree view — create minimal stub so drawer can fetch detail
              setSelectedPerson({ gedcomId: id, name: '', sex: 'U', birthYear: null, deathYear: null, birthPlace: null, deathPlace: null, occupation: null, notes: null })
            }
          }}
          onSelectRoot={onSelectRoot}
        />
      )}
    </>
  )
}

const TREE_ROOT_STORAGE_KEY = 'family-tree-root-id'

/**
 * Root component for the interactive family tree visualization.
 * Fetches available people and renders the tree canvas with search and navigation.
 * Persists the selected root person in localStorage for session continuity.
 *
 * @returns {React.ReactElement} Rendered family tree canvas with provider and error handling
 */
export default function FamilyTree() {
  const [rootId, setRootId] = useState('')
  const [persons, setPersons] = useState<Person[]>([])
  const [personsError, setPersonsError] = useState<string | null>(null)

  /**
   * Updates the active root person and persists the selection to localStorage
   * so the same person is shown on next page load.
   * @param {string} id - GEDCOM ID of the newly selected root person
   */
  const handleSelectRoot = (id: string) => {
    setRootId(id)
    if (typeof window !== 'undefined') {
      localStorage.setItem(TREE_ROOT_STORAGE_KEY, id)
    }
  }

  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/persons', { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Person[]) => {
        setPersons(data)
        const storedId = typeof window !== 'undefined' ? localStorage.getItem(TREE_ROOT_STORAGE_KEY) : null
        const storedPerson = storedId ? data.find(p => p.gedcomId === storedId) : null
        const defaultPerson = storedPerson ?? data.find(p => p.gedcomId === DEFAULT_ROOT_GEDCOM_ID) ?? data.find(p => p.name?.trim()) ?? data[0]
        if (defaultPerson) setRootId(defaultPerson.gedcomId)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        console.error('Failed to load persons', err)
        setPersonsError('Could not load family members. Please check your database connection and refresh.')
      })
    return () => ctrl.abort()
  }, [])

  if (personsError) {
    return (
      <div className="relative w-screen h-screen bg-[#050a18] flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-md border border-red-400/30 rounded-2xl p-6 max-w-sm text-center shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <p className="text-red-300 text-sm">{personsError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-screen h-screen bg-[#050a18]">
      <ReactFlowProvider>
        <FlowCanvas rootId={rootId} onSelectRoot={handleSelectRoot} persons={persons} />
      </ReactFlowProvider>
    </div>
  )
}
