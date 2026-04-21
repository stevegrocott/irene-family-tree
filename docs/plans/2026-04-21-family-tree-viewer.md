# Family Tree Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Build a Next.js app that imports a GEDCOM file into Neo4j and renders an interactive family tree using React Flow.

**Architecture:** Parse `family-tree.ged` into Neo4j using a Family node model mirroring GEDCOM structure (Person nodes, Family nodes, CHILD_OF and SPOUSE_IN relationships). A Next.js API route queries the graph and returns subgraph data. React Flow with dagre layout renders the tree client-side.

**Tech Stack:** Next.js 14 (App Router), Neo4j Desktop (local dev) / Neo4j Aura Free (prod), `neo4j-driver`, `parse-gedcom`, `reactflow`, `@dagrejs/dagre`, TypeScript, Tailwind CSS

**Feature Branch:** `main` ← new repo, no existing branch

---

## Neo4j Data Model

```
(:Person {id, givenName, surname, sex, birthDate, birthPlace, deathDate, deathPlace})
(:Family {id})
(person)-[:SPOUSE_IN]->(family)
(person)-[:CHILD_OF]->(family)
```

This mirrors GEDCOM exactly: each `FAM` record becomes a Family node; `HUSB`/`WIFE` become `SPOUSE_IN`; `CHIL` becomes `CHILD_OF`.

---

## Task 1: Initialise Next.js Project

**Files:**
- Create: `/Users/shinytrap/projects/GED/package.json` (via `npx create-next-app`)

**Step 1: Initialise the project**

```bash
cd /Users/shinytrap/projects/GED
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-git
```

Expected: Next.js project scaffold created in current directory alongside `family-tree.ged`.

**Step 2: Install dependencies**

```bash
npm install neo4j-driver parse-gedcom reactflow @dagrejs/dagre
npm install -D @types/dagre
```

**Step 3: Verify dev server starts**

```bash
npm run dev
```

Expected: Server running at http://localhost:3000 with default Next.js page.

**Step 4: Commit**

```bash
git init
git add .
git commit -m "feat: initialise Next.js project with Neo4j and React Flow deps"
```

---

## Task 2: Neo4j Local Setup

**Files:**
- Create: `src/lib/neo4j.ts`
- Create: `.env.local`

**Step 1: Install and start Neo4j Desktop**

Download from https://neo4j.com/download/ if not already installed.
Create a new local database named `family-tree`, start it, note the bolt URL and password.

**Step 2: Create `.env.local`**

```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password-here
```

**Step 3: Write Neo4j driver singleton**

Create `src/lib/neo4j.ts`:

```typescript
import neo4j, { Driver } from 'neo4j-driver'

let driver: Driver

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!)
    )
  }
  return driver
}

export async function runQuery<T>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const session = getDriver().session()
  try {
    const result = await session.run(cypher, params)
    return result.records.map(r => r.toObject() as T)
  } finally {
    await session.close()
  }
}
```

**Step 4: Verify connection**

Create `src/lib/neo4j.test.ts`:

```typescript
import { runQuery } from './neo4j'

test('connects to Neo4j', async () => {
  const result = await runQuery<{ n: number }>('RETURN 1 AS n')
  expect(result[0].n).toBe(1)
})
```

Run: `npx jest src/lib/neo4j.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/neo4j.ts .env.local
git commit -m "feat: add Neo4j driver singleton"
```

---

## Task 3: GEDCOM Parser and Neo4j Importer

**Files:**
- Create: `scripts/import-gedcom.ts`
- Create: `scripts/parse-gedcom.d.ts` (if types missing)

**Step 1: Inspect the GED file structure**

```bash
head -50 family-tree.ged
```

Confirm records start with `0 @I<n>@ INDI` (individuals) and `0 @F<n>@ FAM` (families).

> **Finding (Task 1 spike):** `family-tree.ged` uses **both** NAME formats simultaneously.
> Each `INDI` record has:
> - `1 NAME GivenName/Surname/` — slash-delimited primary NAME tag (GEDCOM 5.5.1 slash format)
> - `2 GIVN GivenName` + `2 SURN Surname` — structured GIVN/SURN subtags
>
> The importer should use `GIVN`/`SURN` subtags (already done in the script below) as they are structured and reliable. The slash format is a display fallback only.

**Step 2: Write the importer script**

Create `scripts/import-gedcom.ts`:

