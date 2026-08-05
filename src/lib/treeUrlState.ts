/**
 * @fileoverview Pure helpers for reading and writing family tree viewer state
 * (root person, selected person, and depth) to and from URL search params.
 * Kept framework-agnostic so it can be unit-tested without a Next.js router.
 */

import { MIN_HOPS, MAX_HOPS } from '@/constants/tree'

/** Shape of a GEDCOM cross-reference id, e.g. `@I85@` or `@ISPOUSE_A@`. */
const GEDCOM_ID_PATTERN = /^@[A-Za-z0-9_]+@$/

/** Valid values for the `view` URL param. */
export const TREE_VIEWS = ['entry', 'walk', 'split', 'tree'] as const

/** The tree viewer's display mode, as reflected in the `view` URL param. */
export type TreeView = (typeof TREE_VIEWS)[number]

/** Parsed/validated tree viewer state, as reflected in URL search params. */
export interface TreeUrlState {
  /** Validated GEDCOM id of the tree root, or null if absent/invalid. */
  root: string | null
  /** Validated GEDCOM id of the selected person, or null if absent/invalid. */
  person: string | null
  /** Depth clamped to MIN_HOPS..MAX_HOPS, or null if absent/non-numeric. */
  hops: number | null
  /** Validated display mode, or null if absent/unrecognized. */
  view: TreeView | null
}

/** Input accepted by {@link serializeTreeUrlState}; any field may be omitted. */
export type TreeUrlStateInput = Partial<{
  root: string | null
  person: string | null
  hops: number | null
  view: TreeView | null
}>

/**
 * Decodes a param value that may already be decoded (raw `@`) or still
 * percent-encoded (`%40`) — `URLSearchParams.get()` normally handles this
 * transparently, but this tolerates callers who pass an already-decoded or
 * double-encoded value.
 */
function normalizeParamValue(value: string): string {
  if (!value.includes('%')) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Validates that a value has the `@<id>@` GEDCOM cross-reference shape. */
export function isValidGedcomId(value: string | null | undefined): value is string {
  if (!value) return false
  return GEDCOM_ID_PATTERN.test(normalizeParamValue(value))
}

/** Validates that a value is one of the recognized {@link TreeView} modes. */
export function isValidTreeView(value: string | null | undefined): value is TreeView {
  if (!value) return false
  return (TREE_VIEWS as readonly string[]).includes(value)
}

/** Clamps a depth value to the MIN_HOPS..MAX_HOPS range, flooring fractional input. */
export function clampHops(hops: number): number {
  return Math.min(MAX_HOPS, Math.max(MIN_HOPS, Math.floor(hops)))
}

function parseGedcomIdParam(raw: string | null): string | null {
  if (raw === null) return null
  const normalized = normalizeParamValue(raw)
  return isValidGedcomId(normalized) ? normalized : null
}

function parseHopsParam(raw: string | null): number | null {
  if (raw === null || raw === '') return null
  if (!/^-?\d+$/.test(raw)) return null
  return clampHops(Number(raw))
}

function parseViewParam(raw: string | null): TreeView | null {
  if (raw === null) return null
  return isValidTreeView(raw) ? raw : null
}

/**
 * Reads and validates tree viewer state from URL search params.
 * Invalid or missing values resolve to null so callers can fall back to
 * localStorage or defaults rather than surfacing an error.
 */
export function parseTreeUrlState(searchParams: URLSearchParams): TreeUrlState {
  return {
    root: parseGedcomIdParam(searchParams.get('root')),
    person: parseGedcomIdParam(searchParams.get('person')),
    hops: parseHopsParam(searchParams.get('hops')),
    view: parseViewParam(searchParams.get('view')),
  }
}

/**
 * Serializes tree viewer state into a URL query string (no leading `?`).
 * Fields that are null/undefined are omitted; hops is clamped to range.
 */
export function serializeTreeUrlState(state: TreeUrlStateInput): string {
  const params = new URLSearchParams()
  if (state.root != null) params.set('root', state.root)
  if (state.person != null) params.set('person', state.person)
  if (state.hops != null) params.set('hops', String(clampHops(state.hops)))
  if (state.view != null) params.set('view', state.view)
  return params.toString()
}

/**
 * Builds a relative URL path from tree viewer state, suitable for router.push/replace.
 * Returns `/` if no state is provided, or `/?<query>` if state is present.
 */
export function buildTreeUrlPath(state: TreeUrlStateInput): string {
  const query = serializeTreeUrlState(state)
  return query ? `/?${query}` : '/'
}
