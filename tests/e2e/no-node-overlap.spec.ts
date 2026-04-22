import { test, expect } from '@playwright/test';

/**
 * Verifies that no two person nodes overlap horizontally on the same vertical
 * level in the default family tree layout.
 *
 * Flow:
 *   1. Clear localStorage so the default root (Irene Tunnicliffe) is loaded.
 *   2. Wait for the tree to render with at least one person node visible.
 *   3. Collect bounding boxes for all person nodes.
 *   4. Group nodes into y-levels using a tolerance band (nodes within 10px
 *      vertically share the same level).
 *   5. Assert that within each level, no two nodes' x-ranges overlap.
 */
test.describe('no person node overlap', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('family-tree-root-id');
    });
    await page.goto('/');
  });

  test('no two person nodes overlap on the same y-level', async ({ page }) => {
    // Wait for toolbar to confirm the default root is loaded — stronger signal
    // than waiting for the first node, because the toolbar only renders after
    // the tree data is fetched and the dagre layout has been applied.
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    const personNodes = page.locator('.react-flow__node-person');
    const count = await personNodes.count();
    expect(count).toBeGreaterThan(0);

    // Collect bounding boxes for all person nodes
    type BBox = { x: number; y: number; width: number; height: number };
    const boxes: BBox[] = [];
    for (let i = 0; i < count; i++) {
      const box = await personNodes.nth(i).boundingBox();
      if (box) boxes.push(box);
    }

    expect(boxes.length).toBeGreaterThan(0);

    // Group nodes by y-level: nodes whose centres are within 10px of each
    // other share the same level. We use a simple greedy scan sorted by y.
    const Y_TOLERANCE = 10;
    const sorted = [...boxes].sort((a, b) => a.y - b.y);
    const levels: BBox[][] = [];

    for (const box of sorted) {
      const last = levels[levels.length - 1];
      if (last && Math.abs(box.y - last[0].y) <= Y_TOLERANCE) {
        last.push(box);
      } else {
        levels.push([box]);
      }
    }

    // Within each level, assert no two x-ranges overlap
    for (const level of levels) {
      // Sort by x so we only need to compare adjacent pairs
      const byX = [...level].sort((a, b) => a.x - b.x);
      for (let i = 0; i < byX.length - 1; i++) {
        const current = byX[i];
        const next = byX[i + 1];
        const currentRight = current.x + current.width;
        // next.x must be >= currentRight for no overlap
        expect(next.x).toBeGreaterThanOrEqual(currentRight);
      }
    }
  });
});
