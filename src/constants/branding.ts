/**
 * Centralised branding constants.
 *
 * Renaming the product (or pointing it at a different domain) should be a
 * one-line change here rather than a hunt through `layout.tsx` and friends.
 * `APP_NAME` can also be overridden per-environment via `NEXT_PUBLIC_APP_NAME`
 * without a code change.
 */

/** Product name shown in the browser tab, OpenGraph/Twitter cards, and the UI. */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Irene Family Tree'

/** One-line description used for the meta description and social previews. */
export const APP_DESCRIPTION =
  'A genealogy and family tree viewer with suggestion and admin-review workflows.'

/** Canonical deployed URL, used as the metadata base for resolving absolute asset/OG URLs. */
export const SITE_URL = 'https://tree.grocott.com.au'

/** Matches the dark viewer canvas background (see `body` in globals.css). */
export const THEME_COLOR = '#050a18'
