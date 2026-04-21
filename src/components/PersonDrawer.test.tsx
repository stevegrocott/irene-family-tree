/**
 * @jest-environment jsdom
 */

// Tell React we're in a test environment so act() works correctly
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PersonDrawer } from '@/components/FamilyTree'
import type { PersonData } from '@/types/tree'

jest.mock('reactflow', () => ({
  default: () => null,
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MiniMap: () => null,
  ReactFlowProvider: () => null,
  useReactFlow: () => ({ fitView: jest.fn(), setCenter: jest.fn() }),
  getViewportForBounds: () => ({ x: 0, y: 0, zoom: 1 }),
}))
jest.mock('reactflow/dist/style.css', () => ({}))
jest.mock('@/components/PersonNode', () => ({ default: () => null }))
jest.mock('@/components/UnionNode', () => ({ default: () => null }))
jest.mock('@/components/SearchBar', () => ({ default: () => null }))
jest.mock('@/lib/layout', () => ({
  applyDagreLayout: (nodes: unknown[], edges: unknown[]) => ({ nodes, edges }),
}))
jest.mock('@/lib/person', () => ({ formatLifespan: () => null }))
jest.mock('@/constants/tree', () => ({
  MIN_HOPS: 1,
  DEFAULT_HOPS: 3,
  MAX_HOPS: 10,
  EDGE_STYLES: { default: {} },
  EDGE_TYPES: {},
  DEFAULT_ROOT_GEDCOM_ID: '@I1@',
}))

const mockDetailResponse = {
  gedcomId: '@I1@',
  name: 'John Smith',
  sex: 'M',
  birthYear: null,
  deathYear: null,
  birthPlace: null,
  deathPlace: null,
  occupation: null,
  notes: null,
  parents: [
    { gedcomId: '@I2@', name: 'Father Smith', sex: 'M', birthYear: null, deathYear: null },
    { gedcomId: '@I3@', name: 'Mother Jones', sex: 'F', birthYear: null, deathYear: null },
  ],
  siblings: [
    { gedcomId: '@I4@', name: 'Sibling Smith', sex: 'M', birthYear: null, deathYear: null },
  ],
  marriages: [
    {
      unionId: '@F1@',
      marriageYear: null,
      marriagePlace: null,
      spouse: { gedcomId: '@I5@', name: 'Spouse Smith', sex: 'F', birthYear: null, deathYear: null },
      children: [],
    },
  ],
}

const basePerson: PersonData = {
  gedcomId: '@I1@',
  name: 'John Smith',
  sex: 'M',
  birthYear: null,
  deathYear: null,
  birthPlace: null,
  deathPlace: null,
  occupation: null,
  notes: null,
}

describe('PersonDrawer', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDetailResponse,
    })
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
    jest.clearAllMocks()
  })

  it('renders parents, siblings, and marriages sections with correct names', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <PersonDrawer
          person={basePerson}
          onClose={jest.fn()}
          onReroot={jest.fn()}
          onSelectPerson={jest.fn()}
        />
      )
    })

    // Flush the fetch promise and resulting state update
    await act(async () => { await Promise.resolve() })

    const parentsSection = container.querySelector('[data-testid="person-drawer-parents"]')
    expect(parentsSection?.textContent).toContain('Father Smith')
    expect(parentsSection?.textContent).toContain('Mother Jones')

    const siblingsSection = container.querySelector('[data-testid="person-drawer-siblings"]')
    expect(siblingsSection?.textContent).toContain('Sibling Smith')

    const marriagesSection = container.querySelector('[data-testid="person-drawer-marriages"]')
    expect(marriagesSection?.textContent).toContain('Spouse Smith')
  })

  it('clicking a parent row calls onSelectPerson with the parent gedcomId', async () => {
    const onSelectPerson = jest.fn()

    await act(async () => {
      root = createRoot(container)
      root.render(
        <PersonDrawer
          person={basePerson}
          onClose={jest.fn()}
          onReroot={jest.fn()}
          onSelectPerson={onSelectPerson}
        />
      )
    })

    await act(async () => { await Promise.resolve() })

    const parentsSection = container.querySelector('[data-testid="person-drawer-parents"]')
    const firstParentButton = parentsSection?.querySelector('button')
    expect(firstParentButton).not.toBeNull()

    await act(async () => { firstParentButton!.click() })

    expect(onSelectPerson).toHaveBeenCalledWith('@I2@')
  })
})
