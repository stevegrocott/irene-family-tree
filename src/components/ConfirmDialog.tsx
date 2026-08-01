'use client'

import { useEffect, useRef } from 'react'
import { DIALOG_BUTTON_BASE_CLASS } from '@/constants/tree'

/**
 * Themed in-app replacement for `window.confirm()`. Renders nothing when
 * `open` is false. Clicking the overlay or the cancel button calls `onCancel`;
 * clicking the confirm button calls `onConfirm`. Callers own the open state
 * and are responsible for closing the dialog from their callbacks.
 */
export interface ConfirmDialogProps {
  open: boolean
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  message,
  title,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelButtonRef.current?.focus()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      data-testid="confirm-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ft-overlay)] backdrop-blur-[2px] px-4"
      onClick={onCancel}
    >
      <div
        data-testid="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title ?? 'Confirm'}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-panel bg-surface border border-line shadow-[var(--ft-shadow-3)] p-6 space-y-4"
      >
        {title && (
          <h2 className="text-ink [font:var(--ft-title)]">{title}</h2>
        )}
        <p data-testid="confirm-dialog-message" className="text-ink-2 [font:var(--ft-body)]">
          {message}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            ref={cancelButtonRef}
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            className={`${DIALOG_BUTTON_BASE_CLASS} bg-surface border border-line text-ink hover:bg-surface-1 hover:border-line`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            className={`${DIALOG_BUTTON_BASE_CLASS} bg-declined text-[var(--ft-text-on-accent)] hover:brightness-95`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
