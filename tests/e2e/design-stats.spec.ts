import { test, expect, type Page, type Route } from '@playwright/test'
import { resolved } from './helpers/design-tokens'
import type { StatsResponse } from '@/types/stats'

/**
 * Design-conformance E2E for the `/stats` page.
 *
 * Source of truth: issue #277 — `/stats` never adopted the design system.
 * Its headings render in Geist where `docs/DESIGN_SYSTEM.md` §2 specifies
 * the Source Serif 4 type scale (`--ft-display` for the page heading,
 * `--ft-title` for panel headings), and its bar chart is filled with the
 * default Tailwind indigo gradient that §0 names as the defect being fixed
 * and §1 forbids ("colour carries meaning, never decoration"; the two §3.2
 * sex tints are the only tints permitted outside the semantic token set).
 *
 * Every assertion reads computed style rather than class names, so a move
 * between Tailwind utilities and plain CSS does not break the spec — and so
 * a heading that reverts to a sans family, or a fill that reverts to a
 * hard-coded colour, fails here regardless of how the markup gets there.
 *
 * Data: `GET /api/stats` is mocked, as in every other spec here — the E2E
 * dev server has no Neo4j connection.
 */

/** Minimal StatsResponse fixture with exactly one bar per chart, so the fill assertion targets an unambiguous element. */
const STATS: StatsResponse = {
  totalPeople: 42,
  sexBreakdown: { male: 20, female: 21, unknown: 1 },
  unionCount: 15,
  birthsByDecade: [{ decade: 1950, count: 10 }],
  topSurnames: [{ surname: 'Gullett', count: 8 }],
  topBirthplaces: [{ birthPlace: 'Ballarat, VIC', count: 6 }],
  averageLifespan: 72.4,
  oldestAncestor: { gedcomId: '@I1@', name: 'Frances Gullett', birthYear: '1901' },
  largestUnion: { unionId: 'U1', childCount: 6, parents: ['Frances Gullett', 'Albert Gullett'] },
}

/** Mocks `GET /api/stats` and navigates to `/stats`, waiting past the loading state. */
async function gotoStats(page: Page): Promise<void> {
  await page.route(/\/api\/stats\b/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STATS),
    })
  )

  await page.goto('/stats')
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('stats-page')).toBeVisible()
}

/** Measures document scroll/client width to detect horizontal overflow. */
function getHorizontalOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
}

const LAYOUT_TOLERANCE_PX = 4

test.describe('/stats — design system §0/§1/§2', () => {
  test('the page heading uses the --ft-display serif scale, not a sans family', async ({ page }) => {
    await gotoStats(page)

    const heading = page.getByRole('heading', { level: 1, name: 'Family Statistics' })
    const fontFamily = await heading.evaluate((el) => getComputedStyle(el).fontFamily)

    // §2: "Page display | --ft-display | serif 28/700". A heading still on
    // Geist (the pre-migration default) never contains "source serif 4", so
    // this fails exactly when the serif token has not been applied.
    expect(fontFamily.toLowerCase()).toContain('source serif 4')
    await expect(heading).toHaveCSS('font-family', /serif/i)
  })

  test('a chart section heading uses the --ft-title serif scale', async ({ page }) => {
    await gotoStats(page)

    const heading = page.getByRole('heading', { level: 2, name: 'Births by decade' })
    const fontFamily = await heading.evaluate((el) => getComputedStyle(el).fontFamily)

    // §2: "Panel title | --ft-title | serif 20/600" — the ChartSection
    // headings share the same migration gap as the page h1.
    expect(fontFamily.toLowerCase()).toContain('source serif 4')
    await expect(heading).toHaveCSS('font-family', /serif/i)
  })

  test('the bar chart fill resolves to the --ft-accent token, not a Tailwind indigo gradient', async ({ page }) => {
    await gotoStats(page)

    const accent = await resolved(page, 'var(--ft-accent)')

    // §1: colour comes from the semantic token set; §0 names the default
    // Tailwind palette as the defect being fixed. Implementation-agnostic:
    // find whichever descendant of the bar row is painted with the accent
    // token, rather than assuming a fixed nesting depth.
    const fill = await page.getByTestId('stats-decades-chart-bar').evaluate((row, expected) => {
      const match = [...row.querySelectorAll('*')].find(
        (child) => getComputedStyle(child).backgroundColor === expected
      )
      if (!match) return null
      const style = getComputedStyle(match)
      return { backgroundImage: style.backgroundImage }
    }, accent)

    expect(fill, 'no descendant of the bar row is painted with --ft-accent').not.toBeNull()
    // A `background-image` gradient (the indigo-500→indigo-400 fill) would
    // still leave `background-color` transparent and never match the token
    // above, but assert `none` explicitly so a token colour layered under a
    // leftover gradient utility doesn't slip through.
    expect(fill!.backgroundImage).toBe('none')
  })
})

test.describe('/stats — responsive layout (issue #281)', () => {
  // The h1 moved to the --ft-display serif scale (28/700, larger than the
  // Geist default it replaced) in issue #277. A wider heading is more likely
  // to force the header row past the viewport edge, so re-check the no-scroll
  // invariant at the app's narrow, mid, and wide reference widths.
  for (const width of [360, 700, 1280]) {
    test(`no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await gotoStats(page)

      const overflow = await getHorizontalOverflow(page)
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
    })
  }

  test('the header row (h1 + BackLink) wraps or truncates rather than overflowing at 360px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await gotoStats(page)

    const heading = page.getByRole('heading', { level: 1, name: 'Family Statistics' })
    const backLink = page.getByTestId('stats-back-link')
    await expect(heading).toBeVisible()
    await expect(backLink).toBeVisible()

    const [headingBox, backLinkBox] = await Promise.all([heading.boundingBox(), backLink.boundingBox()])
    expect(headingBox).not.toBeNull()
    expect(backLinkBox).not.toBeNull()

    // Whether the row wraps (BackLink drops below the heading) or the
    // heading truncates, neither element's right edge should escape the
    // 360px viewport and force a scrollbar.
    expect(headingBox!.x + headingBox!.width).toBeLessThanOrEqual(360 + LAYOUT_TOLERANCE_PX)
    expect(backLinkBox!.x + backLinkBox!.width).toBeLessThanOrEqual(360 + LAYOUT_TOLERANCE_PX)

    const overflow = await getHorizontalOverflow(page)
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  })
})
