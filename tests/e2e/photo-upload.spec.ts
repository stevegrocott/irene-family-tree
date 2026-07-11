import { test, expect } from '@playwright/test'

/**
 * E2E test for the photo upload flow (issue #159).
 *
 * Opens a person drawer on the tree page, enters edit mode, uploads a test
 * image, saves, and asserts the photo appears both in the drawer header and
 * on the person's canvas node avatar.
 */

// ─── Shared fixtures ────────────────────────────────────────────────────────

/**
 * Minimal valid 1x1 transparent PNG, reused as both the uploaded file's
 * bytes and the URL the mocked upload endpoint returns — the canvas node
 * avatar only renders the photo if the <img> actually loads successfully.
 */
const TEST_PHOTO_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const TEST_PHOTO_DATA_URL = `data:image/png;base64,${TEST_PHOTO_BASE64}`

const signedInUser = {
  name: 'E2E Test User',
  email: 'e2e@example.com',
  image: null,
  role: 'admin' as const,
}

/** Known person whose drawer we open, edit, and upload a photo for. */
const mockPersonDetailBase = {
  gedcomId: '@ITEST@',
  name: 'Alice Test',
  sex: 'F',
  birthYear: '1900',
  deathYear: null,
  birthPlace: 'London, England',
  deathPlace: null,
  occupation: null,
  notes: null,
  parents: [],
  siblings: [],
  marriages: [],
}

/** Single-node tree response for Alice Test, reflecting the current photoUrl. */
function buildTreeResponse(photoUrl: string | null) {
  return {
    nodes: [
      {
        id: 'node-@ITEST@',
        type: 'person',
        data: {
          gedcomId: '@ITEST@',
          name: 'Alice Test',
          sex: 'F',
          birthYear: '1900',
          deathYear: null,
          birthPlace: 'London, England',
          deathPlace: null,
          occupation: null,
          notes: null,
          isRoot: true,
          generation: 0,
          photoUrl,
        },
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  }
}

/**
 * Intercepts the NextAuth session endpoint and returns a synthetic authenticated
 * admin session so the drawer's direct-save (rather than suggest-change) flow is used.
 * @param page - Playwright page to install the route mock on
 */
async function mockSignedInSession(page: import('@playwright/test').Page) {
  await page.route(/\/api\/auth\/session\b/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: signedInUser,
        expires: '2099-01-01T00:00:00.000Z',
      }),
    })
  )
}

// ─── Test suite ─────────────────────────────────────────────────────────────

test.describe('Photo upload flow', () => {
  test('upload, save, and see the photo in the drawer header and canvas node', async ({
    page,
  }) => {
    // Tracks the persisted photoUrl so mocks can reflect it across the
    // upload → PATCH → detail re-fetch → tree re-fetch sequence.
    let currentPhotoUrl: string | null = null

    await mockSignedInSession(page)

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
            deathYear: null,
            birthPlace: 'London, England',
          },
        ]),
      })
    )

    await page.route(/\/api\/tree\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildTreeResponse(currentPhotoUrl)),
      })
    )

    await page.route(/\/api\/person\//, async (route) => {
      const req = route.request()
      const url = req.url()
      const method = req.method()

      if (url.includes('/relationships')) {
        await route.continue()
        return
      }

      if (url.includes('/photo') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ url: TEST_PHOTO_DATA_URL }),
        })
        return
      }

      if (method === 'PATCH') {
        try {
          const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>
          if (typeof body.photoUrl === 'string' || body.photoUrl === null) {
            currentPhotoUrl = body.photoUrl as string | null
          }
        } catch {
          // ignore parse errors
        }
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...mockPersonDetailBase, photoUrl: currentPhotoUrl }),
      })
    })

    await page.goto('/')

    // Wait for the tree to render — toolbar visibility is a reliable signal.
    await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

    // Click Alice's node to open the drawer.
    const personNode = page.locator('.react-flow__node-person').first()
    await expect(personNode).toBeVisible({ timeout: 10_000 })
    await personNode.click()

    const drawer = page.getByTestId('person-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText('London, England', { timeout: 5_000 })

    // Enter edit mode.
    await page.getByTestId('person-drawer-edit').click()
    const editForm = page.getByTestId('person-drawer-edit-form')
    await expect(editForm).toBeVisible()

    // Upload a test image via the file input.
    await page.getByTestId('person-drawer-photo-input').setInputFiles({
      name: 'test-photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TEST_PHOTO_BASE64, 'base64'),
    })

    // The edit-form preview reflects the uploaded photo once the upload completes.
    const preview = page.getByTestId('person-drawer-edit-photo-preview')
    await expect(preview).toBeVisible({ timeout: 5_000 })
    await expect(preview).toHaveAttribute('src', TEST_PHOTO_DATA_URL)

    // Save the change.
    await page.getByRole('button', { name: /save change/i }).click()
    await expect(editForm).not.toBeVisible({ timeout: 5_000 })

    // The drawer header shows the uploaded photo.
    const drawerPhoto = page.getByTestId('person-drawer-photo')
    await expect(drawerPhoto).toBeVisible({ timeout: 5_000 })
    await expect(drawerPhoto).toHaveAttribute('src', TEST_PHOTO_DATA_URL)

    // Reload so the tree re-fetches with the newly saved photo, reflecting it
    // on the person's canvas node avatar.
    await page.reload()
    await expect(page.getByTestId('toolbar-viewing')).toBeVisible({ timeout: 15_000 })

    const nodePhoto = page.getByTestId('person-node-photo')
    await expect(nodePhoto).toBeVisible({ timeout: 10_000 })
    await expect(nodePhoto).toHaveAttribute('src', TEST_PHOTO_DATA_URL)
  })
})
