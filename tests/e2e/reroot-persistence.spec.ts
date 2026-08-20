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

/**
 * Regression test for issue #307: reloading *immediately* after a re-root —
 * before waiting for any of the post-click UI settling the test above
 * deliberately waits on — must not revert the root back to Irene
 * Tunnicliffe.
 *
 * FamilyTree.tsx syncs the address bar via a synchronous
 * `window.history.replaceState` call specifically because the previous
 * `router.replace`-based implementation committed the URL asynchronously
 * (measured ~1.5s behind a re-root). A reload landing inside that gap saw
 * the *old* root still in the URL — even though the UI, and localStorage,
 * had already moved on — and initial focus resolution ranks the URL root
 * above the stored one, so the reload silently reverted the user's re-root.
 *
 * This test reproduces that "commit window" by calling `page.reload()`
 * directly after `click()` resolves, with no intervening `expect(...)`
 * polling that would otherwise give an async URL commit time to catch up
 * and mask the bug. It fails if `router.replace` is restored in place of
 * `window.history.replaceState`.
 */
test('re-root selection persists even when reload races the URL commit', async ({ page }) => {
  await page.goto('/');

  const toolbarViewing = page.getByTestId('toolbar-viewing');
  await expect(toolbarViewing).toBeVisible({ timeout: 15_000 });
  await expect(toolbarViewing).toContainText('Irene', { timeout: 10_000 });

  // Pick an on-screen non-root person node — see the comment on the same
  // lookup above for why a plain CSS `:not()` selector isn't sufficient.
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

  const drawer = page.getByTestId('person-drawer');
  await expect(drawer).toBeVisible();

  // Capture the target person's display name *before* re-rooting — after
  // the click below we reload immediately, with no wait for the toolbar to
  // reflect the new root, so we can't read the name back out of the
  // toolbar the way the "reload after settling" test above does.
  const targetName = (await drawer.locator('h2').first().textContent())?.trim();
  expect(targetName, 'expected the drawer header to show the target person\'s name').toBeTruthy();

  const rerootBtn = page.getByTestId('person-drawer-reroot');
  await expect(rerootBtn).toBeVisible();

  // Fire the re-root and reload back-to-back — deliberately no `await
  // expect(...)` between them. Any such wait polls (up to several seconds)
  // and would give an async URL commit (the pre-fix `router.replace`
  // behaviour) time to land, defeating the point of this test.
  await rerootBtn.click();
  await page.reload();

  // Wait for the tree to render again after reload
  await expect(toolbarViewing).toBeVisible({ timeout: 15_000 });

  // The reload must have landed on the newly chosen root, not reverted to
  // Irene Tunnicliffe.
  await expect(toolbarViewing).not.toContainText('Irene Tunnicliffe');
  await expect(toolbarViewing.locator('span').first()).toContainText(targetName!);
});
