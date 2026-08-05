import { test, expect, type Page } from '@playwright/test'
import { mockPersonsAndTree } from './helpers/revert-mocks'

/**
 * E2E coverage for issue #232's cold-start behaviour change: `/` used to mount
 * the react-flow canvas unconditionally (~370 nodes, auto-fitted at a default
 * root). It now renders the {@link EmptyState} "entry state" whenever no focus
 * person resolves from the URL or `localStorage`, and only mounts the canvas
 * once a person has been chosen.
 *
 *   AC1 — Loading `/` with no `?person=`/`?root=` and empty `localStorage`
 *         renders the entry state (title, search field, start-here rows) and
 *         mounts no react-flow canvas.
 *   AC2 — Choosing any person from the entry state sets focus, enters `walk`,
 *         and writes both the focus and the view to the URL; reloading that
 *         URL restores the same focus and view.
 *
 * This spec overrides the suite-wide `storageState` fixture (which seeds
 * `family-tree-root-id` so the other 30+ specs land straight on the canvas)
 * with an empty one, since the whole point here is to exercise the *absence*
 * of a resolved focus. Persons/tree data are mocked rather than read from the
 * real backend so the "which rows appear" assertions don't depend on the
 * shape of whatever data happens to be seeded there.
 */
test.use({ storageState: { cookies: [], origins: [] } })

/** Matches DEFAULT_ROOT_GEDCOM_ID in src/constants/tree.ts — offered as the entry state's "Root person" row. */
const ROOT_PERSON = {
  gedcomId: '@I85@',
  name: 'Irene Tunnicliffe',
  sex: 'F',
  birthYear: '1930',
  deathYear: '2000',
  birthPlace: 'Sheffield',
  deathPlace: null,
  occupation: null,
  notes: null,
}

/** Earliest-born person in the mocked list — offered as the entry state's "Earliest ancestor" row. */
const EARLIEST_ANCESTOR = {
  gedcomId: '@IANCESTOR@',
  name: 'Eleanor Ancestor',
  sex: 'F',
  birthYear: '1850',
  deathYear: '1900',
  birthPlace: null,
  deathPlace: null,
  occupation: null,
  notes: null,
}

const MOCK_PERSONS = [ROOT_PERSON, EARLIEST_ANCESTOR]

/** Percent-encoded form of ROOT_PERSON's id as it appears in the URL query string. */
const ROOT_ENC = encodeURIComponent(ROOT_PERSON.gedcomId)