```typescript
import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'parse-gedcom'
import { getDriver } from '../src/lib/neo4j'

interface GedcomNode {
  tag: string
  data: string
  tree: GedcomNode[]
}

function findTag(nodes: GedcomNode[], tag: string): string | undefined {
  return nodes.find(n => n.tag === tag)?.data
}

async function importGedcom(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const records = parse(content) as GedcomNode[]

  const driver = getDriver()
  const session = driver.session()

  try {
    // Clear existing data
    await session.run('MATCH (n) DETACH DELETE n')

    // Create constraints
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE')
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (f:Family) REQUIRE f.id IS UNIQUE')

    // Import individuals
    const individuals = records.filter(r => r.tag === 'INDI')
    for (const indi of individuals) {
      const nameNode = indi.tree.find(n => n.tag === 'NAME')
      const birthNode = indi.tree.find(n => n.tag === 'BIRT')
      const deathNode = indi.tree.find(n => n.tag === 'DEAT')

      const givenName = findTag(nameNode?.tree ?? [], 'GIVN') ?? ''
      const surname = findTag(nameNode?.tree ?? [], 'SURN') ?? ''
      const sex = findTag(indi.tree, 'SEX') ?? 'U'
      const birthDate = findTag(birthNode?.tree ?? [], 'DATE') ?? ''
      const birthPlace = findTag(birthNode?.tree ?? [], 'PLAC') ?? ''
      const deathDate = findTag(deathNode?.tree ?? [], 'DATE') ?? ''
      const deathPlace = findTag(deathNode?.tree ?? [], 'PLAC') ?? ''

      await session.run(
        `MERGE (p:Person {id: $id})
         SET p.givenName = $givenName,
             p.surname = $surname,
             p.sex = $sex,
             p.birthDate = $birthDate,
             p.birthPlace = $birthPlace,
             p.deathDate = $deathDate,
             p.deathPlace = $deathPlace`,
        { id: indi.data, givenName, surname, sex, birthDate, birthPlace, deathDate, deathPlace }
      )
    }

    // Import families and relationships
    const families = records.filter(r => r.tag === 'FAM')
    for (const fam of families) {
      await session.run('MERGE (f:Family {id: $id})', { id: fam.data })

      const husb = findTag(fam.tree, 'HUSB')
      const wife = findTag(fam.tree, 'WIFE')
      const children = fam.tree.filter(n => n.tag === 'CHIL').map(n => n.data)

      if (husb) {
        await session.run(
          'MATCH (p:Person {id: $pid}), (f:Family {id: $fid}) MERGE (p)-[:SPOUSE_IN]->(f)',
          { pid: husb, fid: fam.data }
        )
      }
      if (wife) {
        await session.run(
          'MATCH (p:Person {id: $pid}), (f:Family {id: $fid}) MERGE (p)-[:SPOUSE_IN]->(f)',
          { pid: wife, fid: fam.data }
        )
      }
      for (const child of children) {
        await session.run(
          'MATCH (p:Person {id: $pid}), (f:Family {id: $fid}) MERGE (p)-[:CHILD_OF]->(f)',
          { pid: child, fid: fam.data }
        )
      }
    }

    const [personCount] = await session.run('MATCH (p:Person) RETURN count(p) AS n')
    const [famCount] = await session.run('MATCH (f:Family) RETURN count(f) AS n')
    console.log(`Imported ${personCount.get('n')} people and ${famCount.get('n')} families`)
  } finally {
    await session.close()
    await driver.close()
  }
}

importGedcom(path.join(__dirname, '../family-tree.ged'))
```

**Step 3: Add ts-node and run the importer**

```bash
npm install -D ts-node
npx ts-node scripts/import-gedcom.ts
```

Expected output: `Imported NNN people and NNN families`

**Step 4: Verify in Neo4j Browser**

Open Neo4j Browser at http://localhost:7474 and run:
```cypher
MATCH (p:Person) RETURN p LIMIT 25
```

Expected: Person nodes with name and date properties visible.

**Step 5: Add import script to package.json**

```json
"scripts": {
  "import": "ts-node scripts/import-gedcom.ts"
}
```

**Step 6: Commit**

```bash
git add scripts/ package.json
git commit -m "feat: add GEDCOM importer script"
```

---

## Task 4: API Route — Fetch Subgraph

**Files:**
- Create: `src/app/api/tree/route.ts`
- Create: `src/types/tree.ts`

**Step 1: Define shared types**

Create `src/types/tree.ts`:

