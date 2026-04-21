import { test, expect } from '@playwright/test';

/**
 * Verifies that the re-root selection persists across a full page reload.
 *
 * Flow:
 *   1. Load the page — default root is Irene Tunnicliffe.
 *   2. Wait for the tree to render.
 *   3. Click a non-root person node to open the PersonDrawer.
 *   4. Click the "FOCUS TREE ON …" re-root button.
 *   5. Confirm the toolbar VIEWING label updates to the new person.
 *   6. Reload the page.
 *   7. Assert the toolbar still shows the chosen person, not Irene Tunnicliffe.
 */
test('re-root selection persists after page reload', async ({ page }) => {
  await page.goto('/');

  // Wait for the tree to render — toolbar shows the current root
  const toolbarViewing = page.getByTestId('toolbar-viewing');
  await expect(toolbarViewing).toBeVisible({ timeout: 15_000 });
  await expect(toolbarViewing).toContainText('Irene', { timeout: 10_000 });

  // Click a non-root person node.
  // Root node has ring-amber-400 on its inner card; non-root nodes do not.
  const nonRootPersonNode = page
    .locator('.react-flow__node-person')
    .filter({ hasNot: page.locator('[class*="ring-amber"]') })
    .first();
  await expect(nonRootPersonNode).toBeVisible({ timeout: 10_000 });
  await nonRootPersonNode.click();

  // Wait for the PersonDrawer to open
  const drawer = page.getByTestId('person-drawer');
  await expect(drawer).toBeVisible();

  // Click the re-root button for the selected person
  const rerootBtn = page.getByTestId('person-drawer-reroot');
  await expect(rerootBtn).toBeVisible();
  await rerootBtn.click();

  // Drawer closes and toolbar updates to show the new root
  await expect(drawer).not.toBeVisible({ timeout: 5_000 });
  await expect(toolbarViewing).not.toContainText('Irene', { timeout: 10_000 });

  // Capture the new root name from the inner span of the toolbar
  const newRootName = await toolbarViewing.locator('span').first().textContent();
  expect(newRootName).toBeTruthy();

  // Reload the page
  await page.reload();

  // Wait for the tree to render again after reload
  await expect(toolbarViewing).toBeVisible({ timeout: 15_000 });

  // Assert the chosen person (not Irene Tunnicliffe) is still shown
  await expect(toolbarViewing).not.toContainText('Irene Tunnicliffe');
  await expect(toolbarViewing.locator('span').first()).toContainText(newRootName!);
});
