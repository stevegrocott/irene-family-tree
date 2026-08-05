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

function collectFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectFiles(fullPath))
    } else if (SCAN_EXTENSIONS.some(ext => entry.endsWith(ext)) && fullPath !== GUARD_FILE) {
      files.push(fullPath)
    }
  }
  return files
}

describe('no-glass guard', () => {
  const files = collectFiles(SRC_ROOT)

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
