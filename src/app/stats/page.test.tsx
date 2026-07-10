/**
 * @jest-environment jsdom
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import StatsPage from '@/app/stats/page'

/** Full StatsResponse fixture matching the shape returned by GET /api/stats. */
function makeStats(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    totalPeople: 42,
    sexBreakdown: { male: 20, female: 21, unknown: 1 },
    unionCount: 15,
    birthsByDecade: [
      { decade: 1900, count: 3 },
      { decade: 1950, count: 10 },
    ],
    topSurnames: [
      { surname: 'Smith', count: 8 },
      { surname: 'Doe', count: 5 },
    ],
    topBirthplaces: [
      { birthPlace: 'London', count: 6 },
      { birthPlace: 'Paris', count: 2 },
    ],
    averageLifespan: 72.4,
    oldestAncestor: { gedcomId: 'I001', name: 'John Smith', birthYear: '1850' },
    largestUnion: { unionId: 'U001', childCount: 6, parents: ['John Smith', 'Jane Smith'] },
    ...overrides,
  }
}

describe('StatsPage', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  async function renderStatsPage() {
    await act(async () => {
      root = createRoot(container)
      root.render(<StatsPage />)
    })
    await act(async () => { await Promise.resolve() })
  }

  it('shows a loading state while the fetch is in flight', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    global.fetch = jest.fn().mockImplementation(
      () => new Promise(resolve => { resolveFetch = resolve })
    )

    await act(async () => {
      root = createRoot(container)
      root.render(<StatsPage />)
    })

    expect(container.querySelector('[data-testid="stats-loading"]')).not.toBeNull()

    await act(async () => {
      resolveFetch({ ok: true, json: async () => makeStats() })
      await Promise.resolve()
    })
  })

  it('renders stat cards and bar charts after a successful fetch', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => makeStats() })

    await renderStatsPage()

    expect(container.querySelector('[data-testid="stats-loading"]')).toBeNull()
    expect(container.querySelector('[data-testid="stats-error"]')).toBeNull()

    const totalPeople = container.querySelector('[data-testid="stats-total-people"]')
    expect(totalPeople).not.toBeNull()
    expect(totalPeople!.textContent).toContain('42')

    const unionCount = container.querySelector('[data-testid="stats-union-count"]')
    expect(unionCount!.textContent).toContain('15')

    const decadesChart = container.querySelector('[data-testid="stats-decades-chart"]')
    expect(decadesChart).not.toBeNull()
    expect(decadesChart!.querySelectorAll('[data-testid="stats-decades-chart-bar"]').length).toBe(2)

    const surnamesChart = container.querySelector('[data-testid="stats-surnames-chart"]')
    expect(surnamesChart).not.toBeNull()
    expect(surnamesChart!.textContent).toContain('Smith')

    const birthplacesChart = container.querySelector('[data-testid="stats-birthplaces-chart"]')
    expect(birthplacesChart).not.toBeNull()
    expect(birthplacesChart!.textContent).toContain('London')

    const backLink = container.querySelector('[data-testid="stats-back-link"]')
    expect(backLink).not.toBeNull()
    expect(backLink!.getAttribute('href')).toBe('/')
  })

  it('renders "no data" placeholders for empty chart arrays instead of blank sections', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => makeStats({
        birthsByDecade: [],
        topSurnames: [],
        topBirthplaces: [],
        averageLifespan: null,
        oldestAncestor: null,
        largestUnion: null,
      }),
    })

    await renderStatsPage()

    const decadesChart = container.querySelector('[data-testid="stats-decades-chart"]')
    expect(decadesChart!.querySelectorAll('[data-testid="stats-decades-chart-bar"]').length).toBe(0)
    expect(decadesChart!.textContent).toContain('No data')
  })

  it('shows an error state and a back link when the fetch rejects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await renderStatsPage()

    const errorEl = container.querySelector('[data-testid="stats-error"]')
    expect(errorEl).not.toBeNull()
    expect(container.querySelector('[data-testid="stats-loading"]')).toBeNull()

    const backLink = container.querySelector('[data-testid="stats-back-link"]')
    expect(backLink).not.toBeNull()
    expect(backLink!.getAttribute('href')).toBe('/')
  })

  it('shows an error state when the API responds with a non-2xx status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await renderStatsPage()

    expect(container.querySelector('[data-testid="stats-error"]')).not.toBeNull()
  })
})
