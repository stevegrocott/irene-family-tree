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
/** Mirrors the `MIN_ZOOM` the auto-fit effect in `FamilyTree.tsx` frames at. */
const MIN_ZOOM = 0.18;

test.describe('tree initial render at default root', () => {
  test.beforeEach(async ({ page }) => {
    // Seed the default root (Irene Tunnicliffe) explicitly so this spec lands on
    // the viewer canvas rather than the cold-start entry state (issue #232).
    await page.addInitScript(() => {
      localStorage.setItem('family-tree-root-id', '@I85@');
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

  /**
   * Reads the canvas' current zoom out of the React Flow viewport transform
   * (`translate(x, y) scale(z)`), so AC3's exact-value requirement can be
   * asserted rather than inferred from the LOD variant it produces.
   */
  async function readCanvasZoom(page: Page) {
    const style = await page.locator('.react-flow__viewport').getAttribute('style');
    const scale = style?.match(/scale\(([\d.]+)\)/);
    if (!scale) throw new Error(`no scale() in viewport transform: ${style}`);
    return Number(scale[1]);
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

    // AC3 is specific about the value, not just its LOD consequence: both
    // auto-fit branches in `FamilyTree.tsx` (fit-to-bounds and the
    // too-large-to-fit root fallback) frame the tree at exactly MIN_ZOOM.
    expect(await readCanvasZoom(page)).toBeCloseTo(MIN_ZOOM, 5);
  });

  /**
   * AC1 ("loads and remains interactive at DEFAULT_HOPS"): this test does
   * NOT guard the #218 renderer-freeze regression -- investigation under
   * #221 found the freeze doesn't reproduce under Playwright (the same
   * unfixed build that hard-froze real Chrome ran to completion here). What
   * it checks instead is that the wheel gesture and depth stepper each
   * produce a real, state-sensitive effect. Guarding the freeze itself needs
   * a CDP CPU-throttling environment or manual verification in a real
   * browser.
   *
   * AC2 ("with `defaultViewport` removed, this test fails -- verified by
   * mutation"): NOT met, and cannot be as worded. `zoomBefore` below is read
   * after `waitForCanvasSettled()`, by which point the auto-fit effect in
   * `FamilyTree.tsx` has already forced the viewport to `MIN_ZOOM`
   * regardless of the initial `defaultViewport` (mutation-verified). The
   * only assertion in this spec that's genuinely mutation-sensitive to
   * `defaultViewport` is `renders only dot-variant nodes on first paint,
   * never full` above (AC5). Sign-off to relax AC2 to reflect that is
   * requested on #221 and still pending as of this commit.
   */
  test('wheel zoom and depth stepper remain interactive at DEFAULT_HOPS', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Load the real default-root tree -- DEFAULT_HOPS = 60, the heaviest
    // configuration in issue #218 (~370 person nodes after the MAX_NODES
    // cap) -- and let the auto-fit effect settle before probing.
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });
    await waitForCanvasSettled(page);

    const pane = page.locator('.react-flow');
    await expect(pane).toBeVisible();
    const box = await pane.boundingBox();
    if (!box) throw new Error('react-flow pane has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // Drive a real zoom-in gesture with the mouse wheel -- the same input a
    // user would send -- and confirm it actually changes the viewport zoom.
    // Reading the zoom before and after ties the assertion to the gesture's
    // *effect* rather than to ambient state that could already satisfy it:
    // a `full`-variant node visibility check used to pass here even when the
    // page was not processing input at all, because in the unfixed world
    // (`defaultViewport` removed) ~370 full-detail nodes are already in the
    // DOM before the first wheel event lands (issue #221). Comparing against
    // the captured baseline -- rather than a hard-coded target value --
    // keeps this robust to exactly how far a given wheel tick zooms.
    const zoomBefore = await readCanvasZoom(page);
    await expect(async () => {
      await page.mouse.wheel(0, -120);
      expect(await readCanvasZoom(page)).not.toBeCloseTo(zoomBefore, 5);
    }).toPass({ timeout: 30_000 });

    // Confirm the rest of the UI -- not just the canvas -- is still taking
    // input: the depth stepper should update on click.
    const depthValue = page.getByTestId('toolbar-depth-value');
    const before = await depthValue.textContent();
    await page.getByTestId('toolbar-depth-decrement').click();
    await expect(depthValue).not.toHaveText(before ?? '', { timeout: 5_000 });
  });
});
