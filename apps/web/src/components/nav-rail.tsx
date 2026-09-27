'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const ITEMS: { href: string; label: string; icon: () => React.JSX.Element; soon?: boolean }[] = [
  { href: '/', label: 'Beranda', icon: IconHome },
  { href: '/inbox', label: 'Inbox', icon: IconMessage },
  { href: '/contacts', label: 'Kontak', icon: IconUsers },
  { href: '/flows', label: 'Flow', icon: IconFlow },
  { href: '/broadcast', label: 'Broadcast', icon: IconSend },
  { href: '/templates', label: 'Template', icon: IconTemplate },
  { href: '/channels', label: 'Nomor', icon: IconPhone },
  { href: '/settings', label: 'Pengaturan', icon: IconSettings },
]

export function NavRail() {
  const pathname = usePathname()

  return (
    // Navy in both modes, like the design system's header; the orange mark is
    // the one brand moment every page carries.
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 bg-rail py-3">
      <Link
        href="/"
        className="mb-3 flex size-9 items-center justify-center rounded-xl bg-brand text-[13px] font-bold tracking-tight text-on-brand"
        title="WhatsApp Platform"
      >
        WA
      </Link>
      {ITEMS.map(({ href, label, icon: Icon, soon }) => {
        // Every path starts with '/', so home only counts on an exact match.
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={soon ? '#' : href}
            aria-disabled={soon}
            aria-current={active ? 'page' : undefined}
            title={soon ? `${label} — belum tersedia` : label}
            className={cn(
              'relative flex size-10 items-center justify-center rounded-xl transition-colors',
              active ? 'bg-rail-active text-rail-active-fg' : 'text-rail-fg hover:bg-rail-active/60 hover:text-rail-active-fg',
              soon && 'cursor-not-allowed opacity-40 hover:text-rail-fg',
            )}
            onClick={soon ? (e) => e.preventDefault() : undefined}
          >
            {active && <span aria-hidden className="absolute -left-3 h-5 w-1 rounded-r-full bg-brand" />}
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

function IconHome() {
  return (
    <svg {...svg}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v10.5h13V9" />
      <path d="M10 19.5v-5h4v5" />
    </svg>
  )
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

function IconTemplate() {
  return (
    <svg {...svg}>
      <rect x="4.5" y="3" width="15" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4V3.8a2 2 0 1 1 4 0V4a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1Z" />
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
