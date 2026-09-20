'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/inbox', label: 'Inbox', icon: IconMessage },
  { href: '/contacts', label: 'Kontak', icon: IconUsers, soon: true },
  { href: '/flows', label: 'Flow', icon: IconFlow, soon: true },
  { href: '/broadcast', label: 'Broadcast', icon: IconSend, soon: true },
  { href: '/channels', label: 'Nomor', icon: IconPhone },
]

export function NavRail() {
  const pathname = usePathname()

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-muted py-3">
      <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-accent-bg text-xs text-accent">
        WA
      </div>
      {ITEMS.map(({ href, label, icon: Icon, soon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={soon ? '#' : href}
            aria-disabled={soon}
            title={soon ? `${label} — belum tersedia` : label}
            className={cn(
              'flex size-9 items-center justify-center rounded-md transition-colors',
              active ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
              soon && 'cursor-not-allowed opacity-40 hover:text-fg-muted',
            )}
            onClick={soon ? (e) => e.preventDefault() : undefined}
          >
            <Icon />
            <span className="sr-only">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

const svg = {
  width: 19,
  height: 19,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function IconMessage() {
  return (
    <svg {...svg}>
      <path d="M8 9h8M8 13h5" />
      <path d="M12 20.5a8.5 8.5 0 1 0-7.4-4.3L3.5 20.5l4.3-1.1a8.5 8.5 0 0 0 4.2 1.1Z" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg {...svg}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.8M17 20a6 6 0 0 0-1.5-4" />
    </svg>
  )
}

function IconFlow() {
  return (
    <svg {...svg}>
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <rect x="3" y="17" width="6" height="4" rx="1" />
      <rect x="15" y="17" width="6" height="4" rx="1" />
      <path d="M12 7v4M6 17v-2h12v2" />
    </svg>
  )
}

function IconSend() {
  return (
    <svg {...svg}>
      <path d="M4 12 20 4l-8 16-2-6-6-2Z" />
    </svg>
  )
}

function IconPhone() {
  return (
    <svg {...svg}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  )
}
