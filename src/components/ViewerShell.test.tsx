/**
 * @jest-environment jsdom
 */

// Tell React we're in a test environment so act() works correctly
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ViewerShell from './ViewerShell'
import { APP_NAME } from '@/constants/branding'
import type { TreeView } from '@/lib/treeUrlState'

type ViewerShellProps = React.ComponentProps<typeof ViewerShell>

const NAMES: Record<string, string> = {
  p1: 'Alice',
  p2: 'Beth',
  p3: 'Cara',
}

function getPersonName(id: string): string {
  return NAMES[id] ?? id
}

describe('ViewerShell', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
    jest.restoreAllMocks()
  })

  function paint(props: Partial<ViewerShellProps>, handlers: { onViewChange: jest.Mock; onNavigate: jest.Mock }) {
    act(() => {
      root.render(
        <ViewerShell
          focusId={props.focusId ?? null}
          getPersonName={props.getPersonName ?? getPersonName}
          view={props.view ?? ('entry' as TreeView)}
          onViewChange={handlers.onViewChange}
          onNavigate={handlers.onNavigate}
        />
      )
    })
  }

  function renderShell(props: Partial<ViewerShellProps> = {}) {
    const onViewChange = jest.fn()
    const onNavigate = jest.fn()
    const handlers = { onViewChange, onNavigate }
    paint(props, handlers)
    return handlers
  }

  describe('top bar', () => {
    it('renders the wordmark with the app name', () => {
      renderShell()
      const wordmark = container.querySelector('[data-testid="viewer-shell-wordmark"]')
      expect(wordmark).not.toBeNull()
      expect(wordmark!.textContent).toBe(APP_NAME)
    })

    it('renders a divider between the wordmark and the breadcrumb', () => {
      renderShell()
      expect(container.querySelector('[data-testid="viewer-shell-divider"]')).not.toBeNull()
    })

    it('renders a search pill', () => {
      renderShell()
      expect(container.querySelector('[data-testid="viewer-shell-search"]')).not.toBeNull()
    })

    it('renders all three switcher segments', () => {
      renderShell()
      expect(container.querySelector('[data-testid="viewer-shell-switcher-walk"]')).not.toBeNull()
      expect(container.querySelector('[data-testid="viewer-shell-switcher-split"]')).not.toBeNull()
      expect(container.querySelector('[data-testid="viewer-shell-switcher-tree"]')).not.toBeNull()
    })

    it('renders the auth avatar slot wired to the existing AuthButton', () => {
      renderShell()
      const slot = container.querySelector('[data-testid="viewer-shell-avatar-slot"]')
      expect(slot).not.toBeNull()
      expect(slot!.querySelector('[data-testid="auth-button"]')).not.toBeNull()
    })

    it('renders the auth control in flow inside the slot, not floating over the canvas', () => {
      renderShell()
      const slot = container.querySelector('[data-testid="viewer-shell-avatar-slot"]')
      const authButton = slot!.querySelector('[data-testid="auth-button"]')
      expect(authButton!.parentElement).toBe(slot)
      expect(authButton!.className.split(/\s+/)).not.toContain('absolute')
    })
  })

  describe('switcher disabled state', () => {
    it('disables all three segments when there is no focus person', () => {
      renderShell({ focusId: null })
      const walk = container.querySelector('[data-testid="viewer-shell-switcher-walk"]') as HTMLButtonElement
      const split = container.querySelector('[data-testid="viewer-shell-switcher-split"]') as HTMLButtonElement
      const tree = container.querySelector('[data-testid="viewer-shell-switcher-tree"]') as HTMLButtonElement
      expect(walk.disabled).toBe(true)
      expect(split.disabled).toBe(true)
      expect(tree.disabled).toBe(true)
    })

    it('clicking a disabled segment is a no-op', () => {
      const { onViewChange } = renderShell({ focusId: null })
      const walk = container.querySelector('[data-testid="viewer-shell-switcher-walk"]') as HTMLButtonElement
      act(() => { walk.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onViewChange).not.toHaveBeenCalled()
    })

    it('enables the segments once a focus person is set', () => {
      renderShell({ focusId: 'p1' })
      const walk = container.querySelector('[data-testid="viewer-shell-switcher-walk"]') as HTMLButtonElement
      const split = container.querySelector('[data-testid="viewer-shell-switcher-split"]') as HTMLButtonElement
      const tree = container.querySelector('[data-testid="viewer-shell-switcher-tree"]') as HTMLButtonElement
      expect(walk.disabled).toBe(false)
      expect(split.disabled).toBe(false)
      expect(tree.disabled).toBe(false)
    })

    it('clicking an enabled segment invokes onViewChange with the corresponding view', () => {
      const { onViewChange } = renderShell({ focusId: 'p1' })
      const split = container.querySelector('[data-testid="viewer-shell-switcher-split"]') as HTMLButtonElement
      act(() => { split.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onViewChange).toHaveBeenCalledWith('split')
    })
  })

  describe('breadcrumb trail', () => {
    function items() {
      return Array.from(container.querySelectorAll('[data-testid="viewer-shell-breadcrumb-item"]'))
    }

    it('renders no entries before any person has been visited', () => {
      renderShell({ focusId: null })
      expect(items()).toHaveLength(0)
    })

    it('renders one entry per visited person, first-name only, with the last entry marked current', () => {
      const handlers = renderShell({ focusId: 'p1' })
      paint({ focusId: 'p2' }, handlers)
      paint({ focusId: 'p3' }, handlers)

      const entries = items()
      expect(entries.map(e => e.textContent)).toEqual(['Alice', 'Beth', 'Cara'])
      expect(entries[0].getAttribute('aria-current')).toBeNull()
      expect(entries[1].getAttribute('aria-current')).toBeNull()
      expect(entries[2].getAttribute('aria-current')).toBe('page')
    })

    it('every breadcrumb entry is clickable and reports its person id', () => {
      const handlers = renderShell({ focusId: 'p1' })
      paint({ focusId: 'p2' }, handlers)

      const first = items()[0]
      act(() => { first.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(handlers.onNavigate).toHaveBeenCalledWith('p1')
    })

    it('truncates the trail rather than appending a duplicate when revisiting the most recent entry', () => {
      const handlers = renderShell({ focusId: 'p1' })
      paint({ focusId: 'p2' }, handlers)
      paint({ focusId: 'p3' }, handlers)
      // Revisit p1, already in the trail — expect truncation back to [p1],
      // not an appended duplicate ([p1, p2, p3, p1]).
      paint({ focusId: 'p1' }, handlers)

      const entries = items()
      expect(entries.map(e => e.textContent)).toEqual(['Alice'])
      expect(entries[0].getAttribute('aria-current')).toBe('page')
    })

    it('truncates to the revisited person even when it is not the most recently visited one', () => {
      const handlers = renderShell({ focusId: 'p1' })
      paint({ focusId: 'p2' }, handlers)
      paint({ focusId: 'p3' }, handlers)
      // Revisit p2 (middle of the trail) — expect [p1, p2], dropping p3.
      paint({ focusId: 'p2' }, handlers)

      const entries = items()
      expect(entries.map(e => e.textContent)).toEqual(['Alice', 'Beth'])
      expect(entries[1].getAttribute('aria-current')).toBe('page')
    })
  })
})
