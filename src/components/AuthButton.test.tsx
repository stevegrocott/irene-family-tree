/**
 * @jest-environment jsdom
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as NextAuthReact from 'next-auth/react'
import AuthButton from './AuthButton'

describe('AuthButton', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(container)
    jest.restoreAllMocks()
  })

  async function render() {
    await act(async () => {
      root = createRoot(container)
      root.render(<AuthButton />)
    })
  }

  it('shows "Sign in" button when unauthenticated', async () => {
    await render()
    const btn = container.querySelector('[data-testid="auth-button"]')
    expect(btn).not.toBeNull()
    expect(btn!.textContent).toContain('Sign in')
  })

  it('renders in normal document flow, not absolutely positioned', async () => {
    await render()
    const btn = container.querySelector('[data-testid="auth-button"]')!
    expect(btn.className).not.toContain('absolute')
    expect(btn.className).not.toContain('top-4')
    expect(btn.className).not.toContain('right-4')
    expect(btn.className).not.toContain('z-10')
  })

  it('collapses to a 44px icon-only tap target below sm, and an auto-sized pill at sm and up', async () => {
    await render()
    const btn = container.querySelector('[data-testid="auth-button"]')!
    const classes = btn.className.split(/\s+/)
    expect(classes).toContain('w-11')
    expect(classes).toContain('h-11')
    expect(classes).toContain('sm:w-auto')
    expect(classes).toContain('sm:h-auto')
  })

  it('labels the icon-only sign-in button with an accessible name', async () => {
    await render()
    const btn = container.querySelector('[data-testid="auth-button"]')!
    expect(btn.getAttribute('aria-label')).toBe('Sign in')
  })

  it('renders a decorative icon that is hidden at sm and up', async () => {
    await render()
    const btn = container.querySelector('[data-testid="auth-button"]')!
    const icon = btn.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon!.getAttribute('aria-hidden')).toBe('true')
    expect(icon!.getAttribute('class')).toContain('sm:hidden')
  })

  it('hides the "Sign in" text label below sm', async () => {
    await render()
    const btn = container.querySelector('[data-testid="auth-button"]')!
    const label = Array.from(btn.querySelectorAll('span')).find(el => el.textContent === 'Sign in')
    expect(label).not.toBeUndefined()
    expect(label!.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'sm:inline']))
  })

  it('shows user name and Sign out when authenticated with name', async () => {
    jest.spyOn(NextAuthReact, 'useSession').mockReturnValue({
      data: { user: { name: 'Alice Smith', email: 'alice@example.com', image: null } } as never,
      status: 'authenticated',
      update: async () => null,
    })
    await render()
    const name = container.querySelector('[data-testid="auth-button-name"]')
    const signout = container.querySelector('[data-testid="auth-button-signout"]')
    expect(name).not.toBeNull()
    expect(name!.textContent).toBe('Alice Smith')
    expect(signout).not.toBeNull()
    expect(signout!.textContent).toContain('Sign out')
  })

  it('authenticated pill renders in normal document flow, not absolutely positioned', async () => {
    jest.spyOn(NextAuthReact, 'useSession').mockReturnValue({
      data: { user: { name: 'Alice Smith', email: 'alice@example.com', image: null } } as never,
      status: 'authenticated',
      update: async () => null,
    })
    await render()
    const pill = container.querySelector('[data-testid="auth-button"]')!
    expect(pill.className).not.toContain('absolute')
    expect(pill.className).not.toContain('top-4')
    expect(pill.className).not.toContain('right-4')
    expect(pill.className).not.toContain('z-10')
  })

  it('falls back to email when name is absent', async () => {
    jest.spyOn(NextAuthReact, 'useSession').mockReturnValue({
      data: { user: { name: null, email: 'bob@example.com', image: null } } as never,
      status: 'authenticated',
      update: async () => null,
    })
    await render()
    const name = container.querySelector('[data-testid="auth-button-name"]')
    expect(name).not.toBeNull()
    expect(name!.textContent).toBe('bob@example.com')
  })

  it('shows loading indicator with aria-busy when session is loading', async () => {
    jest.spyOn(NextAuthReact, 'useSession').mockReturnValue({
      data: null,
      status: 'loading',
      update: async () => null,
    })
    await render()
    const el = container.querySelector('[data-testid="auth-button"]')
    expect(el).not.toBeNull()
    expect(el!.getAttribute('aria-busy')).toBe('true')
  })
})
