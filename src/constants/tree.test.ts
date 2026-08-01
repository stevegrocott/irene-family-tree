import { getDefaultDensity, MOBILE_DENSITY_BREAKPOINT_PX } from './tree'

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
