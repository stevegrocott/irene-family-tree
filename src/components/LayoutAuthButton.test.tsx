/**
 * @jest-environment jsdom
 */

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { usePathname } from 'next/navigation'
import LayoutAuthButton from './LayoutAuthButton'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}))

describe('LayoutAuthButton', () => {
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
      root.render(<LayoutAuthButton />)
    })
  }

  it('renders nothing on the viewer route (/), which owns AuthButton via ViewerShell', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/')
    await render()
    expect(container.querySelector('[data-testid="auth-button"]')).toBeNull()
  })

  it('renders AuthButton inside a positioned top-right wrapper on /admin', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/admin')
    await render()
    const btn = container.querySelector('[data-testid="auth-button"]')
    expect(btn).not.toBeNull()
    const wrapper = btn!.parentElement!
    expect(wrapper.className).toContain('absolute')
    expect(wrapper.className).toContain('top-4')
    expect(wrapper.className).toContain('right-4')
  })

  it('renders AuthButton on /stats', async () => {
    ;(usePathname as jest.Mock).mockReturnValue('/stats')
    await render()
    expect(container.querySelector('[data-testid="auth-button"]')).not.toBeNull()
  })
})
