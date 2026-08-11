/**
 * @fileoverview Pure arrow-key relationship resolution for graph keyboard navigation.
 *
 * Given the person node id that currently holds focus and an arrow key, resolves the
 * id of the adjacent person node focus should move to: `ArrowUp` → nearest parent,
 * `ArrowDown` → nearest child, `ArrowLeft`/`ArrowRight` → previous/next sibling in
 * on-screen (x-position) order. Union nodes are first-class (see `src/lib/lineage.ts`):
 * `CHILD` edges run union→person and `UNION` edges run person→union.
 */

import type { FlowNode, FlowEdge } from '@/types/tree'
import type { TreeView } from '@/lib/treeUrlState'

/** The four navigation keys this module resolves; any other key is not handled here. */
export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key)
  if (existing) existing.push(value)
  else map.set(key, [value])
}

/** The id in `candidates` whose x-position is nearest `anchorX`; `null` if `candidates` is empty. */
function nearestByX(candidates: string[], anchorX: number, xById: Map<string, number>): string | null {
  if (candidates.length === 0) return null
  return candidates.reduce((best, id) => {
    const bestDist = Math.abs((xById.get(best) ?? 0) - anchorX)
    const dist = Math.abs((xById.get(id) ?? 0) - anchorX)
    return dist < bestDist ? id : best
  })
}

/**
 * Resolves the person node id that arrow-key navigation from `currentId` should move
 * focus to.
 *
 * - `ArrowUp` — the parent (from `currentId`'s birth union) nearest `currentId`'s
 *   x-position, so a person with two parents moves to whichever one sits above them.
 * - `ArrowDown` — the child (from any union `currentId` is party to) nearest
 *   `currentId`'s x-position.
 * - `ArrowLeft` / `ArrowRight` — the previous/next sibling (another child of
 *   `currentId`'s birth union), ordered by on-screen x-position to match what the
 *   user sees.
 *
 * Returns `null` when there is no relative in that direction (e.g. the root has no
 * parent, an only child has no siblings) or when `currentId` is not in `nodes`.
 *
 * @param nodes - All person/union nodes currently loaded, positioned by the dagre layout
 * @param edges - All CHILD/UNION edges currently loaded
 * @param currentId - ReactFlow node id of the person that currently holds focus
 * @param key - The arrow key pressed
 */
export function resolveArrowTarget(
  nodes: FlowNode[],
  edges: FlowEdge[],
  currentId: string,
  key: ArrowKey,
): string | null {
  const personIds = new Set(nodes.filter(n => n.type === 'person').map(n => n.id))
  if (!personIds.has(currentId)) return null

  const xById = new Map(nodes.map(n => [n.id, n.position.x]))

  const birthUnionsByChild = new Map<string, string[]>()
  const childrenByUnion = new Map<string, string[]>()
  const parentsByUnion = new Map<string, string[]>()
  const unionsByParent = new Map<string, string[]>()

  for (const edge of edges) {
    if (edge.label === 'CHILD') {
      // union (source) → person (target)
      pushTo(birthUnionsByChild, edge.target, edge.source)
      pushTo(childrenByUnion, edge.source, edge.target)
    } else if (edge.label === 'UNION') {
      // person (source) → union (target)
      pushTo(parentsByUnion, edge.target, edge.source)
      pushTo(unionsByParent, edge.source, edge.target)
    }
  }

  const anchorX = xById.get(currentId) ?? 0

  if (key === 'ArrowUp') {
    const unions = birthUnionsByChild.get(currentId) ?? []
    const parents = unions.flatMap(u => parentsByUnion.get(u) ?? [])
    return nearestByX(parents, anchorX, xById)
  }

  if (key === 'ArrowDown') {
    const unions = unionsByParent.get(currentId) ?? []
    const children = unions.flatMap(u => childrenByUnion.get(u) ?? [])
    return nearestByX(children, anchorX, xById)
  }

  // ArrowLeft / ArrowRight: siblings — other children of the same birth union(s),
  // ordered by on-screen x-position (matches what the user sees, per issue #201).
  const birthUnions = birthUnionsByChild.get(currentId) ?? []
  const siblingIds = new Set<string>([currentId])
  for (const u of birthUnions) {
    for (const child of childrenByUnion.get(u) ?? []) siblingIds.add(child)
  }
  const ordered = [...siblingIds].sort((a, b) => (xById.get(a) ?? 0) - (xById.get(b) ?? 0))
  const idx = ordered.indexOf(currentId)
  if (key === 'ArrowLeft') return idx > 0 ? ordered[idx - 1] : null
  return idx < ordered.length - 1 ? ordered[idx + 1] : null
}

/** A `TreeView` reachable via the shell's 3-segment switcher (excludes `entry`). */
export type ShellView = Exclude<TreeView, 'entry'>

/** The action a `ViewerShell` key resolves to; `null` means the key is not handled. */
export type ShellAction =
  | { type: 'openSearch' }
  | { type: 'closeSearch' }
  | { type: 'setView'; view: ShellView }

/** The subset of a `KeyboardEvent` the shell resolver reads. */
export interface ShellKeyEvent {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
}

/** The `ViewerShell` state the resolver needs to gate the view-switch keys. */
export interface ShellKeyState {
  /** Whether the search overlay currently has focus/is open. */
  searchOpen: boolean
  /** Whether a focus person is set (the switcher is disabled without one). */
  hasFocus: boolean
}

const SHELL_VIEW_BY_DIGIT: Record<string, ShellView> = { '1': 'walk', '2': 'split', '3': 'tree' }

/**
 * Resolves a `ViewerShell` keydown to the action it triggers, or `null` if the key
 * has no binding (or its precondition is not met).
 *
 * - `⌘K` / `Ctrl+K` — always opens search, regardless of current state.
 * - `Esc` — closes search when it is open; otherwise a no-op.
 * - `1` / `2` / `3` — switches to walk/split/tree, but only when search is closed
 *   and a focus person is set; otherwise a no-op so the canvas keeps these keys
 *   while search is open or before a person is focused.
 */
export function resolveShellAction(event: ShellKeyEvent, state: ShellKeyState): ShellAction | null {
  const { key, metaKey, ctrlKey } = event

  if (key === 'k' && (metaKey || ctrlKey)) return { type: 'openSearch' }

  if (key === 'Escape') return state.searchOpen ? { type: 'closeSearch' } : null

  const view = SHELL_VIEW_BY_DIGIT[key]
  if (view) {
    if (state.searchOpen || !state.hasFocus) return null
    return { type: 'setView', view }
  }

  return null
}
