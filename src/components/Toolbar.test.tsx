/**
 * @jest-environment jsdom
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Toolbar } from '@/components/FamilyTree'
import { APP_NAME } from '@/constants/branding'
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

/**
 * Factory helper to create a mock PersonData node for testing.
 *
 * @param {string} id - Node ID (typically a GEDCOM ID like '@I0@')
 * @param {number} generation - Generation level relative to root (negative=ancestors, positive=descendants)
 * @param {string} name - Display name of the person
 * @returns {Node<PersonData>} A fully-formed ReactFlow person node
 */
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

    const ancestors = container.querySelector('[data-testid="toolbar-gen-up"]')
    expect(ancestors).not.toBeNull()
    expect(ancestors!.textContent).toContain('3')

    const descendants = container.querySelector('[data-testid="toolbar-gen-down"]')
    expect(descendants).not.toBeNull()
    expect(descendants!.textContent).toContain('1')

    const viewing = container.querySelector('[data-testid="toolbar-viewing"]')
    expect(viewing).not.toBeNull()
    expect(viewing!.textContent).toContain('Root Person')

    const slider = container.querySelector('[data-testid="toolbar-depth-slider"]')
    expect(slider).not.toBeNull()
  })

  it('renders the app name from branding constants as the title', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <Toolbar
          nodes={[makePersonNode('@I0@', 0, 'Root Person')]}
          rootName="Root Person"
          hops={3}
          onHopsChange={jest.fn()}
        />,
      )
    })

    const appName = container.querySelector('[data-testid="toolbar-app-name"]')
    expect(appName).not.toBeNull()
    expect(appName!.textContent).toBe(APP_NAME)
  })

  it('renders no toolbar (and no app name) when there are no person nodes', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <Toolbar nodes={[]} rootName="" hops={3} onHopsChange={jest.fn()} />,
      )
    })

    expect(container.querySelector('[data-testid="toolbar"]')).toBeNull()
    expect(container.querySelector('[data-testid="toolbar-app-name"]')).toBeNull()
  })

  it('renders a Stats link pointing to /stats', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <Toolbar
          nodes={[makePersonNode('@I0@', 0, 'Root Person')]}
          rootName="Root Person"
          hops={3}
          onHopsChange={jest.fn()}
        />,
      )
    })

    const statsLink = container.querySelector('[data-testid="toolbar-stats-link"]')
    expect(statsLink).not.toBeNull()
    expect(statsLink!.getAttribute('href')).toBe('/stats')
  })

  describe('truncation notice', () => {
    it('shows a truncation notice when truncated is true', async () => {
      await act(async () => {
        root = createRoot(container)
        root.render(
          <Toolbar
            nodes={[makePersonNode('@I0@', 0, 'Root Person')]}
            rootName="Root Person"
            hops={3}
            onHopsChange={jest.fn()}
            truncated={true}
            totalNodes={588}
          />,
        )
      })

      const notice = container.querySelector('[data-testid="toolbar-truncation-notice"]')
      expect(notice).not.toBeNull()
      expect(notice!.textContent).toMatch(/truncat/i)
      expect(notice!.textContent).toContain('588')
    })

    it('constrains the truncation notice to one line with a max-width and ellipsis, with the full text available via title', async () => {
      await act(async () => {
        root = createRoot(container)
        root.render(
          <Toolbar
            nodes={[makePersonNode('@I0@', 0, 'Root Person')]}
            rootName="Root Person"
            hops={3}
            onHopsChange={jest.fn()}
            truncated={true}
            totalNodes={588}
          />,
        )
      })

      const notice = container.querySelector('[data-testid="toolbar-truncation-notice"]')
      expect(notice).not.toBeNull()
      // One line, max-width, ellipsis for overflow — matches the truncation
      // pattern already used elsewhere (e.g. PersonNode.tsx).
      expect(notice!.className).toEqual(expect.stringContaining('whitespace-nowrap'))
      expect(notice!.className).toEqual(expect.stringContaining('overflow-hidden'))
      expect(notice!.className).toEqual(expect.stringContaining('text-ellipsis'))
      expect(notice!.className).toMatch(/max-w-/)
      // Full text preserved via title so it's still available (e.g. on hover).
      expect(notice!.getAttribute('title')).toBe(notice!.textContent)
    })

    it('shows no truncation notice when truncated is false', async () => {
      await act(async () => {
        root = createRoot(container)
        root.render(
          <Toolbar
            nodes={[makePersonNode('@I0@', 0, 'Root Person')]}
            rootName="Root Person"
            hops={3}
            onHopsChange={jest.fn()}
            truncated={false}
            totalNodes={2}
          />,
        )
      })

      expect(container.querySelector('[data-testid="toolbar-truncation-notice"]')).toBeNull()
    })

    it('shows no truncation notice when truncated is omitted', async () => {
      await act(async () => {
        root = createRoot(container)
        root.render(
          <Toolbar
            nodes={[makePersonNode('@I0@', 0, 'Root Person')]}
            rootName="Root Person"
            hops={3}
            onHopsChange={jest.fn()}
          />,
        )
      })

      expect(container.querySelector('[data-testid="toolbar-truncation-notice"]')).toBeNull()
    })
  })

  describe('layout resilience at tight widths', () => {
    it('bounds the toolbar container width to the viewport so it cannot overhang either edge', async () => {
      await act(async () => {
        root = createRoot(container)
        root.render(
          <Toolbar
            nodes={[makePersonNode('@I0@', 0, 'Root Person')]}
            rootName="Root Person"
            hops={3}
            onHopsChange={jest.fn()}
          />,
        )
      })

      // Issue #190: the toolbar is centered via left-1/2 + -translate-x-1/2
      // with an auto width above the `sm` breakpoint, so once its intrinsic
      // content width exceeds the viewport it overhangs symmetrically and
      // gets clipped at both edges. A max-width bound tied to the viewport
      // (not a fixed pixel value) caps the box so it can only shrink toward
      // the centerline instead of growing past it.
      const toolbar = container.querySelector('[data-testid="toolbar"]')
      expect(toolbar).not.toBeNull()
      expect(toolbar!.className).toMatch(/max-w-\[calc\(100vw/)
    })

    it('prevents toolbar items from shrinking (and their text wrapping into columns) when space is tight', async () => {
      const nodes: Node<PersonData>[] = [
        makePersonNode('@I0@', 0, 'Root Person'),
        makePersonNode('@I1@', -1, 'Parent One'),
        makePersonNode('@I2@', 1, 'Child One'),
      ]
      const getShareUrl = jest.fn().mockReturnValue('https://example.com/?root=%40I0%40')

      await act(async () => {
        root = createRoot(container)
        root.render(
          <Toolbar
            nodes={nodes}
            rootName="Root Person"
            hops={3}
            onHopsChange={jest.fn()}
            getShareUrl={getShareUrl}
          />,
        )
      })

      // Every item in the toolbar's flex row must resist the browser's
      // default flex-shrink behavior and keep its text on one line —
      // otherwise, at widths just below the point where the whole row
      // would wrap, individual items shrink below their content width and
      // their text wraps into a tall, cramped column instead of the item
      // moving to the next row as a whole.
      const shrinkResistantTestIds = [
        'toolbar-app-name',
        'toolbar-person-count',
        'toolbar-gen-up',
        'toolbar-gen-down',
        'toolbar-viewing',
        'toolbar-depth-slider',
        'toolbar-copy-link',
        'toolbar-stats-link',
      ]

      for (const testId of shrinkResistantTestIds) {
        const el = container.querySelector(`[data-testid="${testId}"]`)
        expect(el).not.toBeNull()
        expect(el!.className).toEqual(expect.stringContaining('flex-shrink-0'))
      }

      // Text-bearing items must also disallow internal line-wrapping so a
      // shrink-resistant item can't still wrap its own text.
      const noWrapTestIds = [
        'toolbar-app-name',
        'toolbar-person-count',
        'toolbar-gen-up',
        'toolbar-gen-down',
        'toolbar-viewing',
        'toolbar-copy-link',
        'toolbar-stats-link',
      ]

      for (const testId of noWrapTestIds) {
        const el = container.querySelector(`[data-testid="${testId}"]`)
        expect(el).not.toBeNull()
        expect(el!.className).toEqual(expect.stringContaining('whitespace-nowrap'))
      }
    })
  })

  describe('copy link button', () => {
    it('is not rendered when getShareUrl is not provided', async () => {
      await act(async () => {
        root = createRoot(container)
        root.render(
          <Toolbar
            nodes={[makePersonNode('@I0@', 0, 'Root Person')]}
            rootName="Root Person"
            hops={3}
            onHopsChange={jest.fn()}
          />,
        )
      })

      expect(container.querySelector('[data-testid="toolbar-copy-link"]')).toBeNull()
    })

    it('copies the URL from getShareUrl and shows a transient "Copied!" confirmation', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })
      const getShareUrl = jest.fn().mockReturnValue('https://example.com/?root=%40I0%40')

      await act(async () => {
        root = createRoot(container)
        root.render(
          <Toolbar
            nodes={[makePersonNode('@I0@', 0, 'Root Person')]}
            rootName="Root Person"
            hops={3}
            onHopsChange={jest.fn()}
            getShareUrl={getShareUrl}
          />,
        )
      })

      const copyBtn = container.querySelector('[data-testid="toolbar-copy-link"]') as HTMLButtonElement
      expect(copyBtn).not.toBeNull()

      await act(async () => { copyBtn.click() })

      expect(writeText).toHaveBeenCalledWith('https://example.com/?root=%40I0%40')
      expect(copyBtn.textContent).toBe('Copied!')
    })
  })
})
