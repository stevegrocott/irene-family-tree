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

/**
 * Max acceptable duration (ms) of any single `longtask` while a zoom-control
 * click burst drives the canvas through its LOD threshold crossings (issue
 * #274, guarding the issue #271 `useDeferredValue` fix).
 *
 * **Why a long task and not a frame gap.** The deleted #271 probe measured max
 * rAF gap *under `Emulation.setCPUThrottlingRate: 6`* and could not separate
 * the arms (fixed 2197-2782ms vs reverted 2103-3654ms -- overlapping), which
 * is why it was removed rather than retuned. The throttling was the problem:
 * it inflates every frame, so the signal drowns in noise. Measured
 * **unthrottled** on the real ~370-node default root, the arms separate
 * cleanly and the single largest long task is the sharpest discriminator --
 * it isolates the one synchronous full-tree commit the fix exists to break up,
 * rather than summing unrelated work the way total blocking time does.
 *
 * **Observed, `npm run dev`, 15 zoom-in clicks at 120ms, 5 runs per arm,
 * headless (how the suite runs):**
 *
 * | arm      | max long task | max rAF gap | total blocking |
 * |----------|---------------|-------------|----------------|
 * | fixed    | 227-241ms     | 227-241ms   | 322-333ms      |
 * | reverted | 372-391ms     | 377-396ms   | 485-526ms      |
 *
 * Headed runs agree (fixed 183-305ms, reverted 366-420ms) but are noisier;
 * total blocking time overlaps across arms and is therefore NOT used.
 *
 * 300ms sits between the two headless populations with ~60ms of margin on the
 * fixed side and ~70ms on the reverted side. AC2 was demonstrated by running
 * this test both ways, not asserted: it passes on `main` and fails with
 * `lodVariant` resubscribed to raw `zoom`.
 *
 * **Scope, stated plainly:** this guards the *mechanism* (one oversized
 * synchronous commit per threshold crossing), not the 45s total-unresponsiveness
 * symptom from #271's manual repro -- that did not reproduce here in either
 * arm, headed or headless, at any point. A revert is caught because it moves
 * this number from ~230ms to ~380ms, not because the tab freezes.
 */
const MAX_ZOOM_BURST_LONG_TASK_MS = 300;

/** Zoom-in clicks in the burst; #271's manual repro stalled after 7 and after 12. */
const ZOOM_BURST_CLICKS = 15;

/** Delay between clicks (ms) -- fast enough to queue commits back-to-back. */
const ZOOM_BURST_CLICK_DELAY_MS = 120;
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
   * mutation"): met by the pre-fit assertion below. React Flow applies
   * `defaultViewport` on its very first render, whereas the auto-fit effect
   * in `FamilyTree.tsx` is deferred (50ms) and then animates (300ms) -- so
   * the mount zoom is observable before the fit overwrites it. Reading it
   * *after* `waitForCanvasSettled()` is what made an earlier version of this
   * test mutation-blind: by then every run has converged on `MIN_ZOOM`
   * whatever `defaultViewport` said. Removing `defaultViewport` leaves React
   * Flow's implicit zoom of 1.0 at mount, which this assertion catches.
   */
  test('wheel zoom and depth stepper remain interactive at DEFAULT_HOPS', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // AC2: sample the mount zoom before the auto-fit effect can overwrite it.
    // Waiting on the viewport element rather than on `toolbar-viewing` keeps
    // this inside the pre-fit window -- the toolbar only fills in once the
    // tree fetch resolves, which is already past the 50ms defer.
    await expect(page.locator('.react-flow__viewport')).toBeAttached({ timeout: 15_000 });
    expect(
      await readCanvasZoom(page),
      'mount zoom should come from defaultViewport, not React Flow\'s implicit 1.0',
    ).toBeCloseTo(MIN_ZOOM, 5);

    // Load the real default-root tree -- DEFAULT_HOPS = 60, the heaviest
    // configuration in issue #218 (~370 person nodes after the MAX_NODES
    // cap) -- and let the auto-fit effect settle before probing interactivity.
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

  /**
   * Issue #274: the regression guard #271 shipped without.
   *
   * Drives the documented repro -- a rapid zoom-control click burst on the
   * real ~370-node default root -- and asserts no single main-thread task
   * exceeds {@link MAX_ZOOM_BURST_LONG_TASK_MS}. See that constant for the
   * per-arm measurements the threshold comes from and for what this does and
   * does not guard.
   *
   * The observer is installed *after* the canvas settles, so the initial
   * render's own long tasks (which dwarf anything the burst produces) stay out
   * of the sample.
   */
  test('a zoom-control click burst commits without an oversized main-thread task', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () => document.querySelectorAll('.react-flow__node-person').length > 0,
      undefined,
      { timeout: 30_000 }
    );
    await waitForCanvasSettled(page);

    // The burst's cost comes from swapping LOD variant across the whole tree,
    // so the guard is only meaningful with the full node set actually mounted.
    const nodeCount = await page.locator('.react-flow__node-person').count();
    expect(nodeCount, 'guard needs the full default-root tree to be meaningful').toBeGreaterThan(
      300
    );

    const measurement = await page.evaluate(
      async ({ clicks, delayMs }) => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const longTasks: number[] = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration));
        });
        observer.observe({ entryTypes: ['longtask'] });

        const zoomIn = document.querySelector<HTMLButtonElement>('.react-flow__controls-zoomin');
        if (!zoomIn) throw new Error('no zoom-in control on the canvas');

        for (let i = 0; i < clicks; i++) {
          zoomIn.click();
          await sleep(delayMs);
        }
        // Let the last crossing's commit land before reading the sample.
        await sleep(3000);
        observer.disconnect();

        return {
          maxLongTask: longTasks.length ? Math.max(...longTasks) : 0,
          longTaskCount: longTasks.length,
        };
      },
      { clicks: ZOOM_BURST_CLICKS, delayMs: ZOOM_BURST_CLICK_DELAY_MS }
    );

    // A burst that never changed zoom would pass the assertion vacuously.
    expect(await readCanvasZoom(page), 'burst must actually have zoomed in').toBeGreaterThan(
      MIN_ZOOM
    );
    expect(
      measurement.longTaskCount,
      'no long tasks at all means the observer never sampled the burst'
    ).toBeGreaterThan(0);
    expect(
      measurement.maxLongTask,
      `largest main-thread task during the zoom burst (${measurement.longTaskCount} long tasks); ` +
        'a revert of the #271 useDeferredValue fix moves this to ~380ms'
    ).toBeLessThan(MAX_ZOOM_BURST_LONG_TASK_MS);
  });
});
