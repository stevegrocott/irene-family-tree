/**
 * @jest-environment jsdom
 */

// Tell React we're in a test environment so act() works correctly
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ConfirmDialog from '@/components/ConfirmDialog'

describe('ConfirmDialog', () => {
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
  })

  function render(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    const onConfirm = props.onConfirm ?? jest.fn()
    const onCancel = props.onCancel ?? jest.fn()
    act(() => {
      root = createRoot(container)
      root.render(
        <ConfirmDialog
          open={props.open ?? true}
          message={props.message ?? 'Are you sure?'}
          title={props.title}
          confirmLabel={props.confirmLabel}
          cancelLabel={props.cancelLabel}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )
    })
    return { onConfirm, onCancel }
  }

  it('renders nothing when open is false', () => {
    render({ open: false })
    expect(container.querySelector('[data-testid="confirm-dialog"]')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('renders the message when open', () => {
    render({ open: true, message: 'Delete John Smith? This cannot be undone.' })
    const message = container.querySelector('[data-testid="confirm-dialog-message"]')
    expect(message).not.toBeNull()
    expect(message!.textContent).toBe('Delete John Smith? This cannot be undone.')
  })

  it('renders default Confirm/Cancel labels when none are provided', () => {
    render({ open: true })
    expect(container.querySelector('[data-testid="confirm-dialog-confirm"]')!.textContent).toBe('Confirm')
    expect(container.querySelector('[data-testid="confirm-dialog-cancel"]')!.textContent).toBe('Cancel')
  })

  it('renders custom title and button labels when provided', () => {
    render({ open: true, title: 'Delete person', confirmLabel: 'Delete', cancelLabel: 'Keep' })
    const dialog = container.querySelector('[data-testid="confirm-dialog"]')!
    expect(dialog.querySelector('h2')!.textContent).toBe('Delete person')
    expect(dialog.getAttribute('aria-label')).toBe('Delete person')
    expect(container.querySelector('[data-testid="confirm-dialog-confirm"]')!.textContent).toBe('Delete')
    expect(container.querySelector('[data-testid="confirm-dialog-cancel"]')!.textContent).toBe('Keep')
  })

  it('omits the title heading when no title is provided', () => {
    render({ open: true })
    expect(container.querySelector('[data-testid="confirm-dialog"] h2')).toBeNull()
  })

  it('calls onConfirm (and not onCancel) when the confirm button is clicked', () => {
    const { onConfirm, onCancel } = render({ open: true })
    const confirmBtn = container.querySelector('[data-testid="confirm-dialog-confirm"]') as HTMLButtonElement
    act(() => { confirmBtn.click() })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel (and not onConfirm) when the cancel button is clicked', () => {
    const { onConfirm, onCancel } = render({ open: true })
    const cancelBtn = container.querySelector('[data-testid="confirm-dialog-cancel"]') as HTMLButtonElement
    act(() => { cancelBtn.click() })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onCancel when the overlay is clicked', () => {
    const { onCancel } = render({ open: true })
    const overlay = container.querySelector('[data-testid="confirm-dialog-overlay"]') as HTMLDivElement
    act(() => { overlay.click() })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not call onCancel when the dialog body is clicked (click does not bubble to overlay)', () => {
    const { onConfirm, onCancel } = render({ open: true })
    const dialog = container.querySelector('[data-testid="confirm-dialog"]') as HTMLDivElement
    act(() => { dialog.click() })
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
