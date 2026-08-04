import { test, expect, type Page } from '@playwright/test'
import { encode } from '@auth/core/jwt'

/**
 * E2E coverage for the admin review-card diff treatment (issue #214, task 1
 * — the Playwright spec `#200`/PR #213 shipped the treatment without).
 *
 * Verifies, against a mocked change with a real before/after diff:
 *   AC1 — a changed field's "before" value renders struck through and is
 *         visually distinct from the "after" value (not colour alone: the
 *         before side also loses its underline/strike when empty, so a
 *         genuinely struck-through cell proves it holds real content).
 *   AC2 — a field with no prior value renders "(none)", italic, rather than
 *         a blank cell or a dash.
 *   AC4 — the fixture driving these assertions carries at least one field
 *         with both a before AND an after value, so the test cannot pass
 *         against a fixture too thin to express a real diff.
 *
 * Target surface: the "Change History" tab (`ChangeHistory.tsx`), not
 * "Pending Suggestions" (`SuggestionsReview.tsx`). Per #214's own "Files
 * affected" list, both components render the diff with byte-identical
 * `FieldDiff` markup/classes — but only Change History's data arrives via a
 * client-side fetch to `/api/admin/changes` that Playwright can mock.
 * Pending Suggestions' data is a server component prop computed directly
 * from Neo4j (`src/app/admin/page.tsx`), which hardcodes
 * `previousValue: null` for every suggestion; nothing in the suggestion
 * creation path (`POST /api/suggestions`) ever stores a previous value
 * either, so no live-Neo4j fixture could express AC4 on that surface
 * without a production code change, which is out of scope for this test
 * task. Change History's diff treatment — verified here — is the same
 * treatment in practice.
 *
 * Task 2 (below) covers AC3: clicking "View in tree" — which only exists on
 * the Pending Suggestions card (`SuggestionsReview.tsx`), not Change
 * History — navigates to the tree and re-roots it on that person. Because
 * that surface's data is a server-rendered Neo4j read rather than a
 * client-side fetch, it can't be driven by a `page.route` mock the way the
 * diff tests above are. Rather than depending on live, seeded database
 * state (fragile, and blocked in this environment by an unrelated,
 * pre-existing bug where `admin/page.tsx`'s paginated Neo4j query throws —
 * see the PR/commit description), it uses the same override-hook approach
 * `admin-review.spec.ts` documents for the admin page's Neo4j-backed props:
 * `SuggestionsReview.tsx` exposes a test-only `window.__setSuggestions`
 * setter (a no-op in production) that the spec calls after mount to inject
 * a synthetic fixture, then drives the resulting navigation through the
 * real "View in tree" link.
 */

async function adminSessionToken(): Promise<string> {
  return encode({
    token: {
      name: 'E2E Admin',
      email: 'admin@test.com',
      picture: null,
      sub: 'e2e-admin-001',
      role: 'admin',
    },
    secret: process.env.AUTH_SECRET ?? 'e2e-test-auth-secret',
    salt: 'authjs.session-token',
  })
}

async function setAdminCookie(context: import('@playwright/test').BrowserContext) {
  const token = await adminSessionToken()
  await context.addCookies([{
    name: 'authjs.session-token',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }])
}

// birthPlace exercises AC1/AC4: a field with both a before and an after
// value. occupation exercises AC2: an empty "before" side paired with a
// real "after" value.
const mockChange = {
  id: 'e2e-diff-001',
  changeType: 'UPDATE_PERSON',
  targetId: '@I900@',
  personName: 'Rosalind Franklin',
  authorName: 'Francis Crick',
  authorEmail: 'francis@example.com',
  previousValue: { birthPlace: 'London, England', occupation: '' },
  newValue: { birthPlace: 'Paris, France', occupation: 'Chemist' },
  appliedAt: new Date(Date.now() - 3_600_000).toISOString(),
  status: 'live',
}

async function mockChangesRoute(page: Page) {
  await page.route(/\/api\/admin\/changes/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ changes: [mockChange] }),
    })
  )
}

