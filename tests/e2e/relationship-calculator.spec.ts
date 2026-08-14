import { test, expect } from '@playwright/test';

/**
 * E2E tests for the relationship calculator affordance in PersonDrawer (issue #162).
 *
 * Verifies:
 *   1. A non-root person's drawer shows a "How related to <root>?" button;
 *      clicking it fetches GET /api/relationship and renders a kinship label.
 *   2. The root person's own drawer does not show the control.
 *
 * Runs against the real dev server and seeded database (default root:
 * Irene Tunnicliffe), matching the pattern used by reroot-persistence.spec.ts.
 */

test.describe('relationship calculator', () => {
  test.beforeEach(async ({ page }) => {
    // Seed the default root (Irene Tunnicliffe) explicitly so this spec lands on
    // the viewer canvas rather than the cold-start entry state (issue #232).
    await page.addInitScript(() => {
      localStorage.setItem('family-tree-root-id', '@I85@');
    });
    await page.goto('/');
  });

  test('shows a kinship label for a non-root person', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toBeVisible({ timeout: 15_000 });
    await expect(toolbarViewing).toContainText('Irene', { timeout: 10_000 });

    // Root node is marked with border-brass on its inner card; non-root nodes are not.
    //
    // A plain `.filter({ hasNot: ... }).first()` isn't enough on its own: this
    // tree renders 370 nodes and `FamilyTree`'s initial `fitView` only brings a
    // fraction of them on-screen (the rest sit outside the browser viewport,
    // unreachable by a real click, even though they're valid DOM matches). Pick
    // the first candidate that is both genuinely non-root AND actually
    // on-screen (see the identical workaround in reroot-persistence.spec.ts).
    const nonRootDataId = await page.evaluate(() => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node-person'))
      for (const node of nodes) {
        const isRoot = !!node.querySelector('[class*="border-brass"]')
        if (isRoot) continue
        const rect = node.getBoundingClientRect()
        const onScreen = rect.width > 0 && rect.top >= 0 && rect.left >= 0 && rect.bottom <= vh && rect.right <= vw
        if (onScreen) return node.getAttribute('data-id')
      }
      return null
    })
    expect(nonRootDataId, 'expected at least one on-screen non-root person node').toBeTruthy()

    const nonRootPersonNode = page.locator(`.react-flow__node[data-id="${nonRootDataId}"]`)
    await expect(nonRootPersonNode).toBeVisible({ timeout: 10_000 });
    await nonRootPersonNode.click();

    const drawer = page.getByTestId('person-drawer');
    await expect(drawer).toBeVisible();

    const relationshipButton = page.getByTestId('person-drawer-relationship-button');
    await expect(relationshipButton).toBeVisible();
    await expect(relationshipButton).toContainText('How related to Irene');

    await relationshipButton.click();

    const relationshipResult = page.getByTestId('person-drawer-relationship-result');
    await expect(relationshipResult).toBeVisible({ timeout: 10_000 });
    const resultText = await relationshipResult.textContent();
    expect(resultText).toBeTruthy();
    expect(resultText).toContain('Irene');
  });

  test('does not render the control for the root person', async ({ page }) => {
    const toolbarViewing = page.getByTestId('toolbar-viewing');
    await expect(toolbarViewing).toContainText('Irene', { timeout: 15_000 });

    // Select by accessible name (root is seeded as Irene Tunnicliffe in
    // beforeEach) rather than a CSS class — the old class-based filter
    // targeted a design-system class PersonNode no longer applies.
    const rootPersonNode = page
      .locator('.react-flow__node-person')
      .filter({ has: page.getByRole('button', { name: /^Irene Tunnicliffe\b/ }) })
      .first();
    await expect(rootPersonNode).toBeVisible({ timeout: 10_000 });
    await rootPersonNode.click();

    const drawer = page.getByTestId('person-drawer');
    await expect(drawer).toBeVisible();

    await expect(page.getByTestId('person-drawer-relationship-button')).toHaveCount(0);
  });
});
