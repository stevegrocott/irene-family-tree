import { test, expect } from '@playwright/test';

/**
 * E2E coverage for issue #223 (register Source Serif 4 via next/font).
 *
 * Verifies `--font-source-serif` is registered on <html> by next/font,
 * matching the existing Geist setup (`--font-geist-sans` / `--font-geist-mono`).
 * tokens.css's `--ft-font-serif` stack starts with `var(--font-source-serif)`,
 * so an empty value here would silently fall back to the next font in that
 * stack instead of loading the intended typeface.
 */

test.describe('Source Serif 4 font registration (issue #223)', () => {
  test('--font-source-serif resolves to a non-empty value', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const value = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font-source-serif').trim()
    );

    expect(value).not.toBe('');
  });

  test('--font-source-serif references the Source Serif 4 font family', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const value = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font-source-serif').trim()
    );

    expect(value.toLowerCase()).toContain('source serif 4');
  });
});