/** Navigates to /admin and switches to the Change History tab. */
async function openChangeHistoryTab(page: Page) {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' })

  const historyTab = page.getByRole('tab', { name: /change history/i })
  await expect(historyTab).toBeVisible()

  // The tab button exists in the server-rendered markup before React
  // hydration attaches its click handler, so a click that lands during that
  // window is a no-op. Retry the click until the panel is actually visible
  // instead of guessing at a fixed hydration delay.
  const panel = page.getByTestId('change-history')
  await expect(async () => {
    await historyTab.click()
    await expect(panel).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  return panel
}

test.describe('Admin diff treatment (/admin, Change History)', () => {
  test.beforeEach(async ({ context }) => {
    await setAdminCookie(context)
  })

  test('a changed field shows the before value struck through and a visually distinct after value', async ({ page }) => {
    await mockChangesRoute(page)
    const panel = await openChangeHistoryTab(page)

    const before = panel.getByText('London, England', { exact: true })
    const after = panel.getByText('Paris, France', { exact: true })
    await expect(before).toBeVisible()
    await expect(after).toBeVisible()

    // AC1 — the before value is struck through; the after value is not.
    await expect(before).toHaveCSS('text-decoration-line', 'line-through')
    await expect(after).not.toHaveCSS('text-decoration-line', 'line-through')

    // AC1 — before/after sit on visually distinct backgrounds (declined-soft
    // vs approved-soft), so the distinction isn't carried by strikethrough
    // alone.
    const [beforeBg, afterBg] = await Promise.all([
      before.evaluate(el => getComputedStyle(el).backgroundColor),
      after.evaluate(el => getComputedStyle(el).backgroundColor),
    ])
    expect(beforeBg).not.toBe(afterBg)
  })

  test('an empty before value renders "(none)" in italics rather than a blank or dash', async ({ page }) => {
    await mockChangesRoute(page)
    const panel = await openChangeHistoryTab(page)

    // AC2 — the empty "occupation before" cell renders the literal text
    // "(none)", italicised, instead of a blank cell or a dash.
    const emptyBefore = panel.getByText('(none)', { exact: true })
    await expect(emptyBefore).toBeVisible()
    await expect(emptyBefore).toHaveCSS('font-style', 'italic')

    // The paired "after" value for that same field is real and rendered
    // distinctly — the empty-state treatment applies only to the empty side.
    await expect(panel.getByText('Chemist', { exact: true })).toBeVisible()
  })
})

// ── Task 2: "View in tree" navigation (AC3) ─────────────────────────────────

/**
 * A synthetic person used both as the suggestion's target and as the sole
 * node the mocked tree canvas serves. A synthetic fixture (rather than a
 * real, currently-seeded person) keeps this test deterministic and
 * independent of live database content — the same reasoning `deep-links
 * .spec.ts`'s `mockCanvas()` documents for the rest of this directory.
 */
const VIEW_IN_TREE_TARGET = {
  gedcomId: '@IVIEWTREE001@',
  name: 'Percival Hawthorne',
  sex: 'M',
  birthYear: '1901',
  deathYear: '1975',
  birthPlace: 'York, England',
  deathPlace: null,
  occupation: null,
  notes: null,
}

const viewInTreeSuggestion = {
  id: 'e2e-view-in-tree-001',
  changeType: 'UPDATE_PERSON',
  targetId: VIEW_IN_TREE_TARGET.gedcomId,
  personName: VIEW_IN_TREE_TARGET.name,
  authorName: 'E2E Suggester',
  authorEmail: 'suggester@example.com',
  previousValue: null,
  newValue: { birthPlace: 'A Suggested Birthplace' },
  appliedAt: new Date(Date.now() - 3_600_000).toISOString(),
  status: 'pending',
}

/**
 * Mocks the tree canvas endpoints so that following the "View in tree" link
 * lands on a real, verifiable render of VIEW_IN_TREE_TARGET rather than
 * depending on live Neo4j content. Mirrors `deep-links.spec.ts`'s
 * `mockCanvas()`.
 */
async function mockCanvasForTarget(page: Page) {
  await page.route(/\/api\/persons/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([VIEW_IN_TREE_TARGET]),
    })
  )

  await page.route(/\/api\/tree\//, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        nodes: [
          {
            id: `node-${VIEW_IN_TREE_TARGET.gedcomId}`,
            type: 'person',
            data: { ...VIEW_IN_TREE_TARGET, isRoot: true, generation: 0 },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      }),
    })
  )

  await page.route(/\/api\/person\//, route => {
    const url = route.request().url()
    if (url.includes('/my-changes')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ createChange: null, relationshipChanges: [], updateChanges: [] }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ parents: [], siblings: [], marriages: [] }),
    })
  })
}

test.describe('"View in tree" navigation (Pending Suggestions tab)', () => {
  test.beforeEach(async ({ context, page }) => {
    await setAdminCookie(context)
    await mockCanvasForTarget(page)
  })

  test('clicking "View in tree" navigates to the tree and re-roots it on that person', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })

    // Pending Suggestions is the default active tab — no tab click needed.
    const panel = page.getByTestId('suggestions-review')
    await expect(panel).toBeVisible({ timeout: 15_000 })

    // SuggestionsReview's card data is a server component prop read
    // directly from Neo4j (src/app/admin/page.tsx), not a client-side
    // fetch, so it can't be driven by `page.route` the way the diff tests
    // above drive Change History. Inject the fixture via the component's
    // test-only `window.__setSuggestions` override once it has mounted
    // (retried via `toPass` since the hook attaches in a post-mount effect).
    await expect(async () => {
      const applied = await page.evaluate((suggestion) => {
        const setter = (window as unknown as { __setSuggestions?: (s: unknown[]) => void }).__setSuggestions
        if (!setter) return false
        setter([suggestion])
        return true
      }, viewInTreeSuggestion)
      expect(applied).toBe(true)
    }).toPass({ timeout: 15_000 })

    // The link's aria-label ("View <person> in tree") is its accessible
    // name and is more specific than the shared "View in tree" visible
    // text, so this can't accidentally match a different pending card.
    const viewInTreeLink = page.getByRole('link', {
      name: `View ${VIEW_IN_TREE_TARGET.name} in tree`,
      exact: true,
    })
    await expect(viewInTreeLink).toBeVisible({ timeout: 10_000 })

    await viewInTreeLink.click()

    // AC3 — asserted on resulting page state (URL + rendered root), not on
    // the link's href, so a broken click handler or a dead route fails the
    // test even though the href itself looked correct.
    const targetIdEncoded = encodeURIComponent(VIEW_IN_TREE_TARGET.gedcomId)
    await expect(page).toHaveURL(new RegExp(`root=${targetIdEncoded}`), { timeout: 10_000 })

    const toolbarViewing = page.getByTestId('toolbar-viewing')
    await expect(toolbarViewing).toBeVisible({ timeout: 15_000 })
    await expect(toolbarViewing).toContainText(VIEW_IN_TREE_TARGET.name, { timeout: 10_000 })
  })
})
