import raw from '@/data/tree.json'
import type { Dataset, PersonRecord, UnionRecord } from '../../scripts/build-dataset'
import { REL } from '@/types/tree'
import type { FlowEdge, FlowNode, PersonData, UnionData, PersonDetail, Relative } from '@/types/tree'

const ds = raw as Dataset

const nodeKey = (kind: 'p' | 'u', id: string) => `${kind}:${id}`
const edgeKey = (kind: string, a: string, b: string) => `${kind}:${a}->${b}`

export function listPersons() {
  return Object.values(ds.persons)
    .map(p => ({
      gedcomId: p.gedcomId,
      name: p.name,
      sex: p.sex || null,
      birthYear: p.birthYear,
      deathYear: p.deathYear,
      birthPlace: p.birthPlace,
    }))
    .sort((a, b) => {
      const pa = ds.persons[a.gedcomId]
      const pb = ds.persons[b.gedcomId]
      return (
        pa.surname.localeCompare(pb.surname) ||
        pa.givenName.localeCompare(pb.givenName) ||
        pa.name.localeCompare(pb.name)
      )
    })
}

function personData(p: PersonRecord, isRoot: boolean): PersonData {
  return {
    gedcomId: p.gedcomId,
    name: p.name,
    givenName: p.givenName,
    surname: p.surname,
    sex: p.sex,
    birthDate: p.birthDate,
    birthYear: p.birthYear,
    birthPlace: p.birthPlace,
    deathDate: p.deathDate,
    deathYear: p.deathYear,
    deathPlace: p.deathPlace,
    occupation: p.occupation,
    notes: p.notes,
    isRoot,
  }
}

function unionData(u: UnionRecord): UnionData {
  return {
    gedcomId: u.gedcomId,
    marriageDate: u.marriageDate,
    marriageYear: u.marriageYear,
    marriagePlace: u.marriagePlace,
  }
}

function relativeFromPerson(p: PersonRecord | undefined): Relative | null {
  if (!p) return null
  return {
    gedcomId: p.gedcomId,
    name: p.name,
    sex: p.sex,
    birthYear: p.birthYear,
    deathYear: p.deathYear,
  }
}

const MAX_NODES = 500

/**
 * BFS subgraph from a root person, at most `depth` relationship hops along
 * UNION or CHILD edges. Returns nodes/edges in the FlowNode/FlowEdge shape the
 * UI already consumes from the old Neo4j route.
 */
export function getSubtree(rootId: string, depth: number): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
  if (!ds.persons[rootId]) return null
  const visited = new Set<string>()
  const edgeIds = new Set<string>()
  const personIds: string[] = []
  const unionIds: string[] = []
  const edges: FlowEdge[] = []

  const queue: Array<{ kind: 'p' | 'u'; id: string; dist: number }> = [{ kind: 'p', id: rootId, dist: 0 }]
  visited.add(nodeKey('p', rootId))
  personIds.push(rootId)

  while (queue.length && personIds.length + unionIds.length < MAX_NODES) {
    const cur = queue.shift()!
    if (cur.dist >= depth) continue

    const addEdge = (kind: 'CHILD' | 'UNION', from: string, to: string) => {
      const k = edgeKey(kind, from, to)
      if (edgeIds.has(k)) return
      edgeIds.add(k)
      edges.push({
        id: k,
        source: from,
        target: to,
        label: kind,
      })
    }

    const enqueue = (kind: 'p' | 'u', id: string) => {
      const key = nodeKey(kind, id)
      if (visited.has(key)) return
      visited.add(key)
      if (kind === 'p') personIds.push(id); else unionIds.push(id)
      queue.push({ kind, id, dist: cur.dist + 1 })
    }

    if (cur.kind === 'p') {
      for (const uid of ds.unionOf[cur.id] ?? []) {
        addEdge(REL.UNION, nodeKey('p', cur.id), nodeKey('u', uid))
        enqueue('u', uid)
      }
      for (const uid of ds.childOf[cur.id] ?? []) {
        addEdge(REL.CHILD, nodeKey('p', cur.id), nodeKey('u', uid))
        enqueue('u', uid)
      }
    } else {
      for (const pid of ds.spousesOf[cur.id] ?? []) {
        addEdge(REL.UNION, nodeKey('p', pid), nodeKey('u', cur.id))
        enqueue('p', pid)
      }
      for (const pid of ds.childrenOf[cur.id] ?? []) {
        addEdge(REL.CHILD, nodeKey('p', pid), nodeKey('u', cur.id))
        enqueue('p', pid)
      }
    }
  }

  const nodes: FlowNode[] = [
    ...personIds.map(id => ({
      id: nodeKey('p', id),
      type: 'person' as const,
      data: personData(ds.persons[id], id === rootId),
      position: { x: 0, y: 0 },
    })),
    ...unionIds.map(id => ({
      id: nodeKey('u', id),
      type: 'union' as const,
      data: unionData(ds.unions[id]),
      position: { x: 0, y: 0 },
    })),
  ]

  return { nodes, edges }
}

export function getPersonDetail(id: string): PersonDetail | null {
  const p = ds.persons[id]
  if (!p) return null

  const parents: Relative[] = []
  const siblings: Relative[] = []
  for (const pf of ds.childOf[id] ?? []) {
    for (const parentId of ds.spousesOf[pf] ?? []) {
      const rel = relativeFromPerson(ds.persons[parentId])
      if (rel) parents.push(rel)
    }
    for (const sibId of ds.childrenOf[pf] ?? []) {
      if (sibId === id) continue
      const rel = relativeFromPerson(ds.persons[sibId])
      if (rel) siblings.push(rel)
    }
  }

  const marriages = (ds.unionOf[id] ?? []).map(mid => {
    const u = ds.unions[mid]
    const spouseId = (ds.spousesOf[mid] ?? []).find(pid => pid !== id)
    const childRels = (ds.childrenOf[mid] ?? [])
      .map(cid => relativeFromPerson(ds.persons[cid]))
      .filter((r): r is Relative => Boolean(r))
    return {
      gedcomId: mid,
      spouse: spouseId ? relativeFromPerson(ds.persons[spouseId]) : null,
      marriageDate: u.marriageDate,
      marriagePlace: u.marriagePlace,
      children: childRels,
    }
  })

  const spouses = marriages
    .map(m => m.spouse)
    .filter((s): s is Relative => Boolean(s))
  const children = marriages.flatMap(m => m.children)

  return {
    person: personData(p, false),
    parents,
    siblings,
    spouses,
    children,
    marriages,
  }
}
