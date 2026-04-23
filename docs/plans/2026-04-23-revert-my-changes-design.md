# Revert My Changes — Design

**Goal:** Let a signed-in user undo changes they authored — `CREATE_PERSON`, `ADD_RELATIONSHIP`, `UPDATE_PERSON` — directly from the PersonDrawer, and fix the admin revert endpoint which currently no-ops for `CREATE_PERSON` and `ADD_RELATIONSHIP`.

**Feature branch:** `feature/revert-my-changes`

---

## Background

- The `Change` log (`src/lib/changes.ts`) records every mutation with `authorEmail`, `changeType`, `targetId`, `previousValue`, `newValue`, `status`.
- The admin page `/admin/changes` calls `POST /api/admin/changes/[id]` with `action='revert'`. That handler only applies real undo logic for `UPDATE_PERSON` (`SET p += $prevValue`); for `CREATE_PERSON` and `ADD_RELATIONSHIP` it just flips `status='reverted'` without undoing the graph mutation (`src/app/api/admin/changes/[id]/route.ts:88-92`).
- Admin role is determined by `ADMIN_EMAILS` env var (`src/auth.ts:27-34`). Locally: `stephen.grocott@gmail.com`.

---

## Scope

In:
- Authors can revert their own live `CREATE_PERSON` / `ADD_RELATIONSHIP` / `UPDATE_PERSON` changes.
- Admins can revert any live change using the same endpoint.
- Three UI entry points, all inside `PersonDrawer`.
- Real undo logic for all three change types, shared between the author endpoint and the admin endpoint.

Out:
- Granular field-level undo within a single `UPDATE_PERSON` (the change is the atomic unit).
- Bulk "undo all my edits" across persons.
- Time-limited undo windows.

---

## Authorization

One new endpoint, shared:

```
POST /api/changes/[id]/revert
```

Guard:

```ts
const change = await fetchChange(id)
if (!change)                   return 404
if (change.status !== 'live')  return 409  // already reverted/kept
const isAuthor = change.authorEmail === session.user.email
const isAdmin  = session.user.role === 'admin'
if (!isAuthor && !isAdmin)     return 403
```

The underlying revert logic lives in a new module `src/lib/revert.ts`. The existing admin endpoint (`src/app/api/admin/changes/[id]/route.ts`) is refactored to delegate to `src/lib/revert.ts`, which also fixes its broken `CREATE_PERSON` / `ADD_RELATIONSHIP` paths.

Response shape:
```ts
// success
{ success: true }
// failure
{ error: string, conflictingChange?: { kind: 'has-relationships' | 'union-touched' | 'field-updated-later', detail: string } }
```

---

## Revert semantics

### `CREATE_PERSON`
- **Block if** the Person has any `[:UNION]->()` or `[:CHILD]->()` edges.
- **Undo:** `DETACH DELETE` the Person.
- **Audit:** flip Change `status='reverted'`; also write a new `DELETE_PERSON` audit row with the reverter's email.

### `ADD_RELATIONSHIP`
`newValue = { type, targetId, unionId }` where `type ∈ {spouse, parent, child}`.

- **Block if** the Union has anything beyond the original shape:
  - `spouse`: union must have exactly 2 `UNION` edges, 0 `CHILD` edges.
  - `parent | child`: union must have exactly 1 `UNION` edge, 1 `CHILD` edge.
  - Any deviation → 409 with `conflictingChange.kind='union-touched'`.
- **Undo:** `DETACH DELETE` the Union node.
- **Audit:** flip Change `status='reverted'`.

### `UPDATE_PERSON`
- **Block if** any later live `UPDATE_PERSON` on the same Person touches any of the same `ALLOWED_PATCH_FIELDS` keys present in this change's `previousValue` → 409 with `conflictingChange.kind='field-updated-later'`.
- **Undo:** `SET p += $prevValue` for the fields present in `previousValue` (same shape as existing `src/app/api/admin/changes/[id]/route.ts:75-87`).
- **Audit:** flip Change `status='reverted'`.

---

## UI — PersonDrawer

