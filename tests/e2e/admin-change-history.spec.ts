import { test, expect } from '@playwright/test'
import { setAdminCookie } from './helpers/admin-auth'

/**
 * E2E tests for AdminTabs + ChangeHistory (issue #120).
 *
 * Covers:
 *   1. Switching from the "Pending Suggestions" tab to "Change History" renders the panel.
 *   2. Change cards are rendered with person name and author.
 *   3. Successful revert shows the "Reverted" badge and disables the button.
 */

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

  test('revert conflict (409) shows inline error message', async ({ page }) => {
    await page.route(/\/api\/admin\/changes/, async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Cannot revert: conflicting change exists.' }),
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

    await expect(page.getByText('Cannot revert: conflicting change exists.')).toBeVisible({ timeout: 5_000 })
    await expect(revertBtn).toBeEnabled()
  })
})