```typescript
export interface PersonNode {
  id: string
  givenName: string
  surname: string
  sex: string
  birthDate: string
  deathDate: string
}

export interface FamilyNode {
  id: string
}

export interface TreeRelationship {
  source: string
  target: string
  type: 'SPOUSE_IN' | 'CHILD_OF'
}

export interface TreeData {
  persons: PersonNode[]
  families: FamilyNode[]
  relationships: TreeRelationship[]
}
```

**Step 2: Write the API route**

Create `src/app/api/tree/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { runQuery } from '@/lib/neo4j'
import { TreeData } from '@/types/tree'

export async function GET() {
  const [persons, families, relationships] = await Promise.all([
    runQuery(`MATCH (p:Person) RETURN p.id AS id, p.givenName AS givenName,
              p.surname AS surname, p.sex AS sex,
              p.birthDate AS birthDate, p.deathDate AS deathDate`),
    runQuery(`MATCH (f:Family) RETURN f.id AS id`),
    runQuery(`MATCH (p:Person)-[r:SPOUSE_IN|CHILD_OF]->(f:Family)
              RETURN p.id AS source, f.id AS target, type(r) AS type`),
  ])

  const data: TreeData = {
    persons: persons as any,
    families: families as any,
    relationships: relationships as any,
  }

  return NextResponse.json(data)
}
```

**Step 3: Test the API**

```bash
npm run dev
curl http://localhost:3000/api/tree | jq '.persons | length'
```

Expected: number of people in your GED file.

**Step 4: Commit**

```bash
git add src/app/api/ src/types/
git commit -m "feat: add /api/tree endpoint returning full graph"
```

---

## Task 5: React Flow Tree Component

**Files:**
- Create: `src/components/FamilyTree.tsx`
- Create: `src/lib/layout.ts`
- Modify: `src/app/page.tsx`

**Step 1: Write the dagre layout helper**

Create `src/lib/layout.ts`:

```typescript
import dagre from '@dagrejs/dagre'
import { Node, Edge } from 'reactflow'

export function applyDagreLayout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 40 })

  nodes.forEach(n => g.setNode(n.id, { width: n.width ?? 160, height: n.height ?? 60 }))
  edges.forEach(e => g.setEdge(e.source, e.target))

  dagre.layout(g)

  return {
    nodes: nodes.map(n => {
      const pos = g.node(n.id)
      return { ...n, position: { x: pos.x - (n.width ?? 160) / 2, y: pos.y - (n.height ?? 60) / 2 } }
    }),
    edges,
  }
}
```

**Step 2: Write the FamilyTree component**

Create `src/components/FamilyTree.tsx`:

```typescript
'use client'

import { useEffect, useState, useCallback } from 'react'
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, ReactFlowProvider
} from 'reactflow'
import 'reactflow/dist/style.css'
import { applyDagreLayout } from '@/lib/layout'
import { TreeData } from '@/types/tree'

function PersonNodeComponent({ data }: { data: { label: string; sub: string; sex: string } }) {
  const bg = data.sex === 'M' ? '#dbeafe' : data.sex === 'F' ? '#fce7f3' : '#f3f4f6'
  return (
    <div style={{ background: bg, border: '1px solid #ccc', borderRadius: 8, padding: '6px 10px', fontSize: 12, minWidth: 140 }}>
      <div style={{ fontWeight: 600 }}>{data.label}</div>
      <div style={{ color: '#666' }}>{data.sub}</div>
    </div>
  )
}

const nodeTypes = { person: PersonNodeComponent }

function buildFlow(data: TreeData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    ...data.persons.map(p => ({
      id: p.id,
      type: 'person',
      position: { x: 0, y: 0 },
      data: {
        label: `${p.givenName} ${p.surname}`.trim(),
        sub: p.birthDate ? `b. ${p.birthDate}` : '',
        sex: p.sex,
      },
      width: 160,
      height: 60,
    })),
    ...data.families.map(f => ({
      id: f.id,
      position: { x: 0, y: 0 },
      data: { label: '' },
      style: { width: 8, height: 8, borderRadius: '50%', background: '#999', border: 'none' },
      width: 8,
      height: 8,
    })),
  ]

  const edges: Edge[] = data.relationships.map((r, i) => ({
    id: `e${i}`,
    source: r.source,
    target: r.target,
    style: { stroke: r.type === 'SPOUSE_IN' ? '#94a3b8' : '#475569' },
  }))

  return applyDagreLayout(nodes, edges)
}

export default function FamilyTree() {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  useEffect(() => {
    fetch('/api/tree')
      .then(r => r.json())
      .then((data: TreeData) => {
        const { nodes: n, edges: e } = buildFlow(data)
        setNodes(n)
        setEdges(e)
      })
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
```