### New read endpoint
```
GET /api/person/[id]/my-changes
```
Returns the signed-in user's live changes relevant to this person:
```ts
{
  createChange: Change | null,           // CREATE_PERSON targetId = this person
  relationshipChanges: Change[],         // ADD_RELATIONSHIP where newValue.unionId is one of this person's unions
  updateChanges: Change[]                // UPDATE_PERSON targetId = this person, newest first
}
```
Drawer calls this alongside the existing `GET /api/person/[id]` fetch. Keeps the detail endpoint lean.

### Surfaces (in `src/components/FamilyTree.tsx`)

1. **Delete button** — red *Delete this person* at drawer bottom, shown only when `createChange` is non-null.
   - Disabled (tooltip: "Has relationships — contact an admin") if the loaded person detail shows any parents, siblings, marriages, or children.
   - Click → confirm dialog → `POST /api/changes/<createChange.id>/revert`.
   - 200 → close drawer, drop the node from the tree, toast "Person deleted."
   - 409 → surface the `conflictingChange.detail` message.

2. **Per-marriage remove** — × next to each `<li>` inside `person-drawer-marriages`, visible only when that union's id is in `relationshipChanges`.
   - Click → confirm "Remove marriage to `<spouse name>`?" → revert → refetch person detail.

3. **Edit-mode "Your edits" list** — collapsible section inside the edit form, one row per `updateChanges` entry (newest first): changed fields, ISO timestamp, Revert button.
   - Hidden when list is empty.
   - Revert → confirm → refetch person detail + my-changes.

Failures surface the server error inline using the existing error-message pattern.

---

## Testing

### Unit — `src/lib/revert.test.ts`

| Case | Expected |
|---|---|
| `CREATE_PERSON` happy (isolated person) | `DETACH DELETE`, status `reverted` |
| `CREATE_PERSON` block (has UNION edge) | 409, `conflictingChange.kind='has-relationships'` |
| `ADD_RELATIONSHIP` spouse happy (2 UNION, 0 CHILD) | union deleted, status flipped |
| `ADD_RELATIONSHIP` parent/child happy (1 UNION, 1 CHILD) | union deleted, status flipped |
| `ADD_RELATIONSHIP` spouse block (CHILD added later) | 409, `kind='union-touched'` |
| `ADD_RELATIONSHIP` parent/child block (extra UNION or CHILD) | 409, `kind='union-touched'` |
| `UPDATE_PERSON` happy | `SET p += prevValue`, status flipped |
| `UPDATE_PERSON` block (later update on same field) | 409, `kind='field-updated-later'` |

### Integration — API routes

- `POST /api/changes/[id]/revert`: 401 anon, 403 non-admin on someone else's change, 200 author, 200 admin-on-others, 404 missing, 409 already reverted.
- `GET /api/person/[id]/my-changes`: filters by `authorEmail === session.user.email`, `status='live'` only, correctly split by changeType, only relationship changes whose `unionId` belongs to this person.
- Refactored admin endpoint passes existing tests unchanged — proves delegation to `src/lib/revert.ts`.

### E2E — `tests/e2e/my-reverts.spec.ts`

Mock-auth / mock-API pattern from `tests/e2e/add-spouse.spec.ts`.

1. Delete-person: button visible → confirm → drawer closes, node dropped.
2. Remove-marriage: × visible on my-added union only → confirm → marriage disappears.
3. Revert-edit: edit mode shows "Your edits" → per-row revert → list shrinks.
4. Block path: mocked 409 shows conflict detail, no state corruption.

### Regression

One test that the admin revert page still succeeds/409s consistently with the shared logic (i.e. the refactor didn't regress `/admin/changes`).

---

## File impact

New:
- `src/lib/revert.ts` — shared revert logic
- `src/lib/revert.test.ts`
- `src/app/api/changes/[id]/revert/route.ts` + test
- `src/app/api/person/[id]/my-changes/route.ts` + test
- `tests/e2e/my-reverts.spec.ts`

Edited:
- `src/app/api/admin/changes/[id]/route.ts` — delegate to `src/lib/revert.ts`
- `src/components/FamilyTree.tsx` — three new UI surfaces, my-changes fetch
- `src/lib/changes.ts` — extend to record `DELETE_PERSON` (no schema change; new changeType value)
- `src/app/admin/types.ts` — add `DELETE_PERSON` to the union

No schema change in Neo4j, no new properties, no migration required.
