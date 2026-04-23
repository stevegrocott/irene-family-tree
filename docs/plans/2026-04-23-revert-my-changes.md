# Revert My Changes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let authors (and admins) undo their own `CREATE_PERSON`, `ADD_RELATIONSHIP`, and `UPDATE_PERSON` changes from the PersonDrawer, with three dedicated UI surfaces and a shared revert endpoint. Replaces the broken no-op paths in the existing admin revert handler.

**Architecture:** New `src/lib/revert.ts` centralises the per-`changeType` revert logic (block-if-dependent + undo + status flip). Two new routes — `POST /api/changes/[id]/revert` (shared by authors and admins) and `GET /api/person/[id]/my-changes` — expose it. `src/app/api/admin/changes/[id]/route.ts` is refactored to delegate to the same module. `src/components/FamilyTree.tsx` gains three UI surfaces: delete-person button, per-marriage × remove, and "Your edits" list in edit mode.

**Tech Stack:** Next.js 16 App Router, Neo4j (via `src/lib/neo4j.ts`), NextAuth v5 JWT sessions, React 19, Playwright, Jest.

**Feature Branch:** `feature/revert-my-changes` (already created — worktree at `.worktrees/revert-my-changes`).

**Design reference:** `docs/plans/2026-04-23-revert-my-changes-design.md`.

---

## Task 0: Baseline

**Files:** none

**Step 1: Confirm the worktree is on the right branch**

```bash
cd /Users/shinytrap/projects/GED/.worktrees/revert-my-changes
git branch --show-current
```
Expected: `feature/revert-my-changes`.

**Step 2: Confirm tests run**

```bash
set -a; source .env.local; set +a
npx jest --silent 2>&1 | tail -3
```
Expected: 16 pre-existing Neo4j-dependent failures, 154 passing, no new regressions introduced by later tasks.

---

## Task 1: Add `DELETE_PERSON` to allowed change types

**Files:**
- Modify: `src/app/admin/types.ts`
- Modify: `src/app/api/suggestions/route.ts:8`

**Step 1: Update the admin UI change-type union**

`src/app/admin/types.ts`:
```ts
changeType: 'UPDATE_PERSON' | 'CREATE_PERSON' | 'ADD_RELATIONSHIP' | 'DELETE_PERSON'
```

**Step 2:** Leave `ALLOWED_CHANGE_TYPES` in `src/app/api/suggestions/route.ts` unchanged — `DELETE_PERSON` is only written by the revert path, never by suggestions. The new changeType intentionally is NOT a valid suggestion type.

**Step 3: Commit**

```bash
git add src/app/admin/types.ts
git commit -m "feat(revert): allow DELETE_PERSON in admin change-type union"
```

---

## Task 2: Scaffold `src/lib/revert.ts` with shared types

**Files:**
- Create: `src/lib/revert.ts`

**Step 1: Create the module with types only**

```ts
import { read, write } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { ALLOWED_PATCH_FIELDS } from '@/lib/patches'

export type ConflictKind =
  | 'has-relationships'
  | 'union-touched'
  | 'field-updated-later'

export interface RevertConflict {
  kind: ConflictKind
  detail: string
}

export type RevertOutcome =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string; conflict?: RevertConflict }

export interface ChangeRow {
  id: string
  changeType: 'CREATE_PERSON' | 'ADD_RELATIONSHIP' | 'UPDATE_PERSON' | 'DELETE_PERSON'
  targetId: string
  previousValue: string | null
  newValue: string
  status: string
  authorEmail: string
  authorName: string
  appliedAt: string
}

export async function revertChange(
  changeId: string,
  reverter: { email: string; name: string }
): Promise<RevertOutcome> {
  throw new Error('not implemented')
}
```

**Step 2: Commit**

```bash
git add src/lib/revert.ts
git commit -m "feat(revert): scaffold shared revert module"
```

---

## Task 3: TDD — `CREATE_PERSON` revert happy path

**Files:**
- Create: `src/lib/revert.test.ts`
- Modify: `src/lib/revert.ts`

**Step 1: Write the failing test**

