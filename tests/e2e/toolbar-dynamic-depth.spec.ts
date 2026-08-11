import { test, expect } from '@playwright/test';

/**
 * Verifies that the toolbar depth stepper's enforced upper bound reflects the
 * actual maximum generation depth of the visible tree nodes rather than a
 * hardcoded constant, and that the person count label is visible with a
 * non-zero count.
 *
 * The depth control is a "− n +" stepper (`toolbar-depth-stepper` /
 * `toolbar-depth-value` / `toolbar-depth-increment` / `toolbar-depth-decrement`),
 * not an `<input type="range">` slider — there is no `max` attribute to read.
 * The bound is only observable indirectly, via the increment button's
 * `disabled` state (`FamilyTree` passes `sliderMax={actualMaxDepth}` and the
 * stepper disables "+" once `hops >= sliderMax`).
 *
 * `actualMaxDepth` is recomputed from whatever tree data is currently fetched,
 * and that fetch is itself capped at `hops` generations (`*1..hops*` in the
 * Cypher query). So probing the bound by incrementing up from a low `hops`
 * value doesn't work: the fetch would be capped at that same low value,
 * `actualMaxDepth` would recompute to match it, and "+" would look disabled
 * regardless of the tree's true depth. Landing on the bound from *above* —
 * decrementing down from the default `hops` (large enough that the fetch is
 * never depth-capped) to the depth read off the gen-up/gen-down labels —
 * avoids that: the fetch stays uncapped for every step of the descent, so
 * `actualMaxDepth` stays pinned to the tree's true depth throughout, and the
 * final disabled check is a genuine assertion rather than a tautology.
 *
 * Flow:
 *   1. Seed localStorage with the default root (Irene Tunnicliffe) so the spec
 *      lands on the viewer canvas rather than the cold-start entry state (issue #232).
 *   2. Wait for the toolbar to render.
 *   3. Read the gen-up and gen-down generation depths from the toolbar labels.
 *   4. Compute the actual max generation depth as max(genUp, genDown).
 *   5. Click the decrement button down from the current (default) depth value
 *      to that computed max, one hop at a time, approaching from above.
 *   6. Assert the depth value shows the computed max and the increment button
 *      is disabled there — if the bound were still a hardcoded constant
 *      instead of the computed depth, "+" would remain enabled.
 *   7. Assert the gen-up label is visible with a non-zero count.
 */
test.describe('toolbar dynamic depth', () => {
  test.beforeEach(async ({ page }) => {
    // Seed the default root (Irene Tunnicliffe) explicitly so this spec lands on
    // the viewer canvas rather than the cold-start entry state (issue #232).
    await page.addInitScript(() => {
      localStorage.setItem('family-tree-root-id', '@I85@');
    });
    await page.goto('/');
  });

  test('depth stepper increment bound equals actual max generation depth from visible nodes', async ({ page }) => {
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
    const actualMaxDepth = Math.max(1, genUp, genDown);

    const decrementBtn = page.getByTestId('toolbar-depth-decrement');
    const incrementBtn = page.getByTestId('toolbar-depth-increment');
    const depthValue = page.getByTestId('toolbar-depth-value');

    const startHopsText = await depthValue.textContent();
    const startHops = Number(startHopsText ?? '0');

    // Walk the depth down to the computed bound one hop at a time, approaching
    // from above so the tree fetch is never depth-capped along the way (see
    // file header for why that direction matters).
    for (let hops = startHops; hops > actualMaxDepth; hops -= 1) {
      await decrementBtn.click();
    }
    await expect(depthValue).toHaveText(String(actualMaxDepth));

    // Bound reached: incrementing further must be blocked by the actual tree
    // depth, not a hardcoded constant like MAX_HOPS.
    await expect(incrementBtn).toBeDisabled();
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
