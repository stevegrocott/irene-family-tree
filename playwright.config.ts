import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: 'http://localhost:3000',
    // Seeds `family-tree-root-id` with the default person (`@I85@`) so a bare
    // `page.goto('/')` lands on the viewer canvas instead of the cold-start
    // entry state (issue #232). `FamilyTree` resolves the URL `root`/`person`
    // param ahead of localStorage, so specs targeting their own fixture data
    // must navigate with `?root=`/`?person=` (see `gotoViewer` in
    // `tests/e2e/helpers/viewer.ts`) rather than relying on this seed. Specs
    // that need the entry state itself override storageState per-file.
    storageState: 'tests/e2e/helpers/viewer-storage.json',
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
      // Hides the Next.js dev overlay indicator, which otherwise sits bottom-left
      // and intercepts taps on the collapsed mobile toolbar toggle (issue #202).
      PLAYWRIGHT_E2E: '1',
      // Client-visible E2E flag (NEXT_PUBLIC_ prefix required for browser-bundle
      // access). Gates test-only hooks like SuggestionsReview's
      // `window.__setSuggestions` so they compile out of production builds.
      NEXT_PUBLIC_E2E: '1',
      // Provide NextAuth config to the dev server so auth flows can boot
      // during E2E tests without real Google credentials. Tests stub
      // accounts.google.com, so these IDs never leave the test process.
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-test-auth-secret',
      AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID ?? 'e2e-test-google-client-id',
      AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET ?? 'e2e-test-google-client-secret',
    },
  },
});
