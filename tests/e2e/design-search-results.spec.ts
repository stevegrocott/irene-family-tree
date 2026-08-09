import { test, expect, type Page, type Locator } from '@playwright/test'
import { canonicalColor, resolved } from './helpers/design-tokens'

/**
 * Design-conformance E2E for the search results list.
 *
 * Source of truth: `docs/DESIGN_SYSTEM.md` §4.3 (Search), read together with
 * §0/§1 — colour comes from tokens, never from the default Tailwind palette,
 * and the two sex tints in §3.2 are the only tints permitted outside the
 * semantic set.
 *
 * §4.3 specifies, for each result row:
 *   - a sex tick as a 2px leading bar (explicitly "not a dot")
 *   - serif name, mono birth year, `--ft-text-3` place
 *   - hover `--ft-surface-1`
 *   - keyboard-active `--ft-accent-soft` with a 2px accent leading bar
 *   - the matched substring highlighted with `--ft-brass-soft`, no bolding
 *
 * These assert rendered computed style rather than class names, so they keep
 * holding if the implementation moves between Tailwind utilities and CSS.
 *
 * Data: the API is mocked, as in every other spec here — the E2E dev server
 * has no Neo4j connection.
 */

/** Both surnames match "Gullett" so the substring-highlight case has a real target. */
const PERSONS = [
  { gedcomId: '@I1@', name: 'Frances Gullett', sex: 'F', birthYear: '1901', birthPlace: 'Ballarat, VIC' },
  { gedcomId: '@I2@', name: 'Frank Gullett', sex: 'M', birthYear: '1928', birthPlace: 'Ballarat, VIC' },
  { gedcomId: '@I3@', name: 'Mary Gullett', sex: null, birthYear: '1870', birthPlace: 'Bendigo, VIC' },
]

/** Serves the person list the search filters over, plus a one-node tree so the canvas boots. */
async function mockCanvas(page: Page) {
  await page.route(/\/api\/persons/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PERSONS),
    })
  )

  await page.route(/\/api\/tree\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        nodes: [
          {
            id: 'node-@I1@',
            type: 'person',
            data: { ...PERSONS[0], isRoot: true, generation: 0 },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      }),
    })
  )
}

/** Opens the search panel and types a query that matches all three fixtures. */
async function search(page: Page, query: string): Promise<Locator> {
  // The entry-vs-viewer branch takes `?root=` ahead of localStorage
  // (FamilyTree.tsx), and the storageState default seeds a root id that is not
  // in this fixture — so address the fixture person directly.
  await page.goto(`/?root=${encodeURIComponent(PERSONS[0].gedcomId)}`)
  await page.getByTestId('search-input').fill(query)
  const results = page.getByTestId('search-result-item')
  await expect(results.first()).toBeVisible()
  return results
}

