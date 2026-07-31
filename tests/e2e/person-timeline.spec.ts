import { test, expect } from '@playwright/test'

/**
 * E2E tests for the person drawer's Timeline section (issue #151).
 *
 * Verifies:
 *   1. Opening a person's drawer shows a Timeline section listing their life
 *      events (birth, marriage, child birth, death) in ascending year order.
 *   2. Clicking a person link within a timeline entry opens that person's
 *      drawer via the existing relative-navigation behavior.
 */

/** Spouse shown as a marriage event in Alice's timeline. */
const spouseSummary = {
  gedcomId: '@ISPOUSE@',
  name: 'Bob Spouse',
  sex: 'M',
  birthYear: '1898',
  deathYear: null,
}

/** Child shown as a child-birth event in Alice's timeline. */
const childSummary = {
  gedcomId: '@ICHILD@',
  name: 'Carol Child',
  sex: 'F',
  birthYear: '1930',
  deathYear: null,
}

/** Root person whose drawer we open — has a birth, marriage, child, and death. */
const aliceDetail = {
  gedcomId: '@ITEST@',
  name: 'Alice Test',
  sex: 'F',
  birthYear: '1900',
  deathYear: '1980',
  birthPlace: 'London, England',
  deathPlace: 'London, England',
  occupation: null,
  notes: null,
  parents: [],
  siblings: [],
  marriages: [
    {
      unionId: '@F1@',
      marriageYear: '1925',
      marriagePlace: 'Paris, France',
      spouse: spouseSummary,
      children: [childSummary],
    },
  ],
}

/** Detail returned when the spouse's drawer is opened from a timeline link. */
const spouseDetail = {
  gedcomId: '@ISPOUSE@',
  name: 'Bob Spouse',
  sex: 'M',
  birthYear: '1898',
  deathYear: null,
  birthPlace: null,
  deathPlace: null,
  occupation: null,
  notes: null,
  parents: [],
  siblings: [],
  marriages: [],
}

/** Minimal single-node tree response for Alice Test. */
const aliceTreeResponse = {
  nodes: [
    {
      id: 'node-@ITEST@',
      type: 'person',
      data: {
        gedcomId: '@ITEST@',
        name: 'Alice Test',
        sex: 'F',
        birthYear: '1900',
        deathYear: '1980',
        birthPlace: 'London, England',
        deathPlace: 'London, England',
        occupation: null,
        notes: null,
        isRoot: true,
        generation: 0,
      },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
}

test.describe('Person drawer Timeline', () => {
  test('shows life events in ascending year order and navigates via person links', async ({ page }) => {
    await page.route(/\/api\/persons/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            gedcomId: '@ITEST@',
            name: 'Alice Test',
            sex: 'F',
            birthYear: '1900',
            deathYear: '1980',
            birthPlace: 'London, England',
          },
        ]),
      })
    )

    await page.route(/\/api\/tree\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aliceTreeResponse),
      })
    )

    await page.route(/\/api\/person\//, async (route) => {
      const url = route.request().url()
      if (url.includes('/relationships')) {
        await route.continue()
        return
      }
      if (url.includes('/my-changes')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ createChange: null, relationshipChanges: [], attributeChanges: [] }),
        })
        return
      }
      const detail = url.includes('ISPOUSE') ? spouseDetail : aliceDetail
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      })
    })

    await page.goto('/')

    // Wait for the tree to render — toolbar visibility is a reliable signal.
    await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

    // Click the person node to open Alice's drawer.
    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()

    const timeline = drawer.getByTestId('person-drawer-timeline')
    await expect(timeline).toBeVisible({ timeout: 5_000 })

    // Events render in ascending year order: birth, marriage, child, death.
    const entries = timeline.locator('li')
    await expect(entries).toHaveCount(4)
    await expect(entries.nth(0)).toContainText('1900')
    await expect(entries.nth(0)).toContainText('Born')
    await expect(entries.nth(1)).toContainText('1925')
    await expect(entries.nth(1)).toContainText('Bob Spouse')
    await expect(entries.nth(2)).toContainText('1930')
    await expect(entries.nth(2)).toContainText('Carol Child')
    await expect(entries.nth(3)).toContainText('1980')
    await expect(entries.nth(3)).toContainText('aged 80')

    // Clicking the spouse link in the marriage entry opens their drawer.
    await entries.nth(1).getByRole('button', { name: 'Bob Spouse' }).click()

    await expect(drawer).toContainText('Bob Spouse', { timeout: 5_000 })
  })
})
