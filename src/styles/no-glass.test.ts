import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// Repo-wide guard for docs/DESIGN_SYSTEM.md §1: no glassmorphism, no glow
// shadows, no oversized radii. Keeps a de-glassed surface from regressing.
const SRC_ROOT = join(__dirname, '..')
const GUARD_FILE = __filename

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.css']

const BANNED_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'bg-white/<opacity>', pattern: /bg-white\/\d+/g },
  { name: 'rounded-2xl', pattern: /rounded-2xl/g },
  { name: 'rounded-xl', pattern: /rounded-xl/g },
  { name: 'glow shadow (shadow-[0_0...])', pattern: /shadow-\[0_0/g },
]

// backdrop-blur is permitted on exactly two surfaces: the modal scrim overlay
// in ConfirmDialog.tsx and the search overlay scrim in SearchOverlay.tsx
// (docs/DESIGN_SYSTEM.md §1).
const BACKDROP_BLUR_ALLOWLIST = new Set(['components/ConfirmDialog.tsx', 'components/SearchOverlay.tsx'])

// Classes the design-system migration deleted from src/ entirely. If one of
// these reappears in an E2E spec, the spec has coupled itself to a style
// class rather than shipped behaviour (issue #245) — the same failure mode
// that let `ring-amber` sit unnoticed in two specs after §3.2 removed it.
const SPECS_ROOT = join(__dirname, '..', '..', 'tests', 'e2e')

const REMOVED_DESIGN_SYSTEM_CLASSES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'ring-amber', pattern: /ring-amber/g },
]

function collectFiles(dir: string, extensions: string[], exclude: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectFiles(fullPath, extensions, exclude))
    } else if (extensions.some(ext => entry.endsWith(ext)) && fullPath !== exclude) {
      files.push(fullPath)
    }
  }
  return files
}

describe('no-glass guard', () => {
  const files = collectFiles(SRC_ROOT, SCAN_EXTENSIONS, GUARD_FILE)

  it.each(BANNED_PATTERNS)('contains no $name usage anywhere in src/', ({ pattern }) => {
    const violations: string[] = []
    for (const file of files) {
      const matches = readFileSync(file, 'utf8').match(pattern)
      if (matches) {
        violations.push(`${relative(SRC_ROOT, file)}: ${matches.length} match(es)`)
      }
    }
    expect(violations).toEqual([])
  })

  it('restricts backdrop-blur to the dialog scrim only', () => {
    const violations: string[] = []
    for (const file of files) {
      const rel = relative(SRC_ROOT, file)
      if (/backdrop-blur/.test(readFileSync(file, 'utf8')) && !BACKDROP_BLUR_ALLOWLIST.has(rel)) {
        violations.push(rel)
      }
    }
    expect(violations).toEqual([])
  })
})

describe('no-glass guard: removed design-system classes must not reappear in specs', () => {
  const specFiles = collectFiles(SPECS_ROOT, ['.spec.ts'], GUARD_FILE)

  it.each(REMOVED_DESIGN_SYSTEM_CLASSES)('contains no $name usage anywhere in tests/e2e specs', ({ pattern }) => {
    const violations: string[] = []
    for (const file of specFiles) {
      const matches = readFileSync(file, 'utf8').match(pattern)
      if (matches) {
        violations.push(`${relative(SPECS_ROOT, file)}: ${matches.length} match(es)`)
      }
    }
    expect(violations).toEqual([])
  })
})
