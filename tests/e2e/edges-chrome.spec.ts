import { test, expect } from '@playwright/test';

/**
 * E2E coverage for issue #198 task 5 (design system §3.4/§3.6 — descent
 * edges render as orthogonal `step` paths, and edge labels never appear).
 *
 * Contract assumed of the implementation (tasks 1-4 of this issue):
 *   - CHILD edges (union -> person, i.e. "descent" edges, orientation
 *     settled in #180/#186) get ReactFlow's `step` edge type, so their SVG
 *     path is built from straight (M/L) segments only — no bezier curve
 *     ("C") command — and render without an arrowhead marker.
 *   - Edge labels are never rendered. React Flow's built-in `EdgeText`
 *     component returns `null` for a falsy `label` (see
 *     @reactflow/core), so this is checked structurally — no
 *     `.react-flow__edge-text` node exists at all — not merely hidden by
 *     CSS or by zoom level.
 *
 * Descent edges are identified without duplicating server-side relationship
 * logic: React Flow stamps every edge `<g>` with
 * `aria-label="Edge from {source} to {target}"`, and every node `<g>` with
 * `data-id="{id}"` plus a `.react-flow__node-{type}` class. An edge is a
 * descent edge iff its source resolves to a union node and its target
 * resolves to a person node.
 */
test.describe('edges rendering (issue #198)', () => {
  test.beforeEach(async ({ page }) => {
    // Clear stored root so the default (Irene Tunnicliffe, multi-generation) is used
    await page.addInitScript(() => {
      localStorage.removeItem('family-tree-root-id');
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('descent edges render as orthogonal step paths with no arrowhead', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    const edgeCount = await page.locator('.react-flow__edge').count();
    expect(edgeCount).toBeGreaterThan(0);

    type DescentEdgeInfo = { isStep: boolean; hasArrowhead: boolean; d: string | null };

    const descentEdges: DescentEdgeInfo[] = await page.evaluate(() => {
      const nodeType = (id: string): string | null => {
        const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (!el) return null;
        if (el.classList.contains('react-flow__node-union')) return 'union';
        if (el.classList.contains('react-flow__node-person')) return 'person';
        return null;
      };

      const results: { isStep: boolean; hasArrowhead: boolean; d: string | null }[] = [];
      document.querySelectorAll('.react-flow__edge').forEach((edge) => {
        const ariaLabel = edge.getAttribute('aria-label') ?? '';
        const match = ariaLabel.match(/^Edge from (.+) to (.+)$/);
        if (!match) return;
        const [, sourceId, targetId] = match;
        // Descent edge: union -> person (settled orientation, #180/#186).
        if (nodeType(sourceId) !== 'union' || nodeType(targetId) !== 'person') return;

        const path = edge.querySelector('.react-flow__edge-path');
        results.push({
          isStep: edge.classList.contains('react-flow__edge-step'),
          hasArrowhead: !!path?.getAttribute('marker-end'),
          d: path?.getAttribute('d') ?? null,
        });
      });
      return results;
    });

    // Sanity check: the default tree has multiple generations (per
    // no-node-overlap.spec.ts), so there must be at least one descent edge
    // to actually exercise this assertion.
    expect(descentEdges.length).toBeGreaterThan(0);

    for (const edge of descentEdges) {
      expect(edge.isStep).toBe(true);
      expect(edge.hasArrowhead).toBe(false);
      expect(edge.d).not.toBeNull();
      // A step path is drawn from straight segments only (M/L/Z commands).
      // A "C" command would mean the edge fell back to a bezier/smoothstep
      // curve instead of the required orthogonal routing.
      expect(edge.d).not.toMatch(/[Cc]/);
    }
  });

  test('no edge labels render at any zoom level', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    expect(await page.locator('.react-flow__edge').count()).toBeGreaterThan(0);

    // React Flow's EdgeText component renders nothing at all when `label`
    // is falsy, so this checks the label is structurally absent — not
    // merely hidden by CSS — at the default zoom level.
    await expect(page.locator('.react-flow__edge-text')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge-textwrapper')).toHaveCount(0);

    // Zoom in via the on-canvas controls; label suppression must not be a
    // zoom-dependent behaviour that only happens to hold at the default zoom.
    const zoomIn = page.getByLabel('zoom in');
    for (let i = 0; i < 5; i++) {
      await zoomIn.click();
    }
    await expect(page.locator('.react-flow__edge-text')).toHaveCount(0);

    // Zoom back out past the default level too.
    const zoomOut = page.getByLabel('zoom out');
    for (let i = 0; i < 10; i++) {
      await zoomOut.click();
    }
    await expect(page.locator('.react-flow__edge-text')).toHaveCount(0);
  });
});