**Step 3: Update the home page**

Replace contents of `src/app/page.tsx`:

```typescript
import FamilyTree from '@/components/FamilyTree'

export default function Home() {
  return <FamilyTree />
}
```

**Step 4: Remove default global styles that conflict**

In `src/app/globals.css`, remove the `body` margin/padding defaults or add:

```css
body { margin: 0; padding: 0; }
```

**Step 5: Test in browser**

```bash
npm run dev
```

Open http://localhost:3000 — expect the family tree to render with person nodes, family junction nodes, and connecting edges. Should be zoomable, pannable, with minimap.

**Step 6: Commit**

```bash
git add src/components/ src/lib/layout.ts src/app/page.tsx src/app/globals.css
git commit -m "feat: add React Flow family tree visualization"
```

---

## Task 6: Search and Person Focus

**Files:**
- Create: `src/components/SearchBar.tsx`
- Modify: `src/app/api/tree/route.ts`
- Modify: `src/components/FamilyTree.tsx`

**Step 1: Add ancestor-focused API query**

Add a `?focus=<personId>` query param to `/api/tree` that returns only ancestors + descendants within 3 generations:

```typescript
// In route.ts, read searchParams:
const { searchParams } = new URL(request.url)
const focusId = searchParams.get('focus')

if (focusId) {
  // Return subgraph around this person
  const subgraph = await runQuery(`
    MATCH (p:Person {id: $id})
    OPTIONAL MATCH (p)-[:CHILD_OF*0..3]->(f:Family)<-[:SPOUSE_IN|CHILD_OF]-(other)
    RETURN p, f, other
  `, { id: focusId })
  // ... build and return TreeData from subgraph
}
```

**Step 2: Write SearchBar component**

Create `src/components/SearchBar.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { PersonNode } from '@/types/tree'

interface Props {
  persons: PersonNode[]
  onSelect: (id: string) => void
}

export default function SearchBar({ persons, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const filtered = persons.filter(p =>
    `${p.givenName} ${p.surname}`.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 10)

  return (
    <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, background: 'white', borderRadius: 8, padding: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
      <input
        placeholder="Search family member..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{ width: 220, padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}
      />
      {query && (
        <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
          {filtered.map(p => (
            <li
              key={p.id}
              onClick={() => { onSelect(p.id); setQuery('') }}
              style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4 }}
            >
              {p.givenName} {p.surname}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

**Step 3: Wire SearchBar into FamilyTree**

In `FamilyTree.tsx`, add the SearchBar and a handler that re-fetches with `?focus=<id>` and calls `fitView` on the selected node.

**Step 4: Test**

Search for "Grocott" or any known surname — expect the tree to pan to that person.

**Step 5: Commit**

```bash
git add src/components/SearchBar.tsx
git commit -m "feat: add person search with tree focus"
```

---

## Task 7: Vercel Deployment Prep

**Files:**
- Create: `vercel.json`
- Modify: `.env.local` → document prod env vars

**Step 1: Create a Neo4j Aura Free instance**

Go to https://console.neo4j.io → New Instance → Free tier.
Note the connection URI, username, and password.

**Step 2: Set Vercel env vars**

```bash
vercel env add NEO4J_URI
vercel env add NEO4J_USER
vercel env add NEO4J_PASSWORD
```

Use the Aura connection string: `neo4j+s://<your-instance>.databases.neo4j.io`

**Step 3: Run importer against Aura**

```bash
NEO4J_URI=neo4j+s://... NEO4J_USER=neo4j NEO4J_PASSWORD=... npm run import
```

**Step 4: Deploy to Vercel**

```bash
vercel --prod
```

**Step 5: Configure Cloudflare**

In Cloudflare DNS for your grocott domain:
- Add CNAME record: `tree` → `<your-vercel-app>.vercel.app`
- In Vercel project settings → Domains → add `tree.grocott.com` (or your chosen subdomain)

**Step 6: Final smoke test**

Visit `https://tree.grocott.com` — confirm tree loads with full data.

---

## Summary

| Task | What it builds |
|------|---------------|
| 1 | Next.js + dependencies |
| 2 | Neo4j local connection |
| 3 | GEDCOM → Neo4j importer |
| 4 | `/api/tree` JSON endpoint |
| 5 | React Flow visualization |
| 6 | Search + person focus |
| 7 | Vercel + Aura + Cloudflare deploy |
