import { test, expect } from '@playwright/test';

/**
 * Verifies that the toolbar depth slider's max attribute reflects the actual
 * maximum generation depth of the visible tree nodes rather than a hardcoded
 * constant, and that the person count label is visible with a non-zero count.
 *
 * Flow:
 *   1. Clear localStorage so the default root (Irene Tunnicliffe) is loaded.
 *   2. Wait for the toolbar to render.
 *   3. Read the ancestor and descendant generation depths from the toolbar labels.
 *   4. Compute the actual max generation depth as max(ancestors, descendants).
 *   5. Assert the slider `max` attribute equals that computed depth.
 *   6. Assert the ancestors label is visible with a non-zero count.
 */
test.describe('toolbar dynamic depth', () => {
  test.beforeEach(async ({ page }) => {
    // Clear stored root so the default (Irene Tunnicliffe) is used
    await page.addInitScript(() => {
      localStorage.removeItem('family-tree-root-id');
    });
    await page.goto('/');
  });

  test('slider max equals actual max generation depth from visible nodes', async ({ page }) => {
    // Wait for toolbar to confirm default root is Irene Tunnicliffe
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    // The toolbar computes:
    //   ancestors  = Math.abs(Math.min(...negative generations))
    //   descendants = Math.max(...positive generations)
    // These represent the actual max generation depths in each direction.
    const ancestorCountEl = page.getByTestId('toolbar-ancestors').locator('span').first();
    const descendantCountEl = page.getByTestId('toolbar-descendants').locator('span').first();

    const ancestorText = await ancestorCountEl.textContent();
    const descendantText = await descendantCountEl.textContent();

    const ancestors = Number(ancestorText ?? '0');
    const descendants = Number(descendantText ?? '0');
    const actualMaxDepth = Math.max(ancestors, descendants);

    // Slider max must equal the actual tree depth, not a hardcoded constant like MAX_HOPS (16)
    const slider = page.getByTestId('toolbar-depth-slider');
    const sliderMax = await slider.getAttribute('max');
    expect(Number(sliderMax)).toBe(actualMaxDepth);
  });

  test('personCount label is visible showing a non-zero number', async ({ page }) => {
    // Wait for the toolbar to appear (personCount > 0 is the render precondition)
    await expect(page.getByTestId('toolbar')).toBeVisible({ timeout: 15_000 });

    // The ancestors span holds the visible person count for ancestor generations
    const ancestorCountEl = page.getByTestId('toolbar-ancestors').locator('span').first();
    await expect(ancestorCountEl).toBeVisible();

    const countText = await ancestorCountEl.textContent();
    expect(Number(countText)).toBeGreaterThan(0);
  });
});
