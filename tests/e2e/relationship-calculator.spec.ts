import { test, expect } from '@playwright/test';

/**
 * E2E tests for the relationship calculator affordance in PersonDrawer (issue #162).
 *
 * Verifies:
 *   1. A non-root person's drawer shows a "How related to <root>?" button;
 *      clicking it fetches GET /api/relationship and renders a kinship label.
 *   2. The root person's own drawer does not show the control.
 *
 * Runs against the real dev server and seeded database (default root:
 * Irene Tunnicliffe), matching the pattern used by reroot-persistence.spec.ts.
 */

test.describe('relationship calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('family-tree-root-id');
    });
    await page.goto('/');
  });

  test('shows a kinship label for a non-root person', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toBeVisible({ timeout: 15_000 });
    await expect(toolbarViewing).toContainText('Irene', { timeout: 10_000 });

    // Root node has ring-amber-400 on its inner card; non-root nodes do not.
    const nonRootPersonNode = page
      .locator('.react-flow__node-person')
      .filter({ hasNot: page.locator('[class*="ring-amber"]') })
      .first();
    await expect(nonRootPersonNode).toBeVisible({ timeout: 10_000 });
    await nonRootPersonNode.click();

    const drawer = page.getByTestId('person-drawer');
    await expect(drawer).toBeVisible();

    const relationshipButton = page.getByTestId('person-drawer-relationship-button');
    await expect(relationshipButton).toBeVisible();
    await expect(relationshipButton).toContainText('How related to Irene');

    await relationshipButton.click();

    const relationshipResult = page.getByTestId('person-drawer-relationship-result');
    await expect(relationshipResult).toBeVisible({ timeout: 10_000 });
    const resultText = await relationshipResult.textContent();
    expect(resultText).toBeTruthy();
    expect(resultText).toContain('Irene');
  });

  test('does not render the control for the root person', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    const rootPersonNode = page
      .locator('.react-flow__node-person')
      .filter({ has: page.locator('[class*="ring-amber"]') })
      .first();
    await expect(rootPersonNode).toBeVisible({ timeout: 10_000 });
    await rootPersonNode.click();

    const drawer = page.getByTestId('person-drawer');
    await expect(drawer).toBeVisible();

    await expect(page.getByTestId('person-drawer-relationship-button')).toHaveCount(0);
  });
});
