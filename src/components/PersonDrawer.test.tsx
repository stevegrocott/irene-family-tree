/**
 * @jest-environment jsdom
 */

// Tell React we're in a test environment so act() works correctly
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as NextAuthReact from 'next-auth/react'
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
    jest.restoreAllMocks()
  })

  function mockSession(role: 'admin' | 'user' | null) {
    if (role === null) {
      jest.spyOn(NextAuthReact, 'useSession').mockReturnValue({
        data: null,
        status: 'unauthenticated',
        update: async () => null,
      })
    } else {
      jest.spyOn(NextAuthReact, 'useSession').mockReturnValue({
        data: { user: { name: 'Test User', email: 't@example.com', image: null, role } } as never,
        status: 'authenticated',
        update: async () => null,
      })
    }
  }

  async function renderDrawer() {
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
    await act(async () => { await Promise.resolve() })
  }

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

  describe('Add parent — role-based routing', () => {
    const searchResult = [
      { gedcomId: '@I9@', name: 'Candidate Parent', sex: 'M', birthYear: null, deathYear: null },
    ]

    function installFetchMock() {
      const calls: Array<{ url: string; init?: RequestInit }> = []
      const personPath = `/api/person/${encodeURIComponent('@I1@')}`
      const fetchMock = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url === `${personPath}/my-changes`) {
          return { ok: true, json: async () => ({ createChange: null, relationshipChanges: [], updateChanges: [] }) }
        }
        if (url === `${personPath}/relationships`) {
          return { ok: true, status: 201, json: async () => ({ unionId: '@F_new@' }) }
        }
        if (url === '/api/suggestions') {
          return { ok: true, status: 201, json: async () => ({ id: 'new-suggestion-id' }) }
        }
        if (url.startsWith('/api/persons?q=')) {
          return { ok: true, json: async () => searchResult }
        }
        if (url.startsWith(personPath)) {
          return { ok: true, json: async () => mockDetailResponse }
        }
        return { ok: true, json: async () => ({}) }
      })
      global.fetch = fetchMock as unknown as typeof fetch
      return { calls, fetchMock }
    }

    async function openAddParentAndSelect() {
      const parentsSection = container.querySelector('[data-testid="person-drawer-parents"]')!
      const addParentBtn = Array.from(parentsSection.querySelectorAll('button'))
        .find(b => b.textContent?.includes('Add parent')) as HTMLButtonElement
      await act(async () => { addParentBtn.click() })

      const searchInput = container.querySelector('[data-testid="add-relative-search"]') as HTMLInputElement
      const setNativeValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )!.set!
      await act(async () => {
        setNativeValue.call(searchInput, 'Candidate')
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => { await new Promise(r => setTimeout(r, 350)) })
      await act(async () => { await Promise.resolve() })
      await act(async () => { await Promise.resolve() })
      await act(async () => { await Promise.resolve() })

      const candidateBtn = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent?.includes('Candidate Parent')) as HTMLButtonElement
      await act(async () => { candidateBtn.click() })
      await act(async () => { await Promise.resolve() })
    }

    it('admin: selecting a parent POSTs to /api/person/{id}/relationships', async () => {
      mockSession('admin')
      const { calls } = installFetchMock()
      await renderDrawer()
      await openAddParentAndSelect()

      const linkCall = calls.find(c => c.url.includes('/relationships'))
      expect(linkCall).toBeDefined()
      expect(linkCall!.init?.method).toBe('POST')
      expect(JSON.parse(linkCall!.init!.body as string)).toEqual({
        targetId: '@I9@',
        type: 'parent',
      })
      const suggestionCall = calls.find(c => c.url === '/api/suggestions')
      expect(suggestionCall).toBeUndefined()
    })

    it('non-admin: selecting a parent POSTs to /api/suggestions with ADD_RELATIONSHIP payload', async () => {
      mockSession('user')
      const { calls } = installFetchMock()
      await renderDrawer()
      await openAddParentAndSelect()

      const suggestionCall = calls.find(c => c.url === '/api/suggestions')
      expect(suggestionCall).toBeDefined()
      expect(suggestionCall!.init?.method).toBe('POST')
      expect(JSON.parse(suggestionCall!.init!.body as string)).toEqual({
        changeType: 'ADD_RELATIONSHIP',
        payload: { type: 'parent', targetId: '@I9@', childId: '@I1@' },
      })
      const linkCall = calls.find(c => c.url.includes('/relationships') && c.init?.method === 'POST')
      expect(linkCall).toBeUndefined()
    })

    it('non-admin: shows "Suggestion submitted" confirmation after POST', async () => {
      mockSession('user')
      installFetchMock()
      await renderDrawer()
      await openAddParentAndSelect()

      const confirmation = container.querySelector('[data-testid="suggestion-submitted"]')
      expect(confirmation).not.toBeNull()
      expect(confirmation!.textContent).toContain('Suggestion submitted')
    })
  })
})
