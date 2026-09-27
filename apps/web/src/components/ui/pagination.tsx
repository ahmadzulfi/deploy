'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { IconChevronLeft, IconChevronRight } from './icons'

/** Table footer: rows per page, "1–50 dari N", previous/next. */
export function Pagination({
  total,
  page,
  per,
  onPer,
  href,
  sizes = [10, 25, 50, 100],
}: {
  total: number
  page: number
  per: number
  onPer: (n: number) => void
  href: (page: number) => string
  sizes?: number[]
}) {
  const pages = Math.max(1, Math.ceil(total / per))
  const from = total === 0 ? 0 : (page - 1) * per + 1
  const to = Math.min(total, page * per)
  const arrow = 'flex size-8 items-center justify-center rounded-md text-fg hover:bg-muted'

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t px-4 py-2.5 text-[12px] text-fg-muted">
      <label className="flex items-center gap-2">
        Baris per halaman
        <select
          value={per}
          onChange={(e) => onPer(Number(e.target.value))}
          className="h-7 rounded-md border bg-surface px-1.5 text-[12px] text-fg outline-none focus:border-accent"
        >
          {sizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <span>
        {from}–{to} dari {total}
      </span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} aria-label="Halaman sebelumnya" className={arrow}>
            <IconChevronLeft size={16} />
          </Link>
        ) : (
          <span aria-hidden className={cn(arrow, 'opacity-30 hover:bg-transparent')}>
            <IconChevronLeft size={16} />
          </span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} aria-label="Halaman berikutnya" className={arrow}>
            <IconChevronRight size={16} />
          </Link>
        ) : (
          <span aria-hidden className={cn(arrow, 'opacity-30 hover:bg-transparent')}>
            <IconChevronRight size={16} />
          </span>
        )}
      </div>
    </div>
  )
}
