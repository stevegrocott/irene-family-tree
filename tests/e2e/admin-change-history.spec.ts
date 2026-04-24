import { test, expect } from '@playwright/test'
import { encode } from '@auth/core/jwt'

/**
 * E2E tests for AdminTabs + ChangeHistory (issue #120).
 *
 * Covers:
 *   1. Switching from the "Pending Suggestions" tab to "Change History" renders the panel.
 *   2. Change cards are rendered with person name and author.
 *   3. Successful revert shows the "Reverted" badge and disables the button.
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

const mockHistoryChange = {
  id: 'e2e-history-001',
  changeType: 'UPDATE_PERSON',
  targetId: '@I002@',
  personName: 'Grace Hopper',
  authorName: 'Alan Turing',
  authorEmail: 'alan@example.com',
  previousValue: { firstName: 'Grace' },
  newValue: { firstName: 'Amazing Grace' },
  appliedAt: new Date(Date.now() - 7_200_000).toISOString(),
  status: 'live',
}

test.describe('Admin Tabs + Change History (/admin)', () => {
  test.beforeEach(async ({ context }) => {
    await setAdminCookie(context)
  })

  test('tab switch renders the Change History panel', async ({ page }) => {
    await page.route(/\/api\/admin\/changes/, route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ changes: [] }),
      })
    })

    await page.goto('/admin')
    await page.waitForLoadState('networkidle')

    // Initially the Suggestions tab is active; Change History panel is absent.
    const historyTab = page.getByRole('tab', { name: /change history/i })
    await expect(historyTab).toBeVisible()

    await historyTab.click()

    await expect(page.getByTestId('change-history')).toBeVisible()
  })

  test('change history renders change cards with person name and author', async ({ page }) => {
    await page.route(/\/api\/admin\/changes/, route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ changes: [mockHistoryChange] }),
      })
    })

    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    await page.getByRole('tab', { name: /change history/i }).click()

    await expect(page.getByTestId('change-history')).toBeVisible()
    await expect(page.getByText(mockHistoryChange.personName)).toBeVisible()
    await expect(page.getByText(mockHistoryChange.authorName)).toBeVisible()
  })

  test('revert success shows Reverted badge and disables the revert button', async ({ page }) => {
    await page.route(/\/api\/admin\/changes/, async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ changes: [mockHistoryChange] }),
        })
      }
    })

    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    await page.getByRole('tab', { name: /change history/i }).click()

    await expect(page.getByTestId('change-history')).toBeVisible()
    await expect(page.getByText(mockHistoryChange.personName)).toBeVisible()

    const revertBtn = page.getByRole('button', { name: 'Revert' })
    await expect(revertBtn).toBeEnabled()
    await revertBtn.click()

    // Badge "Reverted" appears alongside the change-type badge.
    const revertedBadge = page.locator('span', { hasText: /^Reverted$/ })
    await expect(revertedBadge).toBeVisible({ timeout: 5_000 })

    // The button is now disabled and its label changes to "Reverted".
    await expect(page.getByRole('button', { name: 'Reverted' })).toBeDisabled()
  })
})
