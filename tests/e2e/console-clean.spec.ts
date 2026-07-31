import { test, expect } from '@playwright/test';

/**
 * Verifies that loading the family tree does not emit React Flow's
 * "nodeTypes/edgeTypes recreated" console warning (error #002).
 *
 * That warning fires whenever `nodeTypes` / `edgeTypes` are given a new
 * object identity on every render, which forces React Flow to tear down
 * and remount every node in the tree. See issue #182.
 *
 * Flow:
 *   1. Attach a console listener before navigating, so warnings emitted
 *      during the very first render (including React strict-mode's double
 *      mount) are captured.
 *   2. Clear localStorage so the default root (Irene Tunnicliffe) is loaded.
 *   3. Wait for the toolbar to confirm the tree has actually rendered.
 *   4. Assert no captured console message is prefixed with "[React Flow]".
 */
test.describe('console clean on tree load', () => {
  test('no [React Flow] console warnings on tree load', async ({ page }) => {
    const reactFlowMessages: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[React Flow]')) {
        reactFlowMessages.push(text);
      }
    });

    await page.addInitScript(() => {
      localStorage.removeItem('family-tree-root-id');
    });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Wait for toolbar to confirm the default root is loaded — stronger
    // signal than waiting for the first node, because the toolbar only
    // renders after the tree data is fetched and the dagre layout applied.
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    // Wait for a person node to render, then give any late console warnings
    // (e.g. from a second strict-mode render pass) a brief settling window
    // before asserting.
    await expect(page.locator('.react-flow__node-person').first()).toBeVisible();
    await page.waitForTimeout(250);

    expect(reactFlowMessages).toEqual([]);
  });
});
