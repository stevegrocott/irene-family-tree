import { type Page } from '@playwright/test'

/**
 * Colour helpers shared by the `design-*.spec.ts` conformance specs.
 *
 * These specs assert *rendered* values against `docs/DESIGN_SYSTEM.md`, so they
 * need to compare computed style against design tokens. Resolving the token
 * through the browser keeps the specs free of hard-coded token values — which
 * §1 forbids in the product, and which would silently rot here the moment a
 * token is retuned.
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
 * a 1x1 canvas and reading the pixel back.
 *
 * Needed because Tailwind v4 emits colours in `oklch`/`lab`, while tokens are
 * authored as hex and `getComputedStyle` preserves whichever space was used.
 * Comparing the raw strings fails on *format* even when the colours match, and
 * reports a diff the reader cannot act on. Rasterising collapses every space to
 * sRGB bytes.
 *
 * Pass a `var(--…)` token through {@link resolved} first — the canvas has no
 * access to the cascade.
 *
 * @param page - Page used to rasterise the colour.
 * @param cssColor - A concrete CSS colour: hex, `rgb()`, `oklch()`, `lab()`.
 * @returns Canonical `"r,g,b,a"` string, e.g. `"168,95,134,255"`.
 */
export async function canonicalColor(page: Page, cssColor: string): Promise<string> {
  return page.evaluate((value) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return `${r},${g},${b},${a}`
  }, cssColor)
}
