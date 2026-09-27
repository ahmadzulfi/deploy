'use client'

import { useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/utils'

// React's types do not know `closedby` yet; the browser does.
const lightDismiss = { closedby: 'any' } as Record<string, string>

/**
 * A modal on the native <dialog>: top layer, focus trap and Esc for free.
 * `closedby="any"` adds click-outside to close; browsers without it (Safari)
 * get the same through the backdrop-click fallback below.
 *
 * Children only mount while open, so a form inside starts empty every time.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      // showModal focuses the first focusable element, which is the close
      // button - Enter would then dismiss the dialog. The first field is what
      // the user came to fill in. (React's autoFocus fired while the dialog
      // was still closed, so it cannot do this.)
      d.querySelector<HTMLElement>(
        'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select',
      )?.focus()
    }
    if (!open && d.open) d.close()
  }, [open])

  useEffect(() => {
    const d = ref.current
    if (!d || 'closedBy' in HTMLDialogElement.prototype) return
    const onClick = (e: MouseEvent) => {
      if (e.target !== d) return
      const r = d.getBoundingClientRect()
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right
      if (!inside) d.close()
    }
    d.addEventListener('click', onClick)
    return () => d.removeEventListener('click', onClick)
  }, [])

  return (
    <dialog
      ref={ref}
      {...lightDismiss}
      aria-labelledby={titleId}
      onClose={onClose}
      className={cn(
        'm-auto w-[calc(100%-2rem)] max-w-md rounded-xl border bg-surface p-0 text-fg shadow-xl backdrop:bg-navy-1000/50',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b px-5 py-3.5">
        <div>
          <h2 id={titleId} className="text-sm font-medium text-fg">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[11px] text-fg-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Tutup"
          className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{open && children}</div>
    </dialog>
  )
}
