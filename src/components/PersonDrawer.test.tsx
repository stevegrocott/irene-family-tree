/**
 * @jest-environment jsdom
 */

// Tell React we're in a test environment so act() works correctly
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import type React from 'react'
import { createRoot } from 'react-dom/client'
import * as NextAuthReact from 'next-auth/react'
import { PersonDrawer, computeCascadeDeleteConnectionCount } from '@/components/FamilyTree'
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
  ...jest.requireActual('@/constants/tree'),
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

describe('computeCascadeDeleteConnectionCount', () => {
  it('falls back to totalConnections when relationshipChanges is undefined', () => {
    expect(computeCascadeDeleteConnectionCount(undefined, 3)).toBe(3)
  })

  it('falls back to totalConnections when relationshipChanges is null', () => {
    expect(computeCascadeDeleteConnectionCount(null, 2)).toBe(2)
  })

  it('uses relationshipChanges.length when present', () => {
    expect(computeCascadeDeleteConnectionCount(['a', 'b'], 5)).toBe(2)
  })
})

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

  async function renderDrawer(overrides: Partial<React.ComponentProps<typeof PersonDrawer>> = {}, flushes = 1) {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <PersonDrawer
          person={basePerson}
          onClose={jest.fn()}
          onReroot={jest.fn()}
          onSelectPerson={jest.fn()}
          {...overrides}
        />
      )
    })
    for (let i = 0; i < flushes; i++) {
      await act(async () => { await Promise.resolve() })
    }
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

  it('tapping a relative row re-roots the tree on that person, not select', async () => {
    const onReroot = jest.fn()
    const onSelectPerson = jest.fn()

    await renderDrawer({ onReroot, onSelectPerson })

    const parentsSection = container.querySelector('[data-testid="person-drawer-parents"]')
    const firstParentRow = parentsSection?.querySelector('[data-testid="relative-row"]')
    expect(firstParentRow).not.toBeNull()

    await act(async () => { (firstParentRow as HTMLElement).click() })

    expect(onReroot).toHaveBeenCalledWith('@I2@')
    expect(onSelectPerson).not.toHaveBeenCalled()
  })

  it('renders relative rows at a 44px touch-target height', async () => {
    await renderDrawer()

    const rows = container.querySelectorAll('[data-testid="relative-row"]')
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach(row => {
      expect((row as HTMLElement).className).toContain('min-h-[44px]')
    })
  })

  describe('Sticky bottom actions bar and mobile drag handle', () => {
    it('renders the actions bar pinned to the bottom with a top border and --ft-surface-1 background', async () => {
      await renderDrawer()

      const actions = container.querySelector('[data-testid="person-drawer-actions"]') as HTMLElement
      expect(actions).not.toBeNull()
      expect(actions.className).toContain('sticky')
      expect(actions.className).toContain('bottom-0')
      expect(actions.className).toContain('border-t')
      expect(actions.className).toContain('bg-surface-1')

      // Re-root and delete live inside the actions bar, not the scrollable body.
      expect(actions.querySelector('[data-testid="person-drawer-reroot"]')).not.toBeNull()
    })

    it('renders a 32×4 px mobile drag handle, hidden on desktop', async () => {
      await renderDrawer()

      const handleWrap = container.querySelector('[data-testid="drawer-drag-handle"]') as HTMLElement
      expect(handleWrap).not.toBeNull()
      expect(handleWrap.className).toContain('sm:hidden')

      const bar = handleWrap.firstElementChild as HTMLElement
      expect(bar).not.toBeNull()
      expect(bar.className).toContain('w-8')
      expect(bar.className).toContain('h-1')
    })

    it('opens at the peek detent (~30vh) and tapping the drag handle expands it to full (72vh)', async () => {
      await renderDrawer()

      const drawer = container.querySelector('[data-testid="person-drawer"]') as HTMLElement
      const handle = container.querySelector('[data-testid="drawer-drag-handle"]') as HTMLElement
      expect(drawer.className).toContain('h-[30vh]')
      expect(handle.getAttribute('aria-expanded')).toBe('false')

      await act(async () => { handle.click() })

      const expandedDrawer = container.querySelector('[data-testid="person-drawer"]') as HTMLElement
      const expandedHandle = container.querySelector('[data-testid="drawer-drag-handle"]') as HTMLElement
      expect(expandedDrawer.className).toContain('h-[72vh]')
      expect(expandedDrawer.className).not.toContain('h-[30vh]')
      expect(expandedHandle.getAttribute('aria-expanded')).toBe('true')
    })

    it('tapping the drag handle again collapses the full detent back to peek', async () => {
      await renderDrawer()

      const handle = () => container.querySelector('[data-testid="drawer-drag-handle"]') as HTMLElement
      await act(async () => { handle().click() })
      expect((container.querySelector('[data-testid="person-drawer"]') as HTMLElement).className).toContain('h-[72vh]')

      await act(async () => { handle().click() })

      const drawer = container.querySelector('[data-testid="person-drawer"]') as HTMLElement
      expect(drawer.className).toContain('h-[30vh]')
      expect(handle().getAttribute('aria-expanded')).toBe('false')
    })

    it('is keyboard-operable: Enter on the drag handle toggles the detent', async () => {
      await renderDrawer()

      const handle = container.querySelector('[data-testid="drawer-drag-handle"]') as HTMLButtonElement
      expect(handle.tagName).toBe('BUTTON')

      // A real <button> activates on Enter/Space natively; simulate the resulting click.
      await act(async () => { handle.click() })

      const drawer = container.querySelector('[data-testid="person-drawer"]') as HTMLElement
      expect(drawer.className).toContain('h-[72vh]')
    })
  })

  describe('Add parent', () => {
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

  describe('Add parent via create-and-link — role-based routing', () => {
    function installCreateFetchMock() {
      const calls: Array<{ url: string; init?: RequestInit }> = []
      const personPath = `/api/person/${encodeURIComponent('@I1@')}`
      const setNativeValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )!.set!
      const fetchMock = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url === `${personPath}/my-changes`) {
          return { ok: true, json: async () => ({ createChange: null, relationshipChanges: [], updateChanges: [] }) }
        }
        if (url === '/api/persons' && (init as RequestInit)?.method === 'POST') {
          return { ok: true, json: async () => ({ gedcomId: '@I99@', name: 'New Parent', sex: 'M', birthYear: null, birthPlace: null }) }
        }
        if (url === '/api/suggestions') {
          return { ok: true, status: 201, json: async () => ({ id: 'new-suggestion-id' }) }
        }
        if (url === `${personPath}/relationships`) {
          return { ok: true, status: 201, json: async () => ({ unionId: '@F_new@' }) }
        }
        if (url.startsWith(personPath)) {
          return { ok: true, json: async () => mockDetailResponse }
        }
        return { ok: true, json: async () => ({}) }
      })
      global.fetch = fetchMock as unknown as typeof fetch
      return { calls, setNativeValue }
    }

    async function openAddParentAndFillCreateForm() {
      const parentsSection = container.querySelector('[data-testid="person-drawer-parents"]')!
      const addParentBtn = Array.from(parentsSection.querySelectorAll('button'))
        .find(b => b.textContent?.includes('Add parent')) as HTMLButtonElement
      await act(async () => { addParentBtn.click() })

      const setNativeValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )!.set!

      const givenNameInput = container.querySelector('#create-given-name') as HTMLInputElement
      await act(async () => {
        setNativeValue.call(givenNameInput, 'New')
        givenNameInput.dispatchEvent(new Event('input', { bubbles: true }))
      })

      const familyNameInput = container.querySelector('#create-family-name') as HTMLInputElement
      await act(async () => {
        setNativeValue.call(familyNameInput, 'Parent')
        familyNameInput.dispatchEvent(new Event('input', { bubbles: true }))
      })

      const saveBtn = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent?.trim() === 'Save change') as HTMLButtonElement
      await act(async () => { saveBtn.click() })
      await act(async () => { await Promise.resolve() })
    }

    it('non-admin: handleCreateAndLink POSTs to /api/suggestions with ADD_RELATIONSHIP payload', async () => {
      mockSession('user')
      const { calls } = installCreateFetchMock()
      await renderDrawer()
      await openAddParentAndFillCreateForm()

      const createPersonCall = calls.find(c => c.url === '/api/persons' && c.init?.method === 'POST')
      expect(createPersonCall).toBeDefined()

      const suggestionCall = calls.find(c => c.url === '/api/suggestions')
      expect(suggestionCall).toBeDefined()
      expect(suggestionCall!.init?.method).toBe('POST')
      expect(JSON.parse(suggestionCall!.init!.body as string)).toEqual({
        changeType: 'ADD_RELATIONSHIP',
        payload: { type: 'parent', targetId: '@I99@', childId: '@I1@' },
      })

      const linkCall = calls.find(c => c.url.includes('/relationships') && c.init?.method === 'POST')
      expect(linkCall).toBeUndefined()
    })
  })

  describe('Delete confirmation — in-app modal replaces window.confirm', () => {
    const noRelDetail = {
      ...mockDetailResponse,
      parents: [],
      siblings: [],
      marriages: [],
    }

    function installDeleteFetchMock(opts: {
      detail: typeof mockDetailResponse
      relationshipChanges: Array<{ id: string; newValue: Record<string, unknown>; appliedAt: string }>
    }) {
      const calls: Array<{ url: string; init?: RequestInit }> = []
      const personPath = `/api/person/${encodeURIComponent('@I1@')}`
      const fetchMock = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url === `${personPath}/my-changes`) {
          return {
            ok: true,
            json: async () => ({
              createChange: {
                id: 'chg-create',
                changeType: 'CREATE_PERSON',
                targetId: '@I1@',
                newValue: {},
                appliedAt: '2024-01-01T00:00:00.000Z',
              },
              relationshipChanges: opts.relationshipChanges,
              updateChanges: [],
            }),
          }
        }
        if (url.startsWith('/api/changes/') && url.endsWith('/revert')) {
          return { ok: true, json: async () => ({}) }
        }
        if (url === `${personPath}/cascade-revert`) {
          return { ok: true, json: async () => ({}) }
        }
        if (url.startsWith(personPath)) {
          return { ok: true, json: async () => opts.detail }
        }
        return { ok: true, json: async () => ({}) }
      })
      global.fetch = fetchMock as unknown as typeof fetch
      return { calls }
    }

    it('clicking delete opens the modal (no window.confirm) with the simple-delete message; confirming reverts and closes', async () => {
      const confirmSpy = jest.spyOn(window, 'confirm')
      const { calls } = installDeleteFetchMock({ detail: noRelDetail, relationshipChanges: [] })
      const onClose = jest.fn()
      // Flush the detail + my-changes fetches and their chained state updates
      await renderDrawer({ onClose, onSelectRoot: jest.fn(), rootId: '@I1@' }, 4)

      const deleteBtn = container.querySelector('[data-testid="person-drawer-delete"]') as HTMLButtonElement
      expect(deleteBtn).not.toBeNull()

      // Modal is not shown until the delete button is clicked
      expect(container.querySelector('[data-testid="confirm-dialog"]')).toBeNull()

      await act(async () => { deleteBtn.click() })

      // The in-app modal is used, never the native window.confirm
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(container.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull()
      const message = container.querySelector('[data-testid="confirm-dialog-message"]')
      expect(message!.textContent).toBe('Delete John Smith? This cannot be undone.')

      // Nothing is reverted until the user confirms inside the modal
      expect(calls.some(c => c.url.includes('/revert'))).toBe(false)

      const confirmBtn = container.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement
      await act(async () => { confirmBtn.click() })
      await act(async () => { await Promise.resolve() })
      await act(async () => { await Promise.resolve() })

      const revertCall = calls.find(c => c.url === '/api/changes/chg-create/revert')
      expect(revertCall).toBeDefined()
      expect(revertCall!.init?.method).toBe('POST')
      expect(onClose).toHaveBeenCalled()
    })

    it('cancelling the modal closes it without reverting or closing the drawer', async () => {
      const { calls } = installDeleteFetchMock({ detail: noRelDetail, relationshipChanges: [] })
      const onClose = jest.fn()
      await renderDrawer({ onClose, onSelectRoot: jest.fn(), rootId: '@I1@' }, 4)

      const deleteBtn = container.querySelector('[data-testid="person-drawer-delete"]') as HTMLButtonElement
      await act(async () => { deleteBtn.click() })
      expect(container.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull()

      const cancelBtn = container.querySelector('[data-testid="confirm-dialog-cancel"]') as HTMLButtonElement
      await act(async () => { cancelBtn.click() })

      expect(container.querySelector('[data-testid="confirm-dialog"]')).toBeNull()
      expect(calls.some(c => c.url.includes('/revert'))).toBe(false)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('for a person with relationships, the modal shows the connection count and confirming calls cascade-revert', async () => {
      // mockDetailResponse has 2 parents + 1 marriage = 3 connections
      const { calls } = installDeleteFetchMock({
        detail: mockDetailResponse,
        relationshipChanges: [
          { id: 'rc1', newValue: { type: 'parent', targetId: '@I2@' }, appliedAt: '2024-01-01T00:00:00.000Z' },
          { id: 'rc2', newValue: { type: 'parent', targetId: '@I3@' }, appliedAt: '2024-01-01T00:00:00.000Z' },
          { id: 'rc3', newValue: { type: 'spouse', targetId: '@I5@' }, appliedAt: '2024-01-01T00:00:00.000Z' },
        ],
      })
      const onClose = jest.fn()
      await renderDrawer({ onClose, onSelectRoot: jest.fn(), rootId: '@I1@' }, 4)

      const deleteBtn = container.querySelector('[data-testid="person-drawer-delete"]') as HTMLButtonElement
      expect(deleteBtn).not.toBeNull()
      // All connections authored by the user → not blocked, button enabled
      expect(deleteBtn.disabled).toBe(false)

      await act(async () => { deleteBtn.click() })

      const message = container.querySelector('[data-testid="confirm-dialog-message"]')
      expect(message!.textContent).toBe(
        'Delete John Smith and remove all 3 of their connections? This cannot be undone.'
      )

      const confirmBtn = container.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement
      await act(async () => { confirmBtn.click() })
      await act(async () => { await Promise.resolve() })
      await act(async () => { await Promise.resolve() })

      const cascadeCall = calls.find(c => c.url === '/api/person/%40I1%40/cascade-revert')
      expect(cascadeCall).toBeDefined()
      expect(cascadeCall!.init?.method).toBe('POST')
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('Photo', () => {
    it('shows the photo in the drawer header when detail includes photoUrl', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...mockDetailResponse, photoUrl: 'https://blob.example.com/photo.jpg' }),
      })
      await renderDrawer()

      const photo = container.querySelector('[data-testid="person-drawer-photo"]') as HTMLImageElement
      expect(photo).not.toBeNull()
      expect(photo.src).toBe('https://blob.example.com/photo.jpg')
    })

    it('does not render a photo element when no photoUrl is set', async () => {
      await renderDrawer()
      expect(container.querySelector('[data-testid="person-drawer-photo"]')).toBeNull()
    })

    describe('Edit mode upload — role-based routing', () => {
      function installPhotoFetchMock() {
        const calls: Array<{ url: string; init?: RequestInit }> = []
        const personPath = `/api/person/${encodeURIComponent('@I1@')}`
        const fetchMock = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
          calls.push({ url, init })
          if (url === `${personPath}/my-changes`) {
            return { ok: true, json: async () => ({ createChange: null, relationshipChanges: [], updateChanges: [] }) }
          }
          if (url === `${personPath}/photo`) {
            return { ok: true, json: async () => ({ url: 'https://blob.example.com/uploaded.jpg' }) }
          }
          if (url === '/api/suggestions') {
            return { ok: true, status: 201, json: async () => ({ id: 'new-suggestion-id' }) }
          }
          if (url === personPath && init?.method === 'PATCH') {
            return { ok: true, json: async () => ({}) }
          }
          if (url.startsWith(personPath)) {
            return { ok: true, json: async () => mockDetailResponse }
          }
          return { ok: true, json: async () => ({}) }
        })
        global.fetch = fetchMock as unknown as typeof fetch
        return { calls }
      }

      async function openEditAndUploadPhoto() {
        const editBtn = container.querySelector('[data-testid="person-drawer-edit"]') as HTMLButtonElement
        await act(async () => { editBtn.click() })

        const fileInput = container.querySelector('[data-testid="person-drawer-photo-input"]') as HTMLInputElement
        const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
        await act(async () => {
          Object.defineProperty(fileInput, 'files', { value: [file] })
          fileInput.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await act(async () => { await Promise.resolve() })
      }

      it('admin: uploading a photo POSTs multipart data then Save PATCHes the returned photoUrl', async () => {
        mockSession('admin')
        const { calls } = installPhotoFetchMock()
        await renderDrawer()
        await openEditAndUploadPhoto()

        const uploadCall = calls.find(c => c.url === `/api/person/${encodeURIComponent('@I1@')}/photo`)
        expect(uploadCall).toBeDefined()
        expect(uploadCall!.init?.method).toBe('POST')
        expect(uploadCall!.init?.body).toBeInstanceOf(FormData)

        const saveBtn = Array.from(container.querySelectorAll('button'))
          .find(b => b.textContent?.trim() === 'Save change') as HTMLButtonElement
        await act(async () => { saveBtn.click() })
        await act(async () => { await Promise.resolve() })

        const patchCall = calls.find(c => c.url === `/api/person/${encodeURIComponent('@I1@')}` && c.init?.method === 'PATCH')
        expect(patchCall).toBeDefined()
        expect(JSON.parse(patchCall!.init!.body as string)).toMatchObject({
          photoUrl: 'https://blob.example.com/uploaded.jpg',
        })
      })

      it('non-admin: uploading a photo then suggesting includes photoUrl in the suggestion payload', async () => {
        mockSession('user')
        const { calls } = installPhotoFetchMock()
        await renderDrawer()
        await openEditAndUploadPhoto()

        const suggestBtn = container.querySelector('[data-testid="suggest-change"]') as HTMLButtonElement
        await act(async () => { suggestBtn.click() })
        await act(async () => { await Promise.resolve() })

        const suggestionCall = calls.find(c => c.url === '/api/suggestions')
        expect(suggestionCall).toBeDefined()
        const body = JSON.parse(suggestionCall!.init!.body as string)
        expect(body.payload).toMatchObject({ photoUrl: 'https://blob.example.com/uploaded.jpg' })
      })

      it('rejects a non-image file client-side without uploading', async () => {
        mockSession('admin')
        const { calls } = installPhotoFetchMock()
        await renderDrawer()

        const editBtn = container.querySelector('[data-testid="person-drawer-edit"]') as HTMLButtonElement
        await act(async () => { editBtn.click() })

        const fileInput = container.querySelector('[data-testid="person-drawer-photo-input"]') as HTMLInputElement
        const file = new File(['data'], 'notes.txt', { type: 'text/plain' })
        await act(async () => {
          Object.defineProperty(fileInput, 'files', { value: [file] })
          fileInput.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await act(async () => { await Promise.resolve() })

        const uploadCall = calls.find(c => c.url === `/api/person/${encodeURIComponent('@I1@')}/photo`)
        expect(uploadCall).toBeUndefined()
        const error = container.querySelector('[data-testid="person-drawer-edit-action-error"]')
        expect(error?.textContent).toBe('Photo must be a JPEG, PNG, or WebP image.')
      })

      it('rejects a file over 5MB client-side without uploading', async () => {
        mockSession('admin')
        const { calls } = installPhotoFetchMock()
        await renderDrawer()

        const editBtn = container.querySelector('[data-testid="person-drawer-edit"]') as HTMLButtonElement
        await act(async () => { editBtn.click() })

        const fileInput = container.querySelector('[data-testid="person-drawer-photo-input"]') as HTMLInputElement
        const file = new File(['data'], 'big.jpg', { type: 'image/jpeg' })
        Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 })
        await act(async () => {
          Object.defineProperty(fileInput, 'files', { value: [file] })
          fileInput.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await act(async () => { await Promise.resolve() })

        const uploadCall = calls.find(c => c.url === `/api/person/${encodeURIComponent('@I1@')}/photo`)
        expect(uploadCall).toBeUndefined()
        const error = container.querySelector('[data-testid="person-drawer-edit-action-error"]')
        expect(error?.textContent).toBe('Photo must be 5 MB or smaller.')
      })

      it('shows an error message when the upload request fails', async () => {
        mockSession('admin')
        const personPath = `/api/person/${encodeURIComponent('@I1@')}`
        const fetchMock = jest.fn().mockImplementation(async (url: string) => {
          if (url === `${personPath}/my-changes`) {
            return { ok: true, json: async () => ({ createChange: null, relationshipChanges: [], updateChanges: [] }) }
          }
          if (url === `${personPath}/photo`) {
            return { ok: false, status: 400, json: async () => ({ error: 'Bad request' }) }
          }
          if (url.startsWith(personPath)) {
            return { ok: true, json: async () => mockDetailResponse }
          }
          return { ok: true, json: async () => ({}) }
        })
        global.fetch = fetchMock as unknown as typeof fetch
        await renderDrawer()

        const editBtn = container.querySelector('[data-testid="person-drawer-edit"]') as HTMLButtonElement
        await act(async () => { editBtn.click() })

        const fileInput = container.querySelector('[data-testid="person-drawer-photo-input"]') as HTMLInputElement
        const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
        await act(async () => {
          Object.defineProperty(fileInput, 'files', { value: [file] })
          fileInput.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await act(async () => { await Promise.resolve() })

        const error = container.querySelector('[data-testid="person-drawer-edit-action-error"]')
        expect(error?.textContent).toBe('Failed to upload photo. Please try again.')
      })
    })
  })

  describe('Relationship calculator', () => {
    const rootId = '@I50@'
    const rootName = 'Root Person'

    function installRelationshipFetchMock(
      relationshipResponse?: () => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>
    ) {
      const calls: Array<{ url: string }> = []
      const personPath = `/api/person/${encodeURIComponent('@I1@')}`
      const fetchMock = jest.fn().mockImplementation(async (url: string) => {
        calls.push({ url })
        if (url.startsWith('/api/relationship')) {
          if (relationshipResponse) return relationshipResponse()
          return { ok: true, json: async () => ({ from: rootId, to: '@I1@', steps: [{ type: 'parent', name: 'John Smith', sex: 'M' }], label: 'father' }) }
        }
        if (url === `${personPath}/my-changes`) {
          return { ok: true, json: async () => ({ createChange: null, relationshipChanges: [], updateChanges: [] }) }
        }
        if (url.startsWith(personPath)) {
          return { ok: true, json: async () => mockDetailResponse }
        }
        return { ok: true, json: async () => ({}) }
      })
      global.fetch = fetchMock as unknown as typeof fetch
      return { calls }
    }

    async function renderDrawerWithRoot(id = rootId, name = rootName) {
      await act(async () => {
        root = createRoot(container)
        root.render(
          <PersonDrawer
            person={basePerson}
            onClose={jest.fn()}
            onReroot={jest.fn()}
            onSelectPerson={jest.fn()}
            rootId={id}
            rootName={name}
          />
        )
      })
      await act(async () => { await Promise.resolve() })
    }

    it('does not render the control when rootId is not provided', async () => {
      await renderDrawer()
      expect(container.querySelector('[data-testid="person-drawer-relationship"]')).toBeNull()
    })

    it('does not render the control when the selected person is the root', async () => {
      installRelationshipFetchMock()
      await renderDrawerWithRoot('@I1@', 'John Smith')
      expect(container.querySelector('[data-testid="person-drawer-relationship"]')).toBeNull()
    })

    it('shows a "How related to <root>?" button for a non-root person', async () => {
      installRelationshipFetchMock()
      await renderDrawerWithRoot()
      const button = container.querySelector('[data-testid="person-drawer-relationship-button"]')
      expect(button?.textContent).toBe(`How related to ${rootName}?`)
    })

    it('fetches from the root to the selected person and displays the kinship label on click', async () => {
      const { calls } = installRelationshipFetchMock()
      await renderDrawerWithRoot()

      const button = container.querySelector('[data-testid="person-drawer-relationship-button"]') as HTMLButtonElement
      await act(async () => { button.click() })
      await act(async () => { await Promise.resolve() })

      const relCall = calls.find(c => c.url.startsWith('/api/relationship'))
      expect(relCall?.url).toBe(`/api/relationship?from=${encodeURIComponent(rootId)}&to=${encodeURIComponent('@I1@')}`)

      const result = container.querySelector('[data-testid="person-drawer-relationship-result"]')
      expect(result?.textContent).toContain('father')
      expect(container.querySelector('[data-testid="person-drawer-relationship-button"]')).toBeNull()
    })

    it('shows a loading state while the request is in flight', async () => {
      let resolveFetch: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {}
      installRelationshipFetchMock(() => new Promise(resolve => { resolveFetch = resolve }))

      await renderDrawerWithRoot()

      const button = container.querySelector('[data-testid="person-drawer-relationship-button"]') as HTMLButtonElement
      await act(async () => { button.click() })

      expect(button.textContent).toBe('Calculating…')
      expect(button.disabled).toBe(true)

      await act(async () => {
        resolveFetch({ ok: true, json: async () => ({ label: 'father' }) })
        await Promise.resolve()
      })
    })

    it('shows an error message returned by the API when the request fails', async () => {
      installRelationshipFetchMock(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: 'No relationship path found within 20 hops' }),
      }))
      await renderDrawerWithRoot()

      const button = container.querySelector('[data-testid="person-drawer-relationship-button"]') as HTMLButtonElement
      await act(async () => { button.click() })
      await act(async () => { await Promise.resolve() })

      const error = container.querySelector('[data-testid="person-drawer-relationship-error"]')
      expect(error?.textContent).toBe('No relationship path found within 20 hops')
    })

    it('shows a generic error message when the request throws', async () => {
      installRelationshipFetchMock(async () => { throw new Error('Network error') })
      jest.spyOn(console, 'error').mockImplementation(() => {})

      await renderDrawerWithRoot()

      const button = container.querySelector('[data-testid="person-drawer-relationship-button"]') as HTMLButtonElement
      await act(async () => { button.click() })
      await act(async () => { await Promise.resolve() })

      const error = container.querySelector('[data-testid="person-drawer-relationship-error"]')
      expect(error?.textContent).toBe('Failed to calculate relationship. Please try again.')
    })
  })

  describe('Copy link button', () => {
    it('is not rendered when getShareUrl is not provided', async () => {
      await renderDrawer()
      expect(container.querySelector('[data-testid="person-drawer-copy-link"]')).toBeNull()
    })

    it('copies the URL from getShareUrl and shows a transient "Copied!" confirmation', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })
      const getShareUrl = jest.fn().mockReturnValue('https://example.com/?root=%40I1%40')

      await act(async () => {
        root = createRoot(container)
        root.render(
          <PersonDrawer
            person={basePerson}
            onClose={jest.fn()}
            onReroot={jest.fn()}
            onSelectPerson={jest.fn()}
            getShareUrl={getShareUrl}
          />
        )
      })

      const copyBtn = container.querySelector('[data-testid="person-drawer-copy-link"]') as HTMLButtonElement
      expect(copyBtn).not.toBeNull()

      await act(async () => { copyBtn.click() })
      await act(async () => { await Promise.resolve() })

      expect(writeText).toHaveBeenCalledWith('https://example.com/?root=%40I1%40')
      expect(copyBtn.textContent).toBe('Copied!')
    })
  })

  describe('Facts — empty values render ghost buttons, never a dash', () => {
    const filledDetail = {
      ...mockDetailResponse,
      birthPlace: 'Boston, MA',
      deathPlace: 'Chicago, IL',
      occupation: 'Carpenter',
      notes: 'Some biographical notes.',
    }

    it('renders a "+ Add …" ghost button in place of each empty fact', async () => {
      await renderDrawer()

      expect(container.querySelector('[data-testid="person-drawer-fact-birthplace"]')).toBeNull()
      expect(container.querySelector('[data-testid="person-drawer-fact-deathplace"]')).toBeNull()
      expect(container.querySelector('[data-testid="person-drawer-fact-occupation"]')).toBeNull()
      expect(container.querySelector('[data-testid="person-drawer-fact-notes"]')).toBeNull()

      expect(container.querySelector('[data-testid="person-drawer-fact-birthplace-add"]')?.textContent).toBe('+ Add birth place')
      expect(container.querySelector('[data-testid="person-drawer-fact-deathplace-add"]')?.textContent).toBe('+ Add death place')
      expect(container.querySelector('[data-testid="person-drawer-fact-occupation-add"]')?.textContent).toBe('+ Add occupation')
      expect(container.querySelector('[data-testid="person-drawer-fact-notes-add"]')?.textContent).toBe('+ Add notes')

      const facts = container.querySelector('[data-testid="person-drawer-facts"]')
      expect(facts?.textContent).not.toContain('—')
    })

    it('renders the value row instead of a ghost button when a fact is present', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => filledDetail })
      await renderDrawer()

      expect(container.querySelector('[data-testid="person-drawer-fact-birthplace"]')?.textContent).toContain('Boston, MA')
      expect(container.querySelector('[data-testid="person-drawer-fact-deathplace"]')?.textContent).toContain('Chicago, IL')
      expect(container.querySelector('[data-testid="person-drawer-fact-occupation"]')?.textContent).toContain('Carpenter')
      expect(container.querySelector('[data-testid="person-drawer-fact-notes"]')?.textContent).toContain('Some biographical notes.')

      expect(container.querySelector('[data-testid="person-drawer-fact-birthplace-add"]')).toBeNull()
      expect(container.querySelector('[data-testid="person-drawer-fact-deathplace-add"]')).toBeNull()
      expect(container.querySelector('[data-testid="person-drawer-fact-occupation-add"]')).toBeNull()
      expect(container.querySelector('[data-testid="person-drawer-fact-notes-add"]')).toBeNull()
    })

    it('signed-in: clicking a ghost button opens edit mode with that field expanded', async () => {
      mockSession('user')
      await renderDrawer()

      const birthplaceAdd = container.querySelector('[data-testid="person-drawer-fact-birthplace-add"]') as HTMLButtonElement
      await act(async () => { birthplaceAdd.click() })

      expect(container.querySelector('[data-testid="person-drawer-edit-form"]')).not.toBeNull()
      const input = container.querySelector('#edit-birth-place') as HTMLInputElement | null
      expect(input).not.toBeNull()
      expect(input!.value).toBe('')
    })

    it('signed-out: clicking a ghost button prompts sign-in instead of opening edit mode', async () => {
      mockSession(null)
      const signInSpy = jest.spyOn(NextAuthReact, 'signIn').mockImplementation(() => Promise.resolve(undefined) as never)
      await renderDrawer()

      const birthplaceAdd = container.querySelector('[data-testid="person-drawer-fact-birthplace-add"]') as HTMLButtonElement
      await act(async () => { birthplaceAdd.click() })

      expect(signInSpy).toHaveBeenCalledWith('google')
      expect(container.querySelector('[data-testid="person-drawer-edit-form"]')).toBeNull()
    })
  })
})