```ts
jest.mock('@/lib/neo4j', () => ({ read: jest.fn(), write: jest.fn() }))
jest.mock('@/lib/changes', () => ({ recordChange: jest.fn() }))

import { read, write } from '@/lib/neo4j'
import { recordChange } from '@/lib/changes'
import { revertChange } from './revert'

const mockRead = read as jest.MockedFunction<typeof read>
const mockWrite = write as jest.MockedFunction<typeof write>
const mockRecord = recordChange as jest.MockedFunction<typeof recordChange>

const REVERTER = { email: 'alice@example.com', name: 'Alice' }

beforeEach(() => jest.clearAllMocks())

describe('revertChange — CREATE_PERSON', () => {
  it('deletes the Person, flips status=reverted, writes DELETE_PERSON audit', async () => {
    mockRead
      // fetch change
      .mockResolvedValueOnce([{ id: 'c1', changeType: 'CREATE_PERSON', targetId: 'I001',
        previousValue: null, newValue: JSON.stringify({ name: 'X' }),
        status: 'live', authorEmail: 'a@b', authorName: 'A', appliedAt: '2026-01-01' }])
      // check edge count
      .mockResolvedValueOnce([{ edges: 0 }])

    mockWrite.mockResolvedValue([{ deleted: 1 }])
    const result = await revertChange('c1', REVERTER)

    expect(result).toEqual({ ok: true })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('DETACH DELETE'),
      expect.objectContaining({ targetId: 'I001' })
    )
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("SET c.status = 'reverted'"),
      expect.objectContaining({ id: 'c1' })
    )
    expect(mockRecord).toHaveBeenCalledWith(
      'alice@example.com', 'Alice', 'DELETE_PERSON', 'I001',
      expect.any(Object), expect.any(Object)
    )
  })
})
```

**Step 2: Run to confirm it fails**

```bash
set -a; source .env.local; set +a
npx jest src/lib/revert.test.ts 2>&1 | tail -15
```
Expected: FAIL ("not implemented").

**Step 3: Implement the happy path in `src/lib/revert.ts`**

Flesh out `revertChange`: fetch the change; if `changeType === 'CREATE_PERSON'`, run an edge count, `DETACH DELETE` the Person, flip change status, call `recordChange('DELETE_PERSON', …)`. Return `{ ok: true }`.

**Step 4: Run to confirm pass**

```bash
npx jest src/lib/revert.test.ts 2>&1 | tail -5
```
Expected: PASS (1/1).

**Step 5: Commit**

```bash
git add src/lib/revert.ts src/lib/revert.test.ts
git commit -m "feat(revert): implement CREATE_PERSON revert happy path"
```

---

## Task 4: TDD — `CREATE_PERSON` block path

**Step 1: Add failing test**

```ts
it('returns 409 has-relationships when person has UNION or CHILD edges', async () => {
  mockRead
    .mockResolvedValueOnce([{ id: 'c1', changeType: 'CREATE_PERSON', targetId: 'I001',
      previousValue: null, newValue: '{}', status: 'live',
      authorEmail: 'a@b', authorName: 'A', appliedAt: '2026-01-01' }])
    .mockResolvedValueOnce([{ edges: 2 }])
  const result = await revertChange('c1', REVERTER)
  expect(result).toEqual(expect.objectContaining({
    ok: false, status: 409,
    conflict: { kind: 'has-relationships', detail: expect.stringContaining('relationship') },
  }))
  expect(mockWrite).not.toHaveBeenCalled()
})
```

**Step 2-3: Fail → implement the early-return path → pass.**

**Step 4: Commit**

```bash
git commit -am "feat(revert): block CREATE_PERSON revert when person has relationships"
```

---

## Task 5: TDD — `ADD_RELATIONSHIP` happy + block paths

**Step 1-4: Add four test cases iteratively, failing then implementing:**

1. Spouse happy: union with exactly 2 UNION + 0 CHILD → `DETACH DELETE (u)`, status flips.
2. Parent/child happy: union with exactly 1 UNION + 1 CHILD → same.
3. Spouse block: union has a CHILD edge → 409 `union-touched`.
4. Parent/child block: union has extra UNION or CHILD → 409 `union-touched`.

