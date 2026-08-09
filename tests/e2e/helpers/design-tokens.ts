import { expect, type Page, type Locator } from '@playwright/test'

/**
 * Helpers shared by the `design-*.spec.ts` conformance specs.
 *
 * These specs assert *rendered* values against `docs/DESIGN_SYSTEM.md`, so they
 * need to compare computed style (always `rgb()` / `rgba()`) against design
 * tokens (authored as hex). Resolving the token through the browser keeps the
 * specs free of hard-coded hexes — which §1 forbids in the product, and which
 * would silently rot here the moment a token is retuned.
 */

/**
 * Resolves a CSS colour value — typically `var(--ft-*)` — to the exact string
 * `getComputedStyle` will report, by applying it to a throwaway element.
 *
 * @param page - Page whose document (and therefore active theme) resolves the value.
 * @param cssValue - Any valid CSS colour, e.g. `var(--ft-brass)` or `#A85F86`.
 * @returns The computed colour string, e.g. `rgb(169, 118, 26)`.
 */
export async function resolved(page: Page, cssValue: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement('div')
    probe.style.color = value
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    probe.remove()
    return computed
  }, cssValue)
}

/**
 * Normalises any CSS colour to a canonical `r,g,b,a` string by painting it onto
 * a 1×1 canvas and reading the pixel back.
 *
 * Needed because Tailwind v4 emits colours in `oklch`/`lab()`, while tokens are
 * authored as hex and `getComputedStyle` preserves whichever space was used.
 * Comparing the raw strings therefore fails on *format* even when the colours
 * match — and, worse, passes nothing useful to the reader of a failure. Going
 * through the canvas collapses every space to sRGB bytes.
 *
 * @param page - Page used to rasterise the colour.
 * @param cssColor - Any CSS colour: token, hex, `rgb()`, `oklch()`, `lab()`.
 * @returns Canonical `"r,g,b,a"` string, e.g. `"168,95,134,255"`.
 */
export async function canonicalColor(page: Page, cssColor: string): Promise<string> {
  return page.evaluate((value) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')
    // Resolve `var(--…)` against the document before handing it to the canvas,
    // which has no access to the cascade.
    const probe = document.createElement('div')
    probe.style.color = value
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    probe.remove()

    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = computed
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return `${r},${g},${b},${a}`
  }, cssColor)
}

/**
 * Nudges canvas zoom with wheel events until the requested LOD variant renders.
 *
 * The canvas picks its variant from zoom (§3.2) and deliberately opens at the
 * `dot` overview, so any spec asserting on `compact` or `full` treatment has to
 * drive a real zoom gesture to get there. Mirrors the approach in
 * `node-lod.spec.ts`.
 *
 * @param page - Page holding the react-flow canvas.
 * @param testId - Variant testid, e.g. `person-node-full`.
 * @param deltaY - Wheel delta per step; negative zooms in, positive zooms out.
 * @returns Locator for the first node rendered at that variant.
 */
export async function zoomUntilVariantVisible(
  page: Page,
  testId: string,
  direction: 'in' | 'out' = 'in'
): Promise<Locator> {
  const pane = page.locator('.react-flow')
  await expect(pane).toBeVisible()

  // Driven through the zoom control rather than `mouse.wheel`, for two reasons:
  // the control zooms about the viewport centre, so a node that started centred
  // by fitView stays reachable for real pointer interaction; and it leaves the
  // cursor on the control instead of on a node, so specs sampling a resting
  // treatment don't accidentally measure `:hover`.
  const control = page.locator(
    direction === 'in' ? '.react-flow__controls-zoomin' : '.react-flow__controls-zoomout'
  )

  // Wait for the canvas to actually be up *before* starting the zoom budget.
  // Folding the dev server's first-request compile into the same deadline made
  // the early tests in a file fail on a clock the later ones never saw.
  await expect(page.locator('.react-flow__node-person').first()).toBeVisible({ timeout: 60_000 })
  await expect(control).toBeVisible({ timeout: 15_000 })

  const selector =
    direction === 'in' ? '.react-flow__controls-zoomin' : '.react-flow__controls-zoomout'

  // Clicks are dispatched in-page rather than through `control.click()`: getting
  // from the opening overview zoom to `full` takes a dozen steps, and paying
  // Playwright's actionability round-trip on each one made this loop slow
  // enough to blow its own budget whenever workers contended for the dev server.
  const locator = page.getByTestId(testId).first()
  await expect(async () => {
    await page.evaluate((sel) => {
      document.querySelector<HTMLButtonElement>(sel)?.click()
    }, selector)
    await expect(locator).toBeVisible({ timeout: 200 })
  }).toPass({ timeout: 60_000 })

  // Zooming magnifies the node's offset from the viewport centre, so by the
  // time `full` is reached the node can sit outside the viewport entirely —
  // still readable through getComputedStyle, but unreachable for hover, click
  // or any other real pointer interaction. Pan it back into view.
  await centreNode(page, locator)
  // Centring parks the pointer on the node. Step off it so callers sample the
  // resting treatment by default; specs that want `:hover` opt in explicitly.
  await restPointer(page)
  return locator
}

/**
 * Pans the canvas so the given node sits at the centre of the react-flow pane.
 *
 * Drags from the pane's centre, which is blank whenever the node has drifted
 * off-centre — the only case this is called for. Leaves the pointer at the
 * pane centre, i.e. over the node, so callers sampling a resting style should
 * follow with {@link restPointer}.
 *
 * @param page - Page holding the react-flow canvas.
 * @param node - Node to bring to the centre of the pane.
 */
export async function centreNode(page: Page, node: Locator): Promise<void> {
  const paneBox = await page.locator('.react-flow').boundingBox()
  const nodeBox = await node.boundingBox()
  if (!paneBox || !nodeBox) throw new Error('pane or node has no bounding box')

  const centreX = paneBox.x + paneBox.width / 2
  const centreY = paneBox.y + paneBox.height / 2
  const dx = centreX - (nodeBox.x + nodeBox.width / 2)
  const dy = centreY - (nodeBox.y + nodeBox.height / 2)
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return

  await page.mouse.move(centreX, centreY)
  await page.mouse.down()
  await page.mouse.move(centreX + dx, centreY + dy, { steps: 10 })
  await page.mouse.up()
}

/**
 * Parks the pointer in the canvas's top-left corner, well clear of any node.
 *
 * `zoomUntilVariantVisible` leaves the cursor sitting on the node it anchored
 * to, which means a `:hover` treatment is already applied. Any spec measuring a
 * resting style has to move away first or it will compare hover against hover.
 *
 * @param page - Page holding the react-flow canvas.
 */
export async function restPointer(page: Page): Promise<void> {
  const pane = page.locator('.react-flow')
  const box = await pane.boundingBox()
  if (!box) throw new Error('react-flow pane has no bounding box')
  await page.mouse.move(box.x + 2, box.y + 2)
}
