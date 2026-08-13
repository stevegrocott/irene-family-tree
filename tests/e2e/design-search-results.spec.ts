import { test, expect, type Locator } from '@playwright/test'
import { mockPersonsAndTree } from './helpers/revert-mocks'
import { canonicalColor, resolved } from './helpers/design-tokens'
import { gotoViewer } from './helpers/viewer'

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
 *
 * Target: issue #276 removes the floating `SearchBar` (`search-input` /
 * `search-result-item`) in favour of the single `⌘K` `SearchOverlay` as the
 * one search affordance (§4.2). These specs are retargeted at the overlay's
 * `search-overlay-input` / `search-overlay-result` testids and open it via
 * the real `viewer-shell-search` button rather than the removed panel — the
 * §4.3 assertions themselves are unchanged, since they were always written
 * against computed style rather than the panel's markup.
 */

/** Both surnames match "Gullett" so the substring-highlight case has a real target. */
const PERSONS = [
  { gedcomId: '@I1@', name: 'Frances Gullett', sex: 'F', birthYear: '1901', birthPlace: 'Ballarat, VIC' },
  { gedcomId: '@I2@', name: 'Frank Gullett', sex: 'M', birthYear: '1928', birthPlace: 'Ballarat, VIC' },
  { gedcomId: '@I3@', name: 'Mary Gullett', sex: null, birthYear: '1870', birthPlace: 'Bendigo, VIC' },
]

/** The query typed into the search box; matches all three fixtures by surname. */
const QUERY = 'Gullett'

/** The row's leading sex tick — its first child element. */
const leadingBar = (row: Locator) => row.locator(':scope > *').first()

test.describe('search results — design system §4.3', () => {
  let results: Locator

  test.beforeEach(async ({ page }) => {
    await mockPersonsAndTree(page, PERSONS, {
      nodes: [
        {
          id: 'node-@I1@',
          type: 'person',
          data: { ...PERSONS[0], isRoot: true },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      totalNodes: 1,
      truncated: false,
    })

    await gotoViewer(page, PERSONS[0].gedcomId)

    // Open the one search affordance (§4.2) through its real UI control,
    // then drive the query through the overlay's own input.
    await page.getByTestId('viewer-shell-search').click()
    const overlayInput = page.getByTestId('search-overlay-input')
    await expect(overlayInput).toBeVisible()
    await overlayInput.fill(QUERY)

    results = page.getByTestId('search-overlay-result')
    await expect(results.first()).toBeVisible()
  })

  test('name is set in the serif and the birth year in the mono', async () => {
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

  test('the sex tick is a leading bar spanning the row, not a dot', async () => {
    // §4.3: "sex tick (2 px leading bar, not a dot)". A bar is materially
    // taller than it is wide and sits flush to the row's leading edge.
    const tick = await leadingBar(results.first()).boundingBox()

    expect(tick).not.toBeNull()
    expect(tick!.width).toBeLessThanOrEqual(3)
    expect(tick!.height).toBeGreaterThan(tick!.width * 3)
  })

  test('sex ticks use the two design-system tints, not the default Tailwind palette', async ({ page }) => {
    // §3.2 names these as "the ONLY tints outside the semantic set". §0 calls
    // the default Tailwind palette out by name as part of what is being fixed,
    // so `bg-pink-400` / `bg-blue-400` are drift, not an equivalent choice.
    //
    // The hexes are quoted from the design document deliberately: asserting
    // against the component's own constant would compare the implementation to
    // itself and prove nothing.
    const female = await leadingBar(results.nth(0)).evaluate((el) => getComputedStyle(el).backgroundColor)
    const male = await leadingBar(results.nth(1)).evaluate((el) => getComputedStyle(el).backgroundColor)

    expect(await canonicalColor(page, female)).toBe(await canonicalColor(page, '#A85F86'))
    expect(await canonicalColor(page, male)).toBe(await canonicalColor(page, '#4A7DB5'))
  })

  test('hovering a result row raises it to the surface-1 token', async ({ page }) => {
    const row = results.first()

    await row.hover()

    await expect(row).toHaveCSS('background-color', await resolved(page, 'var(--ft-surface-1)'))
  })

  test('the matched substring is highlighted with brass-soft and is not bolded', async ({ page }) => {
    const brassSoft = await resolved(page, 'var(--ft-brass-soft)')

    // Implementation-agnostic: some element inside the row carries exactly the
    // matched substring, at the same weight as the rest of the name
    // (§4.3 — "no bolding").
    const highlight = await results.first().evaluate((el, query) => {
      const match = [...el.querySelectorAll('*')].find(
        (node) => node.textContent?.trim().toLowerCase() === query.toLowerCase()
      )
      if (!match) return null
      const style = getComputedStyle(match)
      return {
        background: style.backgroundColor,
        weight: style.fontWeight,
        parentWeight: match.parentElement ? getComputedStyle(match.parentElement).fontWeight : null,
      }
    }, QUERY)

    expect(highlight, 'no element wraps the matched substring').not.toBeNull()
    expect(highlight!.background).toBe(brassSoft)
    if (highlight!.parentWeight) {
      expect(highlight!.weight).toBe(highlight!.parentWeight)
    }
  })

  test('ArrowDown makes a result keyboard-active with accent-soft and an accent leading bar', async ({ page }) => {
    await page.getByTestId('search-overlay-input').press('ArrowDown')

    // §4.3: "keyboard-active `--ft-accent-soft` with a 2 px accent leading bar".
    // §7 also requires a keyboard path to anything clickable.
    await expect(results.first()).toHaveCSS(
      'background-color',
      await resolved(page, 'var(--ft-accent-soft)')
    )
    await expect(leadingBar(results.first())).toHaveCSS(
      'background-color',
      await resolved(page, 'var(--ft-accent)')
    )
  })
})

test.describe('search affordance — regression guard', () => {
  test('exactly one search affordance renders on the page (AC6)', async ({ page }) => {
    await mockPersonsAndTree(page, PERSONS, {
      nodes: [
        {
          id: 'node-@I1@',
          type: 'person',
          data: { ...PERSONS[0], isRoot: true },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      totalNodes: 1,
      truncated: false,
    })

    await gotoViewer(page, PERSONS[0].gedcomId)

    // Issue #276 removes the floating SearchBar (`search-toggle` /
    // `search-panel` / `search-input`) in favour of the single ⌘K
    // `SearchOverlay` trigger (`viewer-shell-search`) as the one search
    // affordance (§4.2). Regression guard mirroring #241's AuthButton
    // duplicate-instance guard: assert the single-affordance invariant
    // explicitly so a reintroduced second search entry point fails this test
    // rather than silently coexisting alongside the overlay trigger.
    const searchAffordances = page.locator(
      '[data-testid="viewer-shell-search"], [data-testid="search-toggle"], [data-testid="search-panel"], [data-testid="search-input"], [data-testid="search-overlay-trigger"]'
    )
    await expect(searchAffordances).toHaveCount(1)
    await expect(page.getByTestId('viewer-shell-search')).toBeVisible()
  })
})
