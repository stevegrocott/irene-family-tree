import { test, expect, type Route } from '@playwright/test'

/**
 * E2E tests for the NextAuth Google sign-in flow (issue #53).
 *
 * Verifies:
 *   1. AuthButton renders on the canvas and clicking "Sign in" redirects
 *      the browser to Google's OAuth consent URL.
 *   2. With a mocked signed-in session, AuthButton displays the user's name
 *      and exposes a "Sign out" control.
 *   3. Unauthenticated navigation to /admin is redirected to the NextAuth
 *      sign-in flow by the `src/proxy.ts` matcher.
 */

// Fulfils Google's OAuth authorize endpoint with an inert HTML body so the
// browser stops at the redirect URL without making an external network call.
async function stubGoogleOAuth(routeTarget: Route) {
  await routeTarget.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<html><body>Stubbed Google OAuth</body></html>',
  })
}

test.describe('AuthButton on the canvas', () => {
  test('is visible and clicking "Sign in" redirects to Google OAuth', async ({ page }) => {
    // The reused dev server may lack AUTH_SECRET, which causes NextAuth to fail
    // at every API endpoint. Stub the three endpoints that signIn('google')
    // fetches before it sets window.location to the OAuth URL so this test
    // runs reliably without real server auth config. Regex matchers are used
    // because next-auth posts to `/api/auth/signin/google?` (trailing `?`
    // from an empty query string) and Playwright globs are fully anchored
    // with `?` as a literal, so a glob ending in `google` would not match.
    await page.route(/\/api\/auth\/providers\b/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          google: {
            id: 'google',
            name: 'Google',
            type: 'oauth',
            signinUrl: '/api/auth/signin/google',
            callbackUrl: '/api/auth/callback/google',
          },
        }),
      })
    )
    await page.route(/\/api\/auth\/csrf\b/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: 'e2e-mock-csrf-token' }),
      })
    )
    const googleOAuthUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=e2e-test-google-client-id&response_type=code&scope=openid+email+profile'
    await page.route(/\/api\/auth\/signin\/google\b/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: googleOAuthUrl }),
      })
    )
    await page.route(/accounts\.google\.com/, stubGoogleOAuth)

    await page.goto('/')

    const authButton = page.getByTestId('auth-button')
    await expect(authButton).toBeVisible()
    await expect(authButton).toHaveText(/sign in/i)

    await authButton.click()

    await page.waitForURL(/accounts\.google\.com\/o\/oauth2/, { timeout: 15_000 })
    expect(page.url()).toContain('accounts.google.com')
  })
})

test.describe('AuthButton with a mocked signed-in session', () => {
  const signedInUser = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    image: null,
  }

  test.beforeEach(async ({ page }) => {
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
  })

  test('shows the user name and a Sign out control', async ({ page }) => {
    await page.goto('/')

    const authButton = page.getByTestId('auth-button')
    await expect(authButton).toBeVisible()

    await expect(page.getByTestId('auth-button-name')).toHaveText(signedInUser.name)
    await expect(page.getByTestId('auth-button-signout')).toBeVisible()
    await expect(page.getByTestId('auth-button-signout')).toHaveText(/sign out/i)
  })
})

test.describe('Proxy protection for /admin', () => {
  test('redirects unauthenticated visitors to the sign-in flow', async ({ page }) => {
    // Stub Google in case NextAuth auto-forwards to the provider.
    await page.route(/accounts\.google\.com/, stubGoogleOAuth)

    const response = await page.goto('/admin', { waitUntil: 'domcontentloaded' })

    // The proxy (src/proxy.ts) redirects unauthenticated requests to
    // /api/auth/signin. Depending on NextAuth's handler, the browser may land
    // on the sign-in page or be forwarded onward to Google.
    const landedUrl = page.url()
    const redirected =
      /\/api\/auth\/signin/.test(landedUrl) || /accounts\.google\.com/.test(landedUrl)
    expect(redirected, `expected redirect to sign-in, got ${landedUrl}`).toBe(true)

    // The final response must not be the /admin page itself.
    expect(response?.url()).not.toMatch(/\/admin(?:$|\?|\/)/)
  })
})
