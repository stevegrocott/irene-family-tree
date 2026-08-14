'use client'

/**
 * "Download GEDCOM" control for `/admin` (issue #147).
 *
 * Renders as an `<a role="link">` — matching the accessible name/role the
 * E2E suite targets via `getByRole('link', { name: 'Download GEDCOM' })` —
 * but drives the download through `fetch()` + a blob URL instead of a plain
 * `href="/api/admin/export" download` navigation.
 *
 * A native anchor-download navigation bypasses Playwright's `page.route()`
 * network interception (confirmed: a mocked `/api/admin/export` handler
 * never fires for it), so specs that mock the export response silently fall
 * through to the real endpoint. On this app's dev environment that endpoint
 * 500s when Neo4j is unreachable, and the browser downloads that JSON error
 * body under a guessed "export.json" name with no on-screen indication
 * anything went wrong. Routing the download through `fetch()` fixes both:
 * it's interceptable by tests, and a failed export now surfaces an inline
 * error instead of silently downloading nothing useful.
 */
export function GedcomExportLink() {
  async function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()

    try {
      const res = await fetch('/api/admin/export')
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`)
      }

      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filename = disposition.match(/filename="?([^"]+)"?/)?.[1] ?? 'family-tree.ged'

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('GEDCOM export failed:', err)
    }
  }

  return (
    <a
      href="/api/admin/export"
      onClick={handleClick}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-[var(--ft-r-md)] text-sm font-medium bg-accent hover:bg-[var(--ft-accent-hover)] text-[var(--ft-text-on-accent)] shadow-[var(--ft-shadow-1)] transition-colors"
    >
      Download GEDCOM
    </a>
  )
}
