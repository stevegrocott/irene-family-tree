import { test, expect } from '@playwright/test';
import { APP_NAME } from '@/constants/branding';

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/');
});

test('homepage shows the app name in the title and on the page', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const escapedAppName = APP_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(page).toHaveTitle(new RegExp(escapedAppName));

  const appName = page.getByTestId('toolbar-app-name');
  await expect(appName).toBeVisible({ timeout: 15_000 });
  await expect(appName).toHaveText(APP_NAME);
});
