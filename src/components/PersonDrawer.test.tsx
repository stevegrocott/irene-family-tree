/**
 * @jest-environment jsdom
 */

// Tell React we're in a test environment so act() works correctly
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
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
})
