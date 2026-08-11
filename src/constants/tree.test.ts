import { getDefaultDensity, MOBILE_DENSITY_BREAKPOINT_PX, SEX_AVATAR_BG, SEX_AVATAR_TEXT } from './tree'

/**
 * docs/DESIGN_SYSTEM.md §3.2: "M #4A7DB5 · F #A85F86 · unknown
 * var(--ft-border-strong) (these two are the ONLY tints outside the semantic
 * set, and they appear nowhere else in the product)". `tree.ts` is the single
 * source of truth for these — every consumer (avatar fill, avatar text, node
 * tick, search tick) must read from here rather than redefining them.
 */
describe('sex colour maps', () => {
  it.each([
    ['SEX_AVATAR_BG', SEX_AVATAR_BG],
    ['SEX_AVATAR_TEXT', SEX_AVATAR_TEXT],
  ])('%s uses the exact §3.2 tints, not the default Tailwind palette', (_name, map) => {
    expect(map.M).toBe('#4A7DB5')
    expect(map.F).toBe('#A85F86')
    expect(map.default).toBe('var(--ft-border-strong)')
  })
})

describe('getDefaultDensity', () => {
  it('resolves to "dense" just below the mobile breakpoint (640px)', () => {
    expect(getDefaultDensity(MOBILE_DENSITY_BREAKPOINT_PX - 1)).toBe('dense')
  })

  it('resolves the breakpoint itself (640px) to "compact", not "dense"', () => {
    expect(getDefaultDensity(MOBILE_DENSITY_BREAKPOINT_PX)).toBe('compact')
  })

  it('resolves values above the breakpoint to "compact"', () => {
    expect(getDefaultDensity(1024)).toBe('compact')
  })

  it('resolves a typical phone width (360px) to "dense"', () => {
    expect(getDefaultDensity(360)).toBe('dense')
  })
})