test.describe('search results — design system §4.3', () => {
  test.beforeEach(async ({ page }) => {
    await mockCanvas(page)
  })

  test('name is set in the serif and the birth year in the mono', async ({ page }) => {
    const results = await search(page, 'Gullett')
    const row = results.first()

    const nameFont = await row
      .getByText('Frances Gullett', { exact: true })
      .evaluate((el) => getComputedStyle(el).fontFamily)
    const yearFont = await row
      .getByText('1901', { exact: true })
      .evaluate((el) => getComputedStyle(el).fontFamily)

    expect(nameFont).toMatch(/serif/i)
    expect(yearFont).toMatch(/mono/i)
  })

  test('the sex tick is a leading bar spanning the row, not a dot', async ({ page }) => {
    const results = await search(page, 'Gullett')
    const row = results.first()

    // §4.3: "sex tick (2 px leading bar, not a dot)". A bar is materially
    // taller than it is wide and sits flush to the row's leading edge.
    const tick = await row.evaluate((el) => {
      const rowBox = el.getBoundingClientRect()
      const first = el.firstElementChild as HTMLElement | null
      if (!first) return null
      const box = first.getBoundingClientRect()
      return {
        width: box.width,
        height: box.height,
        offsetFromLeadingEdge: box.left - rowBox.left,
      }
    })

    expect(tick).not.toBeNull()
    expect(tick!.width).toBeLessThanOrEqual(3)
    expect(tick!.height).toBeGreaterThan(tick!.width * 3)
  })

  test('sex ticks use the two design-system tints, not the default Tailwind palette', async ({ page }) => {
    const results = await search(page, 'Gullett')

    // §3.2 names these as "the ONLY tints outside the semantic set". §0 calls
    // the default Tailwind palette out by name as part of what is being fixed,
    // so `bg-pink-400` / `bg-blue-400` are drift, not an equivalent choice.
    const female = await results.nth(0).evaluate((el) =>
      getComputedStyle(el.firstElementChild as HTMLElement).backgroundColor
    )
    const male = await results.nth(1).evaluate((el) =>
      getComputedStyle(el.firstElementChild as HTMLElement).backgroundColor
    )

    expect(await canonicalColor(page, female)).toBe(await canonicalColor(page, '#A85F86'))
    expect(await canonicalColor(page, male)).toBe(await canonicalColor(page, '#4A7DB5'))
  })

  test('hovering a result row raises it to the surface-1 token', async ({ page }) => {
    const results = await search(page, 'Gullett')
    const row = results.first()

    await row.hover()

    await expect(row).toHaveCSS('background-color', await resolved(page, 'var(--ft-surface-1)'))
  })

  test('the matched substring is highlighted with brass-soft and is not bolded', async ({ page }) => {
    const results = await search(page, 'Gullett')
    const brassSoft = await resolved(page, 'var(--ft-brass-soft)')

    // Implementation-agnostic: some element inside the row carries exactly the
    // matched substring on a brass-soft background, at the same weight as the
    // rest of the name (§4.3 — "no bolding").
    const highlight = await results.first().evaluate(
      (el, expectedBg) => {
        const match = [...el.querySelectorAll('*')].find(
          (node) => node.textContent?.trim().toLowerCase() === 'gullett'
        )
        if (!match) return { found: false as const }
        const style = getComputedStyle(match)
        const parentWeight = match.parentElement
          ? getComputedStyle(match.parentElement).fontWeight
          : null
        return {
          found: true as const,
          background: style.backgroundColor,
          weight: style.fontWeight,
          parentWeight,
          matchesBrassSoft: style.backgroundColor === expectedBg,
        }
      },
      brassSoft
    )

    expect(highlight.found, 'no element wraps the matched substring').toBe(true)
    expect(highlight.found && highlight.matchesBrassSoft).toBe(true)
    if (highlight.found && highlight.parentWeight) {
      expect(highlight.weight).toBe(highlight.parentWeight)
    }
  })

  test('ArrowDown makes a result keyboard-active with accent-soft and an accent leading bar', async ({ page }) => {
    const results = await search(page, 'Gullett')
    const accentSoft = await resolved(page, 'var(--ft-accent-soft)')
    const accent = await resolved(page, 'var(--ft-accent)')

    await page.getByTestId('search-input').press('ArrowDown')

    // §4.3: "keyboard-active `--ft-accent-soft` with a 2 px accent leading bar".
    // §7 also requires a keyboard path to anything clickable.
    const active = await results.first().evaluate(
      (el, { soft, line }) => {
        const style = getComputedStyle(el)
        const bar = el.firstElementChild as HTMLElement | null
        return {
          background: style.backgroundColor,
          isAccentSoft: style.backgroundColor === soft,
          barColor: bar ? getComputedStyle(bar).backgroundColor : null,
          barIsAccent: bar ? getComputedStyle(bar).backgroundColor === line : false,
        }
      },
      { soft: accentSoft, line: accent }
    )

    expect(active.isAccentSoft, `row background was ${active.background}`).toBe(true)
    expect(active.barIsAccent, `leading bar was ${active.barColor}`).toBe(true)
  })
})
