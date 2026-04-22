import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      // Provide NextAuth config to the dev server so auth flows can boot
      // during E2E tests without real Google credentials. Tests stub
      // accounts.google.com, so these IDs never leave the test process.
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-test-auth-secret',
      AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID ?? 'e2e-test-google-client-id',
      AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET ?? 'e2e-test-google-client-secret',
    },
  },
});
