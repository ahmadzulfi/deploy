import Link from 'next/link'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/ai', label: 'Layanan AI' },
  { href: '/ai/review', label: 'Pilihan warga' },
  { href: '/ai/examples', label: 'Contoh aktif' },
] as const

export type AiTab = (typeof TABS)[number]['href']

/**
 * The sub-pages of AI. Only admins see the tabs: the review pages hold
 * contacts' own words.
 */
export function AiTabs({ active, pending }: { active: AiTab; pending?: number }) {
  return (
    <nav aria-label="Bagian AI" className="flex gap-1 border-b">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? 'page' : undefined}
          className={cn(
            '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition-colors',
            t.href === active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
          )}
        >
          {t.label}
          {t.href === '/ai/review' && !!pending && (
            <span className="rounded-full bg-accent-bg px-1.5 text-[10px] leading-4 text-accent">{pending}</span>
          )}
        </Link>
      ))}
    </nav>
  )
}
