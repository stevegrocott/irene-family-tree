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
  //
  // Root node's inner card has a `border-brass` class (see PersonNode.tsx
  // `borderClass`); non-root nodes use `border-line` instead. A plain
  // `.filter({ hasNot: ... }).first()` isn't enough on its own though: this
  // tree renders 370 nodes and `FamilyTree`'s initial `fitView` only brings a
  // fraction of them on-screen (the rest sit outside the browser viewport,
  // unreachable by a real click, even though they're valid DOM matches). Pick
  // the first candidate that is both genuinely non-root AND actually on-screen.
  const nonRootDataId = await page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node-person'))
    for (const node of nodes) {
      const isRoot = !!node.querySelector('[class*="border-brass"]')
      if (isRoot) continue
      const rect = node.getBoundingClientRect()
      const onScreen = rect.width > 0 && rect.top >= 0 && rect.left >= 0 && rect.bottom <= vh && rect.right <= vw
      if (onScreen) return node.getAttribute('data-id')
    }
    return null
  })
  expect(nonRootDataId, 'expected at least one on-screen non-root person node').toBeTruthy()

  const nonRootPersonNode = page.locator(`.react-flow__node[data-id="${nonRootDataId}"]`)
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
