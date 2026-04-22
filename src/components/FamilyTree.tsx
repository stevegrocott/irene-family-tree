/**
 * @fileoverview Interactive family tree visualisation component.
 * Renders a ReactFlow canvas that fetches person/relationship data from the API,
 * applies a dagre hierarchical layout, and supports search, depth control,
 * node selection, and re-rooting the tree at any person.
 */

'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type React from 'react'
import { useSession } from 'next-auth/react'
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
      <span data-testid="toolbar-ancestors" className="text-xs text-white/60 select-none">
        <span className="text-white font-medium">{ancestors}</span> ancestors
      </span>
      <span data-testid="toolbar-descendants" className="text-xs text-white/60 select-none">
        <span className="text-white font-medium">{descendants}</span> descendants
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
  const { status } = useSession()
  const isSignedIn = status === 'authenticated'

  const dates = formatLifespan(person)
  const [detail, setDetail] = useState<PersonDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailVersion, setDetailVersion] = useState(0)

  const [mode, setMode] = useState<'view' | 'add-relative'>('view')
  const [addRelativeType, setAddRelativeType] = useState<'parent' | 'spouse' | 'child'>('child')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Person[]>([])
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [newBirthYear, setNewBirthYear] = useState('')
  const [newSex, setNewSex] = useState('U')

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
    if (mode !== 'add-relative' || !searchQuery.trim()) {
      setSearchResults([])
      return
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      fetch(`/api/persons?q=${encodeURIComponent(searchQuery)}`)
        .then(r => r.ok ? r.json() as Promise<Person[]> : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(data => setSearchResults(data))
        .catch(err => console.error('Search failed', err))
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery, mode])

  const openAddRelative = (type: 'parent' | 'spouse' | 'child') => {
    setAddRelativeType(type)
    setSearchQuery('')
    setSearchResults([])
    setGivenName('')
    setFamilyName('')
    setNewBirthYear('')
    setNewSex('U')
    setMode('add-relative')
  }

  const handleSelectRelative = async (relative: Person) => {
    try {
      const res = await fetch(`/api/person/${encodeURIComponent(person.gedcomId)}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: relative.gedcomId, type: addRelativeType }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMode('view')
      setSearchQuery('')
      setSearchResults([])
      setDetailVersion(v => v + 1)
      onSelectRoot?.(person.gedcomId)
    } catch (err) {
      console.error('Failed to add relative', err)
    }
  }

  const handleCreateAndLink = async () => {
    const fullName = [givenName.trim(), familyName.trim()].filter(Boolean).join(' ')
    if (!fullName) return
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
      if (!linkRes.ok) throw new Error(`HTTP ${linkRes.status}`)
      setMode('view')
      setGivenName('')
      setFamilyName('')
      setNewBirthYear('')
      setNewSex('U')
      setDetailVersion(v => v + 1)
      onSelectRoot?.(person.gedcomId)
    } catch (err) {
      console.error('Failed to create and link relative', err)
    }
  }

  const relativeTypeLabel = addRelativeType === 'parent' ? 'parent' : addRelativeType === 'spouse' ? 'spouse' : 'child'

  if (mode === 'add-relative') {
    return (
      <div
        data-testid="person-drawer"
        className="absolute top-0 right-0 h-full w-80 z-20 bg-[#0a1628]/90 backdrop-blur-xl border-l border-white/10 shadow-[-8px_0_32px_rgba(0,0,0,0.5)] flex flex-col"
      >
        {/* Sub-view header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
          <button
            onClick={() => setMode('view')}
            aria-label="Back"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            ←
          </button>
          <h2 className="text-white font-semibold text-sm truncate flex-1">
            Add a {relativeTypeLabel} for {person.name || 'person'}
          </h2>
        </div>

        {/* Sub-view body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <input
              data-testid="add-relative-search"
              type="text"
              placeholder={`Search for a ${relativeTypeLabel}…`}
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
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-white/80 hover:bg-white/10 transition-colors"
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
                <label className="text-xs text-slate-400 block mb-1">Given name</label>
                <input
                  type="text"
                  value={givenName}
                  onChange={e => setGivenName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Family name</label>
                <input
                  type="text"
                  value={familyName}
                  onChange={e => setFamilyName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Birth year</label>
                <input
                  type="text"
                  value={newBirthYear}
                  onChange={e => setNewBirthYear(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder-white/40 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Sex</label>
                <select
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
            <button
              onClick={handleCreateAndLink}
              className="w-full py-2 rounded-xl bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              Save change
            </button>
          </div>
        </div>
      </div>
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
            <section data-testid="person-drawer-parents">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Parents</h3>
              {detail.parents.length === 0 ? (
                <p className="text-slate-600 text-xs italic">None recorded</p>
              ) : (
                <ul className="space-y-1">
                  {detail.parents.map(p => <li key={p.gedcomId}><RelativeRow person={p} onSelect={onSelectPerson} onReroot={onReroot} /></li>)}
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
                  {detail.marriages.map(m => (
                    <li key={m.unionId} className="space-y-1">
                      {m.spouse && <RelativeRow person={m.spouse} onSelect={onSelectPerson} onReroot={onReroot} />}
                      {m.children.length > 0 && (
                        <ul className="pl-4 space-y-1">
                          {m.children.map(c => <li key={c.gedcomId}><RelativeRow person={c} onSelect={onSelectPerson} onReroot={onReroot} small /></li>)}
                        </ul>
                      )}
                    </li>
                  ))}
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

      {/* Footer – re-root action */}
      <div className="px-5 py-4 border-t border-white/10">
        <button
          data-testid="person-drawer-reroot"
          onClick={() => { onReroot(person.gedcomId); onClose() }}
          className="w-full py-2 rounded-xl bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors uppercase tracking-wide"
        >
          FOCUS TREE ON {(person.name || 'PERSON').toUpperCase()}
        </button>
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
        />
      )}
    </>
  )
}

/**
 * Root component for the interactive family tree visualization.
 * Fetches available people and renders the tree canvas with search and navigation.
 */
const TREE_ROOT_STORAGE_KEY = 'family-tree-root-id'

export default function FamilyTree() {
  const [rootId, setRootId] = useState('')
  const [persons, setPersons] = useState<Person[]>([])
  const [personsError, setPersonsError] = useState<string | null>(null)

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
