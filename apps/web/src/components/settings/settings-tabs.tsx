import Link from 'next/link'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/settings', label: 'Umum' },
  { href: '/settings/labels', label: 'Label' },
] as const

/** The sub-pages of Pengaturan. Each page says which one it is. */
export function SettingsTabs({ active }: { active: (typeof TABS)[number]['href'] }) {
  return (
    <nav aria-label="Bagian pengaturan" className="flex gap-1 border-b">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-xs transition-colors',
            t.href === active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
