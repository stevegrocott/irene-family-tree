import { test, expect } from '@playwright/test'
import { encode } from '@auth/core/jwt'

/**
 * E2E test for the admin GEDCOM export download (issue #147).
 *
 * Covers: clicking "Download GEDCOM" on /admin triggers a browser download
 * whose filename and body reflect the /api/admin/export response.
 */

async function adminSessionToken(): Promise<string> {
  return encode({
    token: {
      name: 'E2E Admin',
      email: 'admin@test.com',
      picture: null,
      sub: 'e2e-admin-001',
      role: 'admin',
    },
    secret: process.env.AUTH_SECRET ?? 'e2e-test-auth-secret',
    salt: 'authjs.session-token',
  })
}

async function setAdminCookie(context: import('@playwright/test').BrowserContext) {
  const token = await adminSessionToken()
  await context.addCookies([{
    name: 'authjs.session-token',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }])
}

const mockGedcom = '0 HEAD\n1 SOUR irene-family-tree\n0 TRLR'

test.describe('Admin GEDCOM export (/admin)', () => {
  test.beforeEach(async ({ context }) => {
    await setAdminCookie(context)
  })

  test('clicking Download GEDCOM downloads a .ged file starting with "0 HEAD"', async ({ page }) => {
    await page.route(/\/api\/admin\/export/, route => {
      route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        headers: {
          'Content-Disposition': 'attachment; filename="family-tree-2026-07-11.ged"',
        },
        body: mockGedcom,
      })
    })

    await page.goto('/admin')
    await page.waitForLoadState('networkidle')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download GEDCOM' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/^family-tree-\d{4}-\d{2}-\d{2}\.ged$/)

    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    const body = Buffer.concat(chunks).toString('utf-8')
    expect(body.startsWith('0 HEAD')).toBe(true)
  })
})
