import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay indicator renders bottom-left by default, which is exactly
  // where the collapsed mobile toolbar toggle sits (issue #202) — its portal
  // intercepts pointer events and makes the button untappable under Playwright.
  // Only disabled for the E2E dev server; normal `npm run dev` keeps it.
  devIndicators: process.env.PLAYWRIGHT_E2E === '1' ? false : undefined,
};

export default nextConfig;
