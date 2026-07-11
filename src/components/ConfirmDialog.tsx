'use client'

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
  if (!open) return null

  return (
    <div
      data-testid="confirm-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onCancel}
    >
      <div
        data-testid="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title ?? 'Confirm'}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-[#0a1628]/95 border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-5 space-y-4"
      >
        {title && <h2 className="text-white font-semibold text-base">{title}</h2>}
        <p data-testid="confirm-dialog-message" className="text-slate-300 text-sm">
          {message}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            className="min-h-11 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            className="min-h-11 px-4 rounded-xl bg-red-500/80 hover:bg-red-500 text-white text-sm font-medium transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