The Cypher edge-count query:
```cypher
MATCH (u:Union {gedcomId: $unionId})
OPTIONAL MATCH (u)<-[ue:UNION]-()
OPTIONAL MATCH (u)-[ce:CHILD]->()
RETURN count(DISTINCT ue) AS unionEdges, count(DISTINCT ce) AS childEdges
```

Block rule:
- type='spouse': expect `unionEdges === 2 && childEdges === 0`
- type='parent'|'child': expect `unionEdges === 1 && childEdges === 1`

**Step 5: Commit**

```bash
git commit -am "feat(revert): implement ADD_RELATIONSHIP revert (spouse/parent/child with block rules)"
```

---

## Task 6: TDD — `UPDATE_PERSON` happy + block

**Step 1-4: Add two test cases:**

1. Happy: `SET p += previousValue` for `ALLOWED_PATCH_FIELDS` keys present in `previousValue`, status flips.
2. Block: a later live `UPDATE_PERSON` on the same `targetId` whose `newValue` keys overlap with our `previousValue` keys → 409 `field-updated-later`.

Later-change lookup:
```cypher
MATCH (c:Change { status: 'live', changeType: 'UPDATE_PERSON', targetId: $targetId })
WHERE c.appliedAt > $appliedAt AND c.id <> $id
RETURN c.id AS id, c.newValue AS newValue
```
In code: parse each row's `newValue`, return 409 if any of its keys intersects with our `previousValue` keys (filtered to `ALLOWED_PATCH_FIELDS`).

**Step 5: Commit**

```bash
git commit -am "feat(revert): implement UPDATE_PERSON revert with later-edit block"
```

---

## Task 7: TDD — edge cases (not-found, already-reverted)

**Step 1: Add tests**

- `ok: false, status: 404` when the change id doesn't match.
- `ok: false, status: 409, error: 'Change is not live'` when `status !== 'live'`.

**Step 2-4: Fail → implement → pass.**

**Step 5: Commit**

```bash
git commit -am "test(revert): cover not-found and already-reverted cases"
```

---

## Task 8: TDD — `POST /api/changes/[id]/revert`

**Files:**
- Create: `src/app/api/changes/[id]/revert/route.ts`
- Create: `src/app/api/changes/[id]/revert/route.test.ts`

**Step 1: Write failing tests** (401 anon, 403 non-author non-admin, 200 author, 200 admin-on-others, 404, 409, shape of response body including `conflictingChange`).

