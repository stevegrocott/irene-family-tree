import { test, expect } from '@playwright/test';

/**
 * E2E tests for generation bands (issue #194, design system §3.1).
 *
 * The layout already clusters person nodes into y-levels per generation
 * rank (`generationsFromLayout` in src/lib/layout.ts, exercised by
 * tests/e2e/no-node-overlap.spec.ts). This spec covers the three failure
 * modes called out in the issue's risk assessment that only show up in a
 * real, laid-out browser canvas:
 *
 *   1. Bands must align to node rows — a band offset by even a few pixels
 *      from the generation it represents looks broken (AC3, AC6).
 *   2. Bands must never intercept pointer events — clicking a person node
 *      through a band must still open the drawer (AC4).
 *   3. Sticky gutter labels must stay visible while the canvas is panned
 *      horizontally, since they're positioned against the viewport rather
 *      than canvas space (AC5).
 *
 * Contract assumed of the implementation (tasks 3-5 of this issue):
 *   - One element per generation rank with `data-testid="generation-band"`,
 *     spanning the full width of that rank's nodes.
 *   - One sticky gutter label per band with
 *     `data-testid="generation-band-label"`.
 */
test.describe('generation bands', () => {
  test.beforeEach(async ({ page }) => {
    // Seed the default root (Irene Tunnicliffe, multi-generation) explicitly so this
    // spec lands on the viewer canvas rather than the cold-start entry state (issue #232).
    await page.addInitScript(() => {
      localStorage.setItem('family-tree-root-id', '@I85@');
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('each generation band aligns with the y-level of its person nodes', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    const personNodes = page.locator('.react-flow__node-person');
    const nodeCount = await personNodes.count();
    expect(nodeCount).toBeGreaterThan(0);

    type BBox = { x: number; y: number; width: number; height: number };
    const nodeBoxes: BBox[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const box = await personNodes.nth(i).boundingBox();
      if (box) nodeBoxes.push(box);
    }
    expect(nodeBoxes.length).toBeGreaterThan(0);

    // Group nodes into y-levels using the same tolerance-band approach as
    // no-node-overlap.spec.ts, so "level" here means "generation rank".
    const Y_TOLERANCE = 10;
    const sortedByY = [...nodeBoxes].sort((a, b) => a.y - b.y);
    const levels: BBox[][] = [];
    for (const box of sortedByY) {
      const last = levels[levels.length - 1];
      if (last && Math.abs(box.y - last[0].y) <= Y_TOLERANCE) {
        last.push(box);
      } else {
        levels.push([box]);
      }
    }
    // The default tree spans multiple generations — otherwise this test
    // wouldn't exercise cross-band alignment at all.
    expect(levels.length).toBeGreaterThan(1);

    const bands = page.getByTestId('generation-band');
    const bandCount = await bands.count();
    expect(bandCount).toBeGreaterThan(0);

    const bandBoxes: BBox[] = [];
    for (let i = 0; i < bandCount; i++) {
      const box = await bands.nth(i).boundingBox();
      if (box) bandBoxes.push(box);
    }
    expect(bandBoxes.length).toBe(bandCount);

    // Every node-level must fall entirely within exactly one band's
    // vertical extent, and that band must be wide enough to cover the
    // horizontal span of every node it contains (AC1, AC3, AC6). A band
    // that's off by a rank, too short, or too narrow fails this loop.
    const matchedBandIndices = new Set<number>();
    for (const level of levels) {
      const levelTop = Math.min(...level.map(b => b.y));
      const levelBottom = Math.max(...level.map(b => b.y + b.height));
      const levelCenterY = (levelTop + levelBottom) / 2;

      const matchIndex = bandBoxes.findIndex(
        band => band.y <= levelCenterY && levelCenterY <= band.y + band.height,
      );
      expect(matchIndex, `no band found containing y-level centered at ${levelCenterY}`).toBeGreaterThanOrEqual(0);

      const band = bandBoxes[matchIndex];
      for (const node of level) {
        expect(node.x).toBeGreaterThanOrEqual(band.x - 1);
        expect(node.x + node.width).toBeLessThanOrEqual(band.x + band.width + 1);
      }

      matchedBandIndices.add(matchIndex);
    }

    // Distinct levels must map to distinct bands — two generations sharing
    // one (too-tall) band is exactly the drift bug this design prevents.
    expect(matchedBandIndices.size).toBe(levels.length);
  });

  test('clicking a person node through a band still opens the drawer', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    // Bands render behind edges/nodes (AC4). If a band intercepted pointer
    // events, Playwright's actionability check would fail this click
    // because the hit-tested element wouldn't be the node.
    const firstNode = page.locator('.react-flow__node-person').first();
    await expect(firstNode).toBeVisible();
    await firstNode.click();

    await expect(page.getByTestId('person-drawer')).toBeVisible({ timeout: 5_000 });
  });

  test('gutter labels stay put while the canvas is panned horizontally', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    const label = page.getByTestId('generation-band-label').first();
    await expect(label).toBeVisible();

    const referenceNode = page.locator('.react-flow__node-person').first();
    const [labelBoxBefore, nodeBoxBefore] = [
      await label.boundingBox(),
      await referenceNode.boundingBox(),
    ];
    expect(labelBoxBefore).not.toBeNull();
    expect(nodeBoxBefore).not.toBeNull();

    // Drag the canvas pane horizontally — this pans the tree the way a user
    // would, rather than reaching into React Flow's internal viewport state.
    const pane = page.locator('.react-flow__pane');
    const paneBox = await pane.boundingBox();
    expect(paneBox).not.toBeNull();
    if (!paneBox) return;

    const startX = paneBox.x + paneBox.width / 2;
    const startY = paneBox.y + paneBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 300, startY, { steps: 15 });
    await page.mouse.up();

    const [labelBoxAfter, nodeBoxAfter] = [
      await label.boundingBox(),
      await referenceNode.boundingBox(),
    ];
    expect(labelBoxAfter).not.toBeNull();
    expect(nodeBoxAfter).not.toBeNull();
    if (!labelBoxBefore || !nodeBoxBefore || !labelBoxAfter || !nodeBoxAfter) return;

    // The panned node must have actually moved — otherwise the drag gesture
    // didn't pan the canvas and the rest of this assertion is meaningless.
    const nodeDeltaX = Math.abs(nodeBoxAfter.x - nodeBoxBefore.x);
    expect(nodeDeltaX).toBeGreaterThan(50);

    // The gutter label is sticky to the viewport's left edge, so it should
    // have barely moved relative to the node it sits beside (AC5).
    const labelDeltaX = Math.abs(labelBoxAfter.x - labelBoxBefore.x);
    expect(labelDeltaX).toBeLessThan(10);

    await expect(label).toBeVisible();
  });
});