/** A minimal single-node tree response rooted on `person`, sufficient to mount the canvas. */
function treeResponseFor(person: typeof ROOT_PERSON) {
  return {
    nodes: [
      {
        id: `node-${person.gedcomId}`,
        type: 'person',
        data: { ...person, isRoot: true, generation: 0 },
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  }
}

/** The entry state's "Root person" start-here row. */
const rootRow = (page: Page) => page.getByTestId('empty-state-row-root')

test.describe('viewer first view (issue #232)', () => {
  test('cold start with no focus renders the entry state, not the canvas', async ({ page }) => {
    await mockPersonsAndTree(page, MOCK_PERSONS, treeResponseFor(ROOT_PERSON))

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const emptyState = page.getByTestId('empty-state')
    await expect(emptyState).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('empty-state-title')).toHaveText('Who are you looking for?')
    await expect(page.getByTestId('empty-state-search')).toBeVisible()

    // The two people with data resolve to their respective start-here rows...
    await expect(rootRow(page)).toContainText(ROOT_PERSON.name)
    await expect(page.getByTestId('empty-state-row-earliest')).toContainText(EARLIEST_ANCESTOR.name)
    // ...but "resume" never appears cold, since nothing is in localStorage yet.
    await expect(page.getByTestId('empty-state-row-resume')).toHaveCount(0)

    await expect(page.getByTestId('empty-state-person-count')).toContainText(String(MOCK_PERSONS.length))

    // No canvas chrome and no react-flow nodes are mounted alongside the entry state.
    await expect(page.getByTestId('viewer-shell')).toHaveCount(0)
    await expect(page.locator('.react-flow')).toHaveCount(0)
    await expect(page.locator('.react-flow__node-person')).toHaveCount(0)
  })

  test('choosing a person from the entry state sets focus and enters Walk', async ({ page }) => {
    await mockPersonsAndTree(page, MOCK_PERSONS, treeResponseFor(ROOT_PERSON))

    await page.goto('/')
    await expect(rootRow(page)).toBeVisible({ timeout: 15_000 })

    await rootRow(page).click()

    // The entry state is gone, replaced by the persistent shell and the canvas.
    await expect(page.getByTestId('empty-state')).toHaveCount(0)
    const shell = page.getByTestId('viewer-shell')
    await expect(shell).toBeVisible()

    // Walk is the active (pressed) segment of the 3-way view switcher.
    await expect(page.getByTestId('viewer-shell-switcher-walk')).toHaveAttribute('aria-pressed', 'true')

    // The chosen person's node renders on the canvas.
    await expect(page.getByTestId(`rf__node-node-${ROOT_PERSON.gedcomId}`)).toContainText(ROOT_PERSON.name, {
      timeout: 10_000,
    })

    // Both the focus and the view are written to the URL (AC2), so it's shareable/reloadable.
    await expect(page).toHaveURL(new RegExp(`root=${ROOT_ENC}`), { timeout: 10_000 })
    await expect(page).toHaveURL(/view=walk/)
  })

  test('reloading a URL from a chosen focus restores the same focus and view', async ({ page }) => {
    await mockPersonsAndTree(page, MOCK_PERSONS, treeResponseFor(ROOT_PERSON))

    await page.goto('/')
    await expect(rootRow(page)).toBeVisible({ timeout: 15_000 })
    await rootRow(page).click()
    await expect(page).toHaveURL(new RegExp(`root=${ROOT_ENC}`), { timeout: 10_000 })

    const focusedUrl = page.url()
    await page.goto(focusedUrl)
    await page.waitForLoadState('domcontentloaded')

    // The reloaded page lands directly on the viewer for the same person and view —
    // never back on the entry state.
    await expect(page.getByTestId('empty-state')).toHaveCount(0)
    await expect(page.getByTestId('viewer-shell-switcher-walk')).toHaveAttribute('aria-pressed', 'true', {
      timeout: 15_000,
    })
    await expect(page.getByTestId(`rf__node-node-${ROOT_PERSON.gedcomId}`)).toContainText(ROOT_PERSON.name, {
      timeout: 10_000,
    })
  })

  test('⌘K opens the search overlay, Esc closes it, and Esc again returns to the entry state', async ({ page }) => {
    await mockPersonsAndTree(page, MOCK_PERSONS, treeResponseFor(ROOT_PERSON))

    await page.goto('/')
    await expect(rootRow(page)).toBeVisible({ timeout: 15_000 })
    await rootRow(page).click()

    // Focused in the viewer, not the entry state.
    await expect(page.getByTestId('empty-state')).toHaveCount(0)
    const shell = page.getByTestId('viewer-shell')
    await expect(shell).toBeVisible()

    const overlayPanel = page.getByTestId('search-overlay-panel')
    const overlayInput = page.getByTestId('search-overlay-input')

    // ⌘K (Ctrl+K on non-Mac) opens the overlay from the viewer, with a cleared query,
    // even though focus is on no particular element (AC3).
    await page.keyboard.press('ControlOrMeta+k')
    await expect(overlayPanel).toBeVisible()
    await expect(overlayInput).toBeFocused()
    await expect(overlayInput).toHaveValue('')

    // Typing a query, then closing and reopening, confirms the query really
    // resets rather than merely starting empty.
    await overlayInput.fill(EARLIEST_ANCESTOR.name)
    await expect(overlayInput).toHaveValue(EARLIEST_ANCESTOR.name)

    // First Esc closes the overlay only — the viewer underneath is untouched.
    await page.keyboard.press('Escape')
    await expect(overlayPanel).toHaveCount(0)
    await expect(shell).toBeVisible()
    await expect(page.getByTestId('empty-state')).toHaveCount(0)

    // Reopening confirms the query was cleared by the close, not just this test's fill.
    await page.keyboard.press('ControlOrMeta+k')
    await expect(overlayInput).toHaveValue('')
    await page.keyboard.press('Escape')
    await expect(overlayPanel).toHaveCount(0)

    // Second Esc, with no overlay open, clears focus/trail and returns to the entry state.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('empty-state')).toBeVisible()
    await expect(shell).toHaveCount(0)
  })
})
