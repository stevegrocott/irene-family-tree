import { expect, type Page } from '@playwright/test'

/**
 * Navigation and canvas-readiness helpers for viewer specs.
 *
 * Kept separate from `design-tokens.ts` so a spec that only needs to resolve a
 * colour token doesn't pull in canvas machinery.
 */

/**
 * Waits until the react-flow viewport transform stops changing.
 *
 * `FamilyTree` fits the viewport to the tree bounds on load via a deferred
 * 300ms `setViewport` transition. Measuring geometry — or driving a pointer —
 * before that settles reads a transform that is still moving, which is what
 * makes canvas specs flaky.
 *
 * @param page - Page holding the react-flow canvas.
 */
export async function waitForCanvasSettled(page: Page): Promise<void> {
  const viewport = page.locator('.react-flow__viewport')
  await expect(async () => {
    const before = await viewport.evaluate((el) => getComputedStyle(el).transform)
    await page.waitForTimeout(60)
    const after = await viewport.evaluate((el) => getComputedStyle(el).transform)
    expect(after).toBe(before)
  }).toPass({ timeout: 10_000, intervals: [0, 50, 100, 200] })
}

/**
 * Opens the viewer focused on a specific person and waits for the canvas to settle.
 *
 * The cold-start entry state added in #232 renders instead of the canvas unless
 * a focus person resolves, and `FamilyTree` takes the URL `root`/`person` param
 * ahead of localStorage. Specs that mock their own fixture ids therefore cannot
 * rely on the `storageState` seed (`@I85@`), which their mock does not contain —
 * they must address their fixture person directly.
 *
 * @param page - Page to navigate.
 * @param rootId - GEDCOM id of the person to focus, e.g. `@I1@`.
 */
export async function gotoViewer(page: Page, rootId: string): Promise<void> {
  await page.goto(`/?root=${encodeURIComponent(rootId)}`)
  await expect(page.locator('.react-flow__node-person').first()).toBeVisible({ timeout: 60_000 })
  await waitForCanvasSettled(page)
}