Mock `@/auth`, `@/lib/revert` (so this test is about the route wiring, not the revert logic — that's covered in `revert.test.ts`).

**Step 2: Run — fails** (route doesn't exist).

**Step 3: Implement**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { read } from '@/lib/neo4j'
import { revertChange } from '@/lib/revert'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Authorization: fetch authorEmail before delegating
  const rows = await read<{ authorEmail: string }>(
    `MATCH (c:Change {id: $id}) RETURN c.authorEmail AS authorEmail`, { id }
  )
  if (!rows.length) return NextResponse.json({ error: 'Change not found' }, { status: 404 })

  const isAuthor = rows[0].authorEmail === session.user.email
  const isAdmin = session.user.role === 'admin'
  if (!isAuthor && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await revertChange(id, {
    email: session.user.email,
    name: session.user.name ?? session.user.email,
  })

  if (result.ok) return NextResponse.json({ success: true })
  return NextResponse.json(
    { error: result.error, conflictingChange: result.conflict },
    { status: result.status }
  )
}
```

**Step 4: Run tests — pass.**

**Step 5: Commit**

```bash
git add src/app/api/changes/[id]/revert
git commit -m "feat(revert): add POST /api/changes/[id]/revert endpoint"
```

---

## Task 9: Refactor admin endpoint to delegate

**Files:**
- Modify: `src/app/api/admin/changes/[id]/route.ts`
- Verify: `src/app/api/admin/changes/[id]/route.test.ts` still passes

**Step 1: Write one new failing test in `route.test.ts`**

"admin revert of CREATE_PERSON deletes the Person via lib/revert" — confirms delegation, since the old code silently no-ops.

**Step 2: Refactor the `revert` branch** to delegate to `revertChange(id, { email, name })` from `@/lib/revert`. Keep the `keep` branch unchanged.

```ts
// inside existing POST handler:
if (action === 'revert') {
  const result = await revertChange(id, {
    email: session.user.email!,
    name: session.user.name ?? session.user.email!,
  })
  if (result.ok) return NextResponse.json({ success: true })
  return NextResponse.json(
    { error: result.error, conflictingChange: result.conflict },
    { status: result.status }
  )
}
```

**Step 3: Run the full admin route test file — all existing + new test pass.**

```bash
npx jest src/app/api/admin/changes/\\[id\\]/route.test.ts 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git commit -am "refactor(revert): admin endpoint delegates to lib/revert (fixes no-op CREATE_PERSON/ADD_RELATIONSHIP revert)"
```

---

## Task 10: TDD — `GET /api/person/[id]/my-changes`

**Files:**
- Create: `src/app/api/person/[id]/my-changes/route.ts`
- Create: `src/app/api/person/[id]/my-changes/route.test.ts`

**Step 1: Write failing tests**

- 401 anon.
- 200 with empty `{ createChange: null, relationshipChanges: [], updateChanges: [] }` when signed-in user has no changes on this person.
- 200 with populated structure when mock `read` returns a mix of change rows; assert correct split by `changeType`.
- Assert the query filters by `authorEmail = session.user.email` and `status = 'live'`.
- Assert relationshipChanges only include changes whose `newValue.unionId` is one of this person's unions (via the query's `WHERE` clause).

**Step 2: Implement the route.** Single Cypher query:
```cypher
MATCH (p:Person {gedcomId: $id})
OPTIONAL MATCH (p)-[:UNION]->(u:Union)
WITH p, collect(DISTINCT u.gedcomId) AS unionIds
MATCH (c:Change { status: 'live', authorEmail: $email })
WHERE
  (c.changeType = 'CREATE_PERSON'  AND c.targetId = p.gedcomId) OR
  (c.changeType = 'UPDATE_PERSON'  AND c.targetId = p.gedcomId) OR
  (c.changeType = 'ADD_RELATIONSHIP' AND
    apoc.convert.fromJsonMap(c.newValue).unionId IN unionIds)   -- OR equivalent JSON parse
RETURN c { .* } AS change
ORDER BY c.appliedAt DESC
```
If Aura doesn't have APOC, do the JSON parsing in Node: query ADD_RELATIONSHIP rows separately and filter in JS.

**Step 3-4:** Run tests; fail → pass.

**Step 5: Commit**

```bash
git commit -am "feat(revert): add GET /api/person/[id]/my-changes"
```

---

## Task 11: UI — delete-person button in PersonDrawer

**Files:**
- Modify: `src/components/FamilyTree.tsx`
- Create: `tests/e2e/revert-delete-person.spec.ts`

**Step 1: Write Playwright E2E test** (copy mock-auth pattern from `tests/e2e/add-spouse.spec.ts`):

Scenarios:
1. Button visible + clickable when `my-changes` returns a `createChange` AND the person detail has no parents/siblings/marriages. Click → confirm → drawer closes, `fetch` POST to `/api/changes/<id>/revert` observed.
2. Button disabled with tooltip when person has relationships.
3. Button absent when `createChange` is null.
4. 409 from the revert endpoint surfaces the `conflictingChange.detail` message in the drawer.

**Step 2: Run — test fails** (button doesn't exist).

**Step 3: Implement in `FamilyTree.tsx`**

- Add `useEffect` fetching `/api/person/<id>/my-changes` into a new `myChanges` state, re-running when `detailVersion` changes.
- In view mode, append a red "Delete this person" button after the existing action buttons. Shown only when `myChanges?.createChange`. Disabled when the detail has any parents, siblings, marriages, or children. Tooltip on disabled state.
- Click → `window.confirm('Delete <name>? This cannot be undone.')` → `fetch` POST; on 200 close drawer + trigger refresh of tree; on 409 setActionError with the `conflictingChange.detail`.

**Step 4: Run tests — pass.**

**Step 5: Commit**

```bash
git commit -am "feat(revert): add delete-person button to PersonDrawer"
```

---

## Task 12: UI — per-marriage × remove button

**Files:**
- Modify: `src/components/FamilyTree.tsx`
- Create: `tests/e2e/revert-remove-marriage.spec.ts`

**Step 1: Write Playwright E2E test.** Scenarios:

1. × icon visible only on marriages whose `unionId` appears in `myChanges.relationshipChanges`.
2. Click × → confirm → marriage disappears; POST to `/api/changes/<id>/revert` observed.
3. Mocked 409 surfaces the detail.

**Step 2: Fails.**

**Step 3: Implement.** Render a small button next to each `<li>` in `person-drawer-marriages`. Handler: `window.confirm` → POST → on 200 refetch both person detail and `my-changes`.

**Step 4-5:** Pass, commit.

```bash
git commit -am "feat(revert): add per-marriage remove button to PersonDrawer"
```

---

## Task 13: UI — "Your edits" list in edit mode

**Files:**
- Modify: `src/components/FamilyTree.tsx`
- Create: `tests/e2e/revert-edit-list.spec.ts`

**Step 1: Write E2E test.** Scenarios:

1. Edit mode shows a "Your edits to this person" section only when `myChanges.updateChanges.length > 0`; rows show changed fields + ISO timestamp + Revert.
2. Revert click → confirm → row disappears; POST observed.
3. Mocked 409 surfaces `conflictingChange.detail`.

**Step 2: Fails.**

**Step 3: Implement.** Inside the existing edit form, below the field inputs, render a collapsible `<section>` iterating `myChanges.updateChanges`. Each row: comma-joined list of keys in the change's `newValue`, `appliedAt` formatted short, Revert button.

**Step 4-5:** Pass, commit.

```bash
git commit -am "feat(revert): add Your Edits revert list in PersonDrawer edit mode"
```

---

## Task 14: Final verification + PR prep

**Step 1: Run the full test suite**

```bash
set -a; source .env.local; set +a
npx jest --silent 2>&1 | tail -3
```
Expected: the 16 pre-existing Neo4j-env failures; all new unit tests + route tests passing; total pass count higher than baseline by at least the number of new tests we added.

**Step 2: Run Playwright**

```bash
npx playwright test 2>&1 | tail -10
```
Expected: all existing E2E + three new revert specs pass.

**Step 3: Manual smoke check via dev server**

Start `npm run dev` on a free port (not 3000, which is in use). Visit `/?rootId=%40I506%40`, open Donald Grocott drawer, confirm:
- No delete button (he wasn't created by session user).
- No × next to marriages.
- No "Your edits" section in edit mode (no updates by session user).

Then sign in, create a test person via the existing add-relative flow, and confirm all three surfaces appear and function end-to-end. Don't leave test persons in prod Neo4j — revert them via the new button before finishing.

**Step 4: Push branch and open PR**

```bash
git push -u origin feature/revert-my-changes
gh pr create --title "feat: revert my own changes (CREATE_PERSON, ADD_RELATIONSHIP, UPDATE_PERSON)" \
  --body "$(cat <<'EOF'
## Summary
- New `POST /api/changes/[id]/revert` shared by authors and admins.
- New `GET /api/person/[id]/my-changes` for drawer surfaces.
- Three PersonDrawer surfaces: delete-person, per-marriage remove, Your Edits list.
- Extracts revert logic to `src/lib/revert.ts`; fixes admin no-op revert for CREATE_PERSON / ADD_RELATIONSHIP.

## Test plan
- [x] Unit: `src/lib/revert.test.ts` covers happy + block paths for all three change types.
- [x] Integration: route tests for `/api/changes/[id]/revert`, `/api/person/[id]/my-changes`, and refactored admin endpoint.
- [x] E2E: three new Playwright specs covering the drawer surfaces, including 409 conflict display.
- [x] Manual: dev-server verified against real Neo4j.

Design: `docs/plans/2026-04-23-revert-my-changes-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 5: Commit the plan itself**

```bash
git add docs/plans/2026-04-23-revert-my-changes.md
git commit -m "docs(revert): implementation plan"
```
