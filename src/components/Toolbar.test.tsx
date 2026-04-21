/**
 * @jest-environment jsdom
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Toolbar } from '@/components/FamilyTree'
import type { Node } from 'reactflow'
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

function makePersonNode(id: string, generation: number, name: string): Node<PersonData> {
  return {
    id,
    type: 'person',
    position: { x: 0, y: 0 },
    data: {
      gedcomId: id,
      name,
      sex: 'M',
      birthYear: null,
      deathYear: null,
      birthPlace: null,
      deathPlace: null,
      occupation: null,
      notes: null,
      generation,
    },
  }
}

describe('Toolbar', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    document.body.removeChild(container)
    jest.clearAllMocks()
  })

  it('shows ancestor count, descendant count, viewing name, and slider', async () => {
    const nodes: Node<PersonData>[] = [
      makePersonNode('@I0@', 0, 'Root Person'),
      makePersonNode('@I1@', -1, 'Parent One'),
      makePersonNode('@I2@', -2, 'Grandparent One'),
      makePersonNode('@I3@', -3, 'Great-grandparent One'),
      makePersonNode('@I4@', 1, 'Child One'),
    ]

    await act(async () => {
      root = createRoot(container)
      root.render(
        <Toolbar
          nodes={nodes}
          rootName="Root Person"
          hops={3}
          onHopsChange={jest.fn()}
        />,
      )
    })

    const ancestors = container.querySelector('[data-testid="toolbar-ancestors"]')
    expect(ancestors).not.toBeNull()
    expect(ancestors!.textContent).toContain('3')

    const descendants = container.querySelector('[data-testid="toolbar-descendants"]')
    expect(descendants).not.toBeNull()
    expect(descendants!.textContent).toContain('1')

    const viewing = container.querySelector('[data-testid="toolbar-viewing"]')
    expect(viewing).not.toBeNull()
    expect(viewing!.textContent).toContain('Root Person')

    const slider = container.querySelector('input[type="range"]')
    expect(slider).not.toBeNull()
  })
})
