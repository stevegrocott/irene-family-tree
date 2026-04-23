import { test, expect } from '@playwright/test';

/**
 * Verifies that the toolbar depth slider's max attribute reflects the actual
 * maximum generation depth of the visible tree nodes rather than a hardcoded
 * constant, and that the person count label is visible with a non-zero count.
 *
 * Flow:
 *   1. Clear localStorage so the default root (Irene Tunnicliffe) is loaded.
 *   2. Wait for the toolbar to render.
 *   3. Read the gen-up and gen-down generation depths from the toolbar labels.
 *   4. Compute the actual max generation depth as max(genUp, genDown).
 *   5. Assert the slider `max` attribute equals that computed depth.
 *   6. Assert the gen-up label is visible with a non-zero count.
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
    //   genUp   = Math.abs(Math.min(...negative generations))
    //   genDown = Math.max(...positive generations)
    // These represent the actual max generation depths in each direction.
    const genUpCountEl = page.getByTestId('toolbar-gen-up').locator('span').first();
    const genDownCountEl = page.getByTestId('toolbar-gen-down').locator('span').first();

    const genUpText = await genUpCountEl.textContent();
    const genDownText = await genDownCountEl.textContent();

    const genUp = Number(genUpText ?? '0');
    const genDown = Number(genDownText ?? '0');
    const actualMaxDepth = Math.max(genUp, genDown);

    // Slider max must equal the actual tree depth, not a hardcoded constant like MAX_HOPS (16)
    const slider = page.getByTestId('toolbar-depth-slider');
    const sliderMax = await slider.getAttribute('max');
    expect(Number(sliderMax)).toBe(actualMaxDepth);
  });

  test('personCount label is visible showing a non-zero number', async ({ page }) => {
    // Wait for the toolbar to appear (personCount > 0 is the render precondition)
    await expect(page.getByTestId('toolbar')).toBeVisible({ timeout: 15_000 });

    const personCountEl = page.getByTestId('toolbar-person-count').locator('span').first();
    await expect(personCountEl).toBeVisible();

    const countText = await personCountEl.textContent();
    expect(Number(countText)).toBeGreaterThan(0);
  });
});
