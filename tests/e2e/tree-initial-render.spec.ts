import { test, expect, type Page } from '@playwright/test';

/**
 * Regression coverage for issue #218: loading the family tree at its
 * **default** hop depth (`DEFAULT_HOPS` = 60, ~370 person nodes after the
 * `MAX_NODES` cap) used to mount React Flow with no `defaultViewport`, i.e.
 * an implicit zoom of 1.0. `resolveLodVariant(1.0)` resolves to the `full`
 * variant (docs/DESIGN_SYSTEM.md §3.2), so every node mounted as an
 * expensive full-detail card on first paint, saturating the main thread
 * before the auto-fit effect could drop zoom to the cheap `dot` variant.
 *
 * The fix gives React Flow a low `defaultViewport` so first paint already
 * resolves to `dot`. This spec asserts that directly: at the default root,
 * `person-node-dot` nodes are present and `person-node-full` nodes are
 * never present — from the first sample through to the settled,
 * auto-fitted viewport.
 *
 * See also `tests/e2e/node-lod.spec.ts`, which covers the zoom-driven LOD
 * transitions themselves (dot -> compact -> full) and must keep passing
 * alongside this spec (AC5).
 */
test.describe('tree initial render at default root', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('family-tree-root-id');
    });
  });

  /**
   * Waits for the React Flow canvas transform to stop changing, i.e. for the
   * auto-fit effect's viewport animation to finish settling. Polling the
   * viewport's own `style` attribute avoids guessing at a fixed delay for
   * the fetch + 50ms defer + 300ms animation chain in `FamilyTree.tsx`.
   */
  async function waitForCanvasSettled(page: Page) {
    const viewport = page.locator('.react-flow__viewport');
    let previous: string | null = null;
    for (let i = 0; i < 30; i++) {
      const current = await viewport.getAttribute('style');
      if (current !== null && current === previous) return;
      previous = current;
      await page.waitForTimeout(150);
    }
    throw new Error('React Flow canvas transform never settled');
  }

  test('renders only dot-variant nodes on first paint, never full', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Capture LOD variant counts on the very first animation frame that any
    // person node exists in the DOM. Polling on `raf` (rather than relying
    // on Playwright's default ~100ms assertion retry interval) is essential
    // here: the auto-fit effect that would otherwise mask a `full` first
    // paint by dropping zoom doesn't run until a deferred `setTimeout(50)`,
    // so a coarser poll would only ever observe the already-corrected state
    // and miss the bug entirely.
    const firstPaintHandle = await page.waitForFunction(
      () => {
        const dot = document.querySelectorAll('[data-testid="person-node-dot"]').length;
        const compact = document.querySelectorAll('[data-testid="person-node-compact"]').length;
        const full = document.querySelectorAll('[data-testid="person-node-full"]').length;
        return dot + compact + full > 0 ? { dot, compact, full } : false;
      },
      undefined,
      { polling: 'raf', timeout: 15_000 },
    );
    const firstPaint = (await firstPaintHandle.jsonValue()) as { dot: number; compact: number; full: number };

    expect(firstPaint.full, 'no full-detail nodes on first paint').toBe(0);
    expect(firstPaint.dot, 'dot-variant nodes present on first paint').toBeGreaterThan(0);

    // Sanity-check we actually loaded the default root's real tree, not an
    // empty/error state that would trivially satisfy the counts above.
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    // The auto-fit effect subsequently frames the tree at MIN_ZOOM (0.18),
    // which also resolves to `dot` (AC3). Confirm the settled state agrees
    // too, so this isn't a first-paint-only assertion that regresses the
    // moment auto-fit runs.
    await waitForCanvasSettled(page);
    await expect(page.getByTestId('person-node-full')).toHaveCount(0);
    expect(await page.getByTestId('person-node-dot').count()).toBeGreaterThan(0);
  });
});
