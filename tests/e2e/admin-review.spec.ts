import { test, expect } from '@playwright/test'
import { encode } from '@auth/core/jwt'

/**
 * E2E tests for the Admin Changes Review page (issue #55).
 *
 * Verifies:
 *   1. Unauthenticated visitors are redirected to the sign-in flow.
 *   2. Authenticated admin users reach /admin and see the page heading.
 *   3. When the change queue is empty, the empty-state message is shown.
 *   4. A change card displays the person name and field-diff description.
 *   5. Clicking "Revert" POSTs to /api/admin/changes/[id] with action:"revert".
 *   6. The card is removed from the queue after a successful revert.
 *
 * Auth: tests in the "with admin session" group create a properly signed
 * NextAuth v5 JWT using the same AUTH_SECRET the dev server uses
 * (`e2e-test-auth-secret` when AUTH_SECRET is not set in the environment),
 * then inject it as the `authjs.session-token` cookie so the middleware
 * treats the request as an authenticated admin.
 *
 * Data: the admin page server component reads pending changes directly from
 * Neo4j. Tests that require change cards on the page stub the
 * `/api/admin/changes` client-side endpoint AND use an injected initial-prop
 * override; see the individual test comments for details.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Mock data ────────────────────────────────────────────────────────────────

const mockChange = {
  id: 'e2e-change-001',
  changeType: 'UPDATE_PERSON',
  targetId: '@I001@',
  personName: 'Ada Lovelace',
  authorName: 'Charles Babbage',
  authorEmail: 'charles@example.com',
  previousValue: { birthPlace: 'London, England' },
  newValue: { birthPlace: 'Marylebone, London' },
  appliedAt: new Date(Date.now() - 3_600_000).toISOString(),
  status: 'live',
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Admin Changes Review (/admin)', () => {
  // ── Unauthenticated guard ──────────────────────────────────────────────────

  test('unauthenticated visitor is redirected to sign-in', async ({ page }) => {
    await page.route(/accounts\.google\.com/, r =>
      r.fulfill({ status: 200, contentType: 'text/html', body: '<html>stub</html>' })
    )
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    const url = page.url()
    expect(
      /\/api\/auth\/signin/.test(url) || /accounts\.google\.com/.test(url),
      `expected sign-in redirect, got ${url}`
    ).toBe(true)
  })

  // ── Authenticated admin ────────────────────────────────────────────────────

  test.describe('with admin session cookie', () => {
    test.beforeEach(async ({ context }) => {
      await setAdminCookie(context)
    })

    test('renders the Pending Changes heading', async ({ page }) => {
      await page.goto('/admin')
      await expect(page.getByRole('heading', { name: /pending changes/i })).toBeVisible()
    })

    test('shows empty-queue message when no changes are pending', async ({ page }) => {
      // The admin server component catches Neo4j errors and falls back to an
      // empty list, exercising the empty-state branch in ChangesReview.
      await page.goto('/admin')
      await expect(page.getByText(/no pending changes to review/i)).toBeVisible()
    })

    test('displays change card with field diff, Revert button POSTs, card is removed', async ({ page }) => {
      // Stub the revert API — called client-side by ChangesReview.handleAction.
      let revertPostedId: string | null = null
      await page.route(/\/api\/admin\/changes\/[^/]+$/, async route => {
        if (route.request().method() === 'POST') {
          const urlParts = route.request().url().split('/')
          revertPostedId = decodeURIComponent(urlParts[urlParts.length - 1])
          const body = await route.request().postDataJSON() as { action?: string }
          if (body?.action === 'revert') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ success: true }),
            })
          }
        }
        return route.continue()
      })

      await page.goto('/admin')

      // The server component reads Neo4j directly; without a live database the
      // page renders with an empty list. Use page.evaluate to inject the mock
      // change into the React component state so the remaining assertions can
      // verify card rendering and client-side interactions.
      await page.waitForLoadState('networkidle')
      await page.evaluate((change) => {
        // Walk the React fiber tree to find ChangesReview's first useState hook
        // (the `changes` state) and dispatch an update with the mock record.
        function findDispatch(node: Element | null): ((v: unknown) => void) | null {
          if (!node) return null
          const fiberKey = Object.keys(node).find(k => k.startsWith('__reactFiber$'))
          if (!fiberKey) return null
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let fiber: any = (node as any)[fiberKey]
          while (fiber) {
            if (fiber.memoizedState?.queue?.dispatch &&
                Array.isArray(fiber.memoizedState.memoizedState)) {
              return fiber.memoizedState.queue.dispatch
            }
            fiber = fiber.return
          }
          return null
        }
        // The ChangesReview root is the div.space-y-4 or the empty-state div.
        const root = document.querySelector('[class*="space-y-4"], [class*="flex-col"]')
        if (!root) return
        const dispatch = findDispatch(root)
        if (dispatch) dispatch([change])
      }, mockChange)

      // Verify card content.
      await expect(page.getByText(mockChange.personName)).toBeVisible({ timeout: 3_000 })

      // describeChange should produce "Updated birth place: London, England → Marylebone, London"
      await expect(
        page.getByText(/updated birth place.*London.*Marylebone/i)
      ).toBeVisible()

      // Contributor line.
      await expect(page.getByText(mockChange.authorName)).toBeVisible()

      // Click Revert and verify POST was made with the correct id and action.
      const revertBtn = page.getByRole('button', { name: /revert/i }).first()
      await expect(revertBtn).toBeVisible()
      await revertBtn.click()

      // Card is removed from the queue.
      await expect(page.getByText(mockChange.personName)).not.toBeVisible({ timeout: 5_000 })
      expect(revertPostedId).toBe(mockChange.id)
    })

    test('Revert API blocks requests that lack an admin session', async ({ request }) => {
      // The `request` fixture does not carry the session cookie, so the
      // middleware should reject the call with 401 or 403.
      const res = await request.post('/api/admin/changes/nonexistent-id', {
        data: { action: 'revert' },
      })
      expect([401, 403]).toContain(res.status())
    })
  })
})
