import { test, expect } from '@playwright/test';

/**
 * E2E coverage for issue #197 (design 1/10 — wire tokens.css into globals
 * and add the data-theme switch).
 *
 * Verifies:
 *   AC1: --ft-surface-0 resolves to a non-empty value in the browser.
 *   AC2: that value differs between data-theme="light" and data-theme="dark".
 *   AC3: data-theme is present on <html> at first paint (no flash of the
 *        wrong theme — the value must already be set by the time
 *        `domcontentloaded` fires, proving it came from a synchronous
 *        pre-paint script rather than a post-hydration effect).
 *   AC4: the resolved theme survives a page reload, even when the
 *        underlying OS-level color-scheme preference changes in between —
 *        proving the persisted value wins over re-derivation from a live
 *        media query.
 *   AC5: no React hydration warning is emitted in the console on load.
 *
 * No theme-toggle UI exists yet (that lands in a later step of the design
 * system rollout), so themes are exercised directly via the `data-theme`
 * attribute / localStorage rather than a click path — there is no real user
 * control to drive here yet.
 */

// Contract assumed for the pre-paint persistence script added to
// src/app/layout.tsx: the resolved theme is written to localStorage under
// this key. Keep in sync with that implementation.
const THEME_STORAGE_KEY = 'theme';

test.describe('theme tokens (issue #197)', () => {
  test('--ft-surface-0 resolves to a non-empty value', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const value = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ft-surface-0').trim()
    );

    expect(value).not.toBe('');
  });

  test('--ft-surface-0 differs between light and dark themes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const lightValue = await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      return getComputedStyle(document.documentElement).getPropertyValue('--ft-surface-0').trim();
    });

    const darkValue = await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      return getComputedStyle(document.documentElement).getPropertyValue('--ft-surface-0').trim();
    });

    expect(lightValue).not.toBe('');
    expect(darkValue).not.toBe('');
    expect(darkValue).not.toBe(lightValue);
  });

  test('data-theme is present on <html> at first paint (no flash)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // A value that is already valid by `domcontentloaded` must have been set
    // by a synchronous script that ran during HTML parsing, not by a React
    // effect (which would need the JS bundle downloaded, parsed and
    // hydrated first — long after this point).
    const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(themeAttr).toMatch(/^(light|dark)$/);
  });

  test('the resolved theme survives a page reload despite a system preference change', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Flip the active theme the way the persistence script is expected to —
    // by setting the attribute and writing the same value to storage.
    await page.evaluate((storageKey) => {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem(storageKey, 'dark');
    }, THEME_STORAGE_KEY);

    // Change the OS-level preference without touching storage. If the app
    // re-derived the theme from the live media query on reload instead of
    // honoring the persisted value, this would flip it back to light.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const themeAfterReload = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(themeAfterReload).toBe('dark');

    const storedAfterReload = await page.evaluate(
      (storageKey) => localStorage.getItem(storageKey),
      THEME_STORAGE_KEY
    );
    expect(storedAfterReload).toBe('dark');
  });

  test('no React hydration warning is emitted on load', async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleMessages.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Wait for the app shell to finish hydrating before inspecting the
    // console — hydration warnings surface during/after this point.
    const appName = page.getByTestId('toolbar-app-name');
    await expect(appName).toBeVisible({ timeout: 15_000 });

    const hydrationWarnings = consoleMessages.filter((text) =>
      /hydration|did not match|server rendered|server-rendered/i.test(text)
    );
    expect(hydrationWarnings).toEqual([]);
  });
});
