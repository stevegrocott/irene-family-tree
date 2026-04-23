import type { Page, Route } from '@playwright/test'

/** Signed-in user surfaced by the mocked next-auth session endpoint. */
export const signedInUser = {
  name: 'E2E Test User',
  email: 'e2e@example.com',
  image: null,
}

/** Mocks `/api/auth/session` with a signed-in user, expiring in 2099. */
export async function mockSignedInSession(page: Page) {
  await page.route(/\/api\/auth\/session\b/, (route: Route) =>
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

/**
 * Mocks `/api/persons` and `/api/tree/...` with the provided fixtures so the
 * canvas can render without hitting Neo4j.
 */
export async function mockPersonsAndTree(
  page: Page,
  persons: unknown[],
  treeResponse: unknown,
) {
  await page.route(/\/api\/persons/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(persons),
    })
  )

  await page.route(/\/api\/tree\//, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(treeResponse),
    })
  )
}
