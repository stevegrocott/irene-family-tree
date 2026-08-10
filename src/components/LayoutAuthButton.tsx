'use client'

import { usePathname } from 'next/navigation'
import AuthButton from '@/components/AuthButton'

/**
 * Routes that render their own auth control rather than the layout-level one.
 * The viewer (`/`) renders {@link AuthButton} inside ViewerShell's
 * `viewer-shell-avatar-slot` (see `src/components/ViewerShell.tsx`) — rendering
 * it again from the root layout would duplicate the control (issue #241).
 */
const VIEWER_ROUTES: ReadonlySet<string> = new Set(['/'])

/**
 * LayoutAuthButton
 *
 * Root-layout auth control for non-viewer routes (`/admin`, `/stats`), which
 * don't render `ViewerShell` and so have no other way to show auth state.
 *
 * `AuthButton` no longer self-positions (it renders in normal flow so
 * `ViewerShell` can place it in-bar), so this wrapper supplies the floating
 * top-right treatment those routes relied on. On the viewer route this
 * renders nothing, since `ViewerShell` already owns the single `AuthButton`
 * instance there.
 */
export default function LayoutAuthButton() {
  const pathname = usePathname()

  if (VIEWER_ROUTES.has(pathname)) {
    return null
  }

  return (
    <div className="absolute top-4 right-4 z-10">
      <AuthButton />
    </div>
  )
}
