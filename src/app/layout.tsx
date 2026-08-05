import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import Script from "next/script";
import { SessionProvider } from "next-auth/react";
import AuthButton from "@/components/AuthButton";
import { APP_NAME, APP_DESCRIPTION, SITE_URL, THEME_COLOR } from "@/constants/branding";
import "./globals.css";

/** localStorage key the theme choice is persisted under. */
const THEME_STORAGE_KEY = "theme";

/** Server-rendered default — must match `:root` (no `[data-theme]`) in tokens.css. */
const DEFAULT_THEME = "light";

/**
 * Resolves and applies the theme before first paint, so `data-theme` is
 * correct by the time anything renders — a `useEffect` runs after paint and
 * would cause a flash of the wrong theme.
 *
 * Loaded via `next/script` with `strategy="beforeInteractive"`, which always
 * injects into `<head>` and runs before hydration. It only ever touches the
 * `data-theme` attribute on `<html>` (never children), which is why `<html>`
 * below is marked `suppressHydrationWarning` — that scopes the intentional
 * mismatch to just that attribute instead of hiding real bugs.
 *
 * Falls back to the OS preference when nothing is stored yet, then writes
 * the resolved value back so the choice is stable across reloads. Wrapped
 * in try/catch because `localStorage` can throw (private browsing, disabled
 * storage) — in that case we keep the server-rendered default.
 */
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : '${DEFAULT_THEME}');
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('${THEME_STORAGE_KEY}', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', '${DEFAULT_THEME}');
  }
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    url: SITE_URL,
    siteName: APP_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <SessionProvider>
          <AuthButton />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
