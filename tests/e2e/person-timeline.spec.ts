import { test, expect } from '@playwright/test'
import { gotoViewer } from './helpers/viewer'

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

    // Investigation (issue #294, task 1): captured a Playwright trace of this
    // spec and confirmed clicking the spouse link *does* issue
    // `GET /api/person/%40ISPOUSE%40`, and this route mock *does* match it —
    // response is `200` with the `spouseDetail` body below. So neither of the
    // issue's two hypothesized causes applies: `FamilyTree`'s person-detail
    // `useEffect` already re-fetches on `person.gedcomId` change, and the
    // fetch resolves successfully against this mock (no mock fix needed).
    //
    // The actual defect is downstream, in the render layer: the drawer
    // header, the re-root button label, and the "How related to" text all
    // read `person.name` (the summary prop) rather than `detail.name` (the
    // record this fetch populates). When a Timeline link targets someone not
    // already in the current tree view, `onSelectPerson` builds `person` from
    // `personStub()`, which hardcodes `name: ''` — so those elements keep
    // showing "?Unknown" even after `detail` loads correctly with
    // "Bob Spouse". See src/components/FamilyTree.tsx:1707 (header), :2020
    // (re-root button), :1834 ("How related to"). Fixing that render-layer
    // read is tracked as the follow-up task on issue #294; no production code
    // or mock is changed by this task.
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

    await gotoViewer(page, aliceDetail.gedcomId)

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
