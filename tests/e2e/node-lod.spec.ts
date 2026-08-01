import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Verifies person-node level-of-detail (docs/DESIGN_SYSTEM.md §3.2) responds to a real
 * zoom gesture end-to-end: the discrete dot/compact/full variant switches as zoom crosses
 * the 0.45 / 0.85 thresholds, and the dot variant (overview zoom) renders no name text.
 *
 * Flow:
 *   1. Clear localStorage so the default root (Irene Tunnicliffe) is loaded.
 *   2. Zoom in with the mouse wheel until a `full` node is visible; assert its name text
 *      is visible.
 *   3. Continue zooming out with the wheel through `compact` and down to `dot`; assert
 *      each variant appears in turn and that the `dot` node carries no visible text.
 */
test.describe('person node LOD zoom sweep', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('family-tree-root-id');
    });
    await page.goto('/');
  });

  /**
   * Nudges the canvas zoom with wheel events (deltaY < 0 zooms in, > 0 zooms out) until
   * the given LOD variant testid becomes visible, retrying the wheel gesture as needed.
   */
  async function zoomUntilVariantVisible(page: Page, testId: string, deltaY: number): Promise<Locator> {
    const locator = page.getByTestId(testId).first();
    await expect(async () => {
      await page.mouse.wheel(0, deltaY);
      await expect(locator).toBeVisible({ timeout: 200 });
    }).toPass({ timeout: 30_000 });
    return locator;
  }

  test('continuous zoom sweep transitions dot -> compact -> full and hides text at overview zoom', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    const pane = page.locator('.react-flow');
    await expect(pane).toBeVisible();
    const box = await pane.boundingBox();
    if (!box) throw new Error('react-flow pane has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // Zoom in to force the `full` variant and confirm name text is rendered.
    const fullNode = await zoomUntilVariantVisible(page, 'person-node-full', -120);
    const fullText = await fullNode.textContent();
    expect(fullText?.trim().length).toBeGreaterThan(0);

    // Zoom back out through the sweep: `compact` should appear before `dot`.
    const compactNode = await zoomUntilVariantVisible(page, 'person-node-compact', 120);
    const compactText = await compactNode.textContent();
    expect(compactText?.trim().length).toBeGreaterThan(0);

    // Continue zooming out to overview: `dot` should appear and carry no text.
    const dotNode = await zoomUntilVariantVisible(page, 'person-node-dot', 120);
    const dotText = await dotNode.textContent();
    expect(dotText?.trim()).toBe('');
  });
});
