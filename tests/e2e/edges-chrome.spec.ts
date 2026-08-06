import { test, expect } from '@playwright/test';
import { PERSON_W, UNION_W } from '@/lib/layout';

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
    // Seed the default root (Irene Tunnicliffe, multi-generation) explicitly so this
    // spec lands on the viewer canvas rather than the cold-start entry state (issue #232).
    await page.addInitScript(() => {
      localStorage.setItem('family-tree-root-id', '@I85@');
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
        // Resolve the `marker-end` reference itself rather than just checking
        // attribute presence: a stale/dangling `url(#id)` reference (pointing
        // at a `<marker>` def that was never rendered, e.g. removed from
        // ReactFlow's SVG defs) would still satisfy an attribute-presence
        // check while drawing no arrowhead at all. Only count it as an
        // arrowhead if the id actually resolves to a `<marker>` element.
        const markerEnd = path?.getAttribute('marker-end') ?? null;
        const markerId = markerEnd?.match(/url\(["']?#([^"')]+)["']?\)/)?.[1] ?? null;
        const markerEl = markerId ? document.getElementById(markerId) : null;
        results.push({
          isStep: edge.classList.contains('react-flow__edge-step'),
          hasArrowhead: markerEl?.tagName.toLowerCase() === 'marker',
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

/**
 * E2E coverage for issue #219 task 5 (union nodes must not drift from their
 * parents on screen, so a parent -> union edge never sweeps under an
 * unrelated same-rank person and reads as belonging to them — the John
 * Grocott / Stephen Grocott misreading described in issue #219).
 *
 * Contract asserted here (produced by `applyDagreLayout`'s post-layout pass,
 * issue #219 task 2): after layout, every union node's on-screen centre x
 * lies within the horizontal span defined by the centre x of its parent
 * person node(s) — the source(s) of its incoming `UNION` edges (person ->
 * union, per `src/constants/tree.ts`). A union with a single known parent
 * in view is aligned to that parent's centre x, which this test covers as
 * the degenerate (zero-width) case of the same span check.
 *
 * Parent/union relationships are derived the same way the descent-edge test
 * above does: React Flow stamps every edge `<g>` with
 * `aria-label="Edge from {source} to {target}"`, and every node `<g>` with
 * `data-id="{id}"` plus a `.react-flow__node-{type}` class. A `UNION` edge
 * is identified structurally as person (source) -> union (target).
 */
test.describe('union marker horizontal positioning (issue #219)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('family-tree-root-id');
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test("every union marker's centre x lies within the horizontal span of its parent person nodes", async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    const unionCount = await page.locator('.react-flow__node-union').count();
    expect(unionCount).toBeGreaterThan(0);

    type UnionSpanCheck = { unionId: string; unionCenterX: number; parentCenterXs: number[] };

    const checks: UnionSpanCheck[] = await page.evaluate(({ PERSON_W, UNION_W }) => {
      const nodeType = (id: string): string | null => {
        const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (!el) return null;
        if (el.classList.contains('react-flow__node-union')) return 'union';
        if (el.classList.contains('react-flow__node-person')) return 'person';
        return null;
      };
      // Person and union nodes render collapsed "dot" variants below certain zoom
      // thresholds (issue #218 — a person node is a fixed 10px dot below zoom 0.45;
      // a union node is *always* rendered as a fixed ~6px dot, at every zoom level).
      // Reading `getBoundingClientRect()` therefore measures the size/position of
      // whichever LOD symbol happens to be painted, not the position `applyDagreLayout`
      // (src/lib/layout.ts) actually computed — and person vs. union dots differ in
      // size, so their rendered centres drift apart even when the underlying layout
      // is correctly centred. React Flow always stamps a node's *layout* position (the
      // top-left corner used to size/centre it, independent of the LOD symbol currently
      // drawn inside it) as `transform: translate(Xpx, Ypx)` on the node element, so
      // read that directly instead. PERSON_W/UNION_W are passed in from src/lib/layout.ts
      // (see the page.evaluate call site) — the widths `applyDagreLayout` centred nodes against.
      const centerX = (id: string): number | null => {
        const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (!el) return null;
        const style = el.getAttribute('style') ?? '';
        const match = style.match(/translate\(\s*(-?[\d.]+)px/);
        if (!match) return null;
        const left = parseFloat(match[1]);
        const width = el.classList.contains('react-flow__node-union') ? UNION_W : PERSON_W;
        return left + width / 2;
      };

      // UNION edges: person (source, parent) -> union (target). Collect every
      // parent id per union from the edge aria-labels.
      const parentsByUnion = new Map<string, string[]>();
      document.querySelectorAll('.react-flow__edge').forEach((edge) => {
        const ariaLabel = edge.getAttribute('aria-label') ?? '';
        const match = ariaLabel.match(/^Edge from (.+) to (.+)$/);
        if (!match) return;
        const [, sourceId, targetId] = match;
        if (nodeType(sourceId) !== 'person' || nodeType(targetId) !== 'union') return;
        const existing = parentsByUnion.get(targetId) ?? [];
        existing.push(sourceId);
        parentsByUnion.set(targetId, existing);
      });

      const results: { unionId: string; unionCenterX: number; parentCenterXs: number[] }[] = [];
      document.querySelectorAll('.react-flow__node-union').forEach((unionEl) => {
        const unionId = unionEl.getAttribute('data-id');
        if (!unionId) return;
        const unionCenterX = centerX(unionId);
        if (unionCenterX === null) return;
        const parentIds = parentsByUnion.get(unionId) ?? [];
        const parentCenterXs = parentIds
          .map((id) => centerX(id))
          .filter((x): x is number => x !== null);
        results.push({ unionId, unionCenterX, parentCenterXs });
      });
      return results;
    }, { PERSON_W, UNION_W });

    // A union node can be rendered with no parent person node in view at all
    // (its parent(s) sit outside the current hop-depth radius, e.g. a root's
    // own union going further up the tree) — there is no span to check for
    // those, so they're excluded. Assert this is the rare exception, not the
    // rule, so the check below still exercises the overwhelming majority of
    // union markers on screen.
    expect(checks.length).toBe(unionCount);
    const checkable = checks.filter((c) => c.parentCenterXs.length > 0);
    expect(checkable.length).toBeGreaterThan(0);
    expect(checkable.length).toBeGreaterThan(checks.length * 0.9);

    // `applyDagreLayout` (src/lib/layout.ts) solves each rank as a whole
    // (`resolveRankXs`): a union that would collide with a same-rank neighbour
    // displaces that neighbour rather than being pushed off its own parents' span,
    // so the span holds exactly. This carried a 50px tolerance while the pass
    // placed one union at a time and had to trade the span away under collision
    // pressure (issue #236); that drift no longer exists, so the tolerance is now
    // only float/`transform`-string rounding.
    //
    // `resolveRankXs` does have one documented residual case — unions whose parent
    // spans overlap and are each narrower than UNION_W + NODE_GAP cannot all stay in
    // span without moving the *person* rank above, so it relaxes the span rather than
    // let nodes overlap. That case is covered by unit tests in src/lib/layout.test.ts,
    // and does not arise in this view: measured across the default tree it is 0px.
    // If it ever does arise here, that is a real regression signal, not noise.
    const TOLERANCE_PX = 1;
    for (const { unionId, unionCenterX, parentCenterXs } of checkable) {
      const minParentX = Math.min(...parentCenterXs);
      const maxParentX = Math.max(...parentCenterXs);
      expect(
        unionCenterX,
        `union ${unionId} centre x (${unionCenterX}) should be >= its leftmost parent's centre x (${minParentX})`,
      ).toBeGreaterThanOrEqual(minParentX - TOLERANCE_PX);
      expect(
        unionCenterX,
        `union ${unionId} centre x (${unionCenterX}) should be <= its rightmost parent's centre x (${maxParentX})`,
      ).toBeLessThanOrEqual(maxParentX + TOLERANCE_PX);
    }
  });
});

/**
 * E2E coverage for issue #198 task 6 (design system §3.6 — minimap and
 * controls take the solid `--ft-surface-0` chrome treatment, and the
 * minimap marks the current root person with the `--ft-brass` accent).
 */
test.describe('minimap and controls chrome (issue #198)', () => {
  test.beforeEach(async ({ page }) => {
    // Seed the default root (Irene Tunnicliffe) explicitly so this spec lands on
    // the viewer canvas rather than the cold-start entry state (issue #232).
    await page.addInitScript(() => {
      localStorage.setItem('family-tree-root-id', '@I85@');
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('minimap and controls panels use the solid surface chrome treatment', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    const minimapStyle = await page.locator('[data-testid="rf__minimap"]').getAttribute('style');
    expect(minimapStyle).toContain('var(--ft-surface-0)');
    expect(minimapStyle).toContain('var(--ft-border)');
    expect(minimapStyle).toContain('var(--ft-r-md)');

    const controlsStyle = await page.locator('[data-testid="rf__controls"]').getAttribute('style');
    expect(controlsStyle).toContain('var(--ft-surface-0)');
    expect(controlsStyle).toContain('var(--ft-border)');
    expect(controlsStyle).toContain('var(--ft-r-md)');

    // Assert the rendered/computed style too — a stale `!important` rule in globals.css
    // can win over the inline style above and leave the panel translucent/blurred.
    const controlsComputed = await page.locator('[data-testid="rf__controls"]').evaluate((el) => {
      const style = getComputedStyle(el);
      return { backdropFilter: style.backdropFilter, backgroundColor: style.backgroundColor };
    });
    expect(controlsComputed.backdropFilter).toBe('none');
    expect(controlsComputed.backgroundColor).not.toBe('rgba(255, 255, 255, 0.08)');
  });

  test('minimap marks exactly the root person node with the brass accent color', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    const minimapNodes = page.locator('.react-flow__minimap-node');
    const nodeCount = await minimapNodes.count();
    expect(nodeCount).toBeGreaterThan(1);

    const fills = await minimapNodes.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('fill')));
    const rootFills = fills.filter((fill) => fill === 'var(--ft-brass)');
    const otherFills = fills.filter((fill) => fill === 'var(--ft-edge)');

    expect(rootFills).toHaveLength(1);
    expect(otherFills).toHaveLength(nodeCount - 1);
  });
});
