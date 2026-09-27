'use client'

import { createContext, useContext, useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/utils'

const CloseMenu = createContext<() => void>(() => {})

/**
 * A button that opens a floating panel, on the Popover API: top layer,
 * click-outside and Esc to close, no z-index fights. Anchor positioning is
 * not everywhere yet, so the panel is placed under its button by hand.
 */
export function Menu({
  trigger,
  disabled,
  align = 'end',
  triggerClassName,
  panelClassName,
  children,
  label,
}: {
  trigger: React.ReactNode
  disabled?: boolean
  align?: 'start' | 'end'
  triggerClassName?: string
  panelClassName?: string
  children: React.ReactNode
  /** Accessible name when the trigger shows only an icon. */
  label?: string
}) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const p = panel.current
    if (!p) return
    const place = () => {
      const b = button.current
      if (!b) return
      const r = b.getBoundingClientRect()
      const w = p.offsetWidth
      const left = align === 'end' ? r.right - w : r.left
      p.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`
      const below = r.bottom + 6
      p.style.top =
        below + p.offsetHeight > window.innerHeight - 8 ? `${Math.max(8, r.top - 6 - p.offsetHeight)}px` : `${below}px`
    }
    // A fixed panel would drift away from its button once the page scrolls,
    // so it follows the button while open.
    const onToggle = (e: Event) => {
      const open = (e as ToggleEvent).newState === 'open'
      button.current?.setAttribute('aria-expanded', String(open))
      if (open) {
        place()
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
      } else {
        window.removeEventListener('scroll', place, true)
        window.removeEventListener('resize', place)
      }
    }
    p.addEventListener('toggle', onToggle)
    return () => {
      p.removeEventListener('toggle', onToggle)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [align])

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded="false"
        aria-label={label}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className={cn('fixed inset-auto m-0 min-w-44 rounded-lg border bg-surface p-1 text-fg shadow-lg', panelClassName)}
      >
        <CloseMenu.Provider value={() => panel.current?.hidePopover()}>{children}</CloseMenu.Provider>
      </div>
    </>
  )
}

export function MenuItem({
  onSelect,
  children,
  danger,
  disabled,
}: {
  onSelect: () => void
  children: React.ReactNode
  danger?: boolean
  disabled?: boolean
}) {
  const close = useContext(CloseMenu)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        close()
        onSelect()
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-muted disabled:pointer-events-none disabled:opacity-40',
        danger ? 'text-danger' : 'text-fg',
      )}
    >
      {children}
    </button>
  )
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t" />
}

/** Closes the enclosing menu - for panels that hold a form instead of items. */
export function useCloseMenu() {
  return useContext(CloseMenu)
}
