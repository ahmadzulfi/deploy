'use client'

import { useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

const RANGE_LABEL: Record<number, string> = { 7: '7 hari', 30: '30 hari', 90: '90 hari' }

/**
 * The one filter row, above everything it scopes. Changing a filter keeps the
 * current numbers on screen, dimmed, until the new ones arrive - no skeleton,
 * no layout jump.
 */
export function DashboardShell({
  range,
  ranges,
  channelId,
  channels,
  children,
}: {
  range: number
  ranges: readonly number[]
  channelId: string | null
  channels: { id: string; name: string }[]
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, start] = useTransition()

  const go = (over: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(over)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    const s = p.toString()
    start(() => router.push(s ? `${pathname}?${s}` : pathname, { scroll: false }))
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Rentang waktu" className="flex rounded-lg border bg-surface p-0.5">
          {ranges.map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={r === range}
              onClick={() => go({ range: r === 7 ? null : String(r) })}
              className={cn(
                'rounded-md px-3 py-1 text-xs transition-colors',
                r === range ? 'bg-fg text-on-fg' : 'text-fg-muted hover:bg-muted hover:text-fg',
              )}
            >
              {RANGE_LABEL[r] ?? `${r} hari`}
            </button>
          ))}
        </div>

        {channels.length > 1 && (
          <select
            aria-label="Nomor"
            value={channelId ?? ''}
            onChange={(e) => go({ channel: e.target.value || null })}
            className="h-8 rounded-lg border bg-surface px-2 text-xs text-fg outline-none focus:border-accent"
          >
            <option value="">Semua nomor</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {pending && <span className="text-[11px] text-fg-muted">Memuat…</span>}
      </div>

      <div className={cn('transition-opacity', pending && 'pointer-events-none opacity-50')}>{children}</div>
    </>
  )
}
