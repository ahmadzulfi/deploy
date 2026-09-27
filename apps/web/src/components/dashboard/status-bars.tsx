'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

export interface StatusRow {
  key: string
  label: string
  value: number
  /** A failure state: drawn in the critical colour and marked with an icon, never colour alone. */
  critical?: boolean
}

const fmt = new Intl.NumberFormat('id-ID')
const pct = new Intl.NumberFormat('id-ID', { style: 'percent', maximumFractionDigits: 1 })

export function StatusBars({ title, rows, note }: { title: string; rows: StatusRow[]; note?: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const total = rows.reduce((s, r) => s + r.value, 0)
  const max = Math.max(1, ...rows.map((r) => r.value))

  return (
    <figure className="min-w-0 rounded-xl border bg-surface p-4">
      <figcaption className="mb-3 flex items-baseline justify-between">
        <span className="text-sm text-fg">{title}</span>
        <span className="text-[11px] text-fg-muted">{fmt.format(total)} pesan</span>
      </figcaption>

      {total === 0 ? (
        <p className="py-8 text-center text-xs text-fg-muted">Belum ada pesan keluar di rentang ini.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => {
            const share = total ? r.value / total : 0
            return (
              <li
                key={r.key}
                tabIndex={0}
                onPointerEnter={() => setHover(r.key)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(r.key)}
                onBlur={() => setHover(null)}
                // The whole row is the hit target, not just the painted bar.
                className={cn(
                  'grid grid-cols-[88px_1fr] items-center gap-3 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  hover === r.key && 'bg-muted',
                )}
                aria-label={`${r.label}: ${fmt.format(r.value)} (${pct.format(share)})`}
              >
                <span className="flex items-center gap-1.5 text-[12px] text-fg">
                  {r.critical && (
                    <span
                      aria-hidden
                      className="flex size-3.5 items-center justify-center rounded-full bg-danger-bg text-[9px] font-bold text-danger"
                    >
                      !
                    </span>
                  )}
                  {r.label}
                </span>
                <span className="flex items-center gap-2">
                  <span aria-hidden className="block h-4 min-w-0 flex-1">
                    {r.value > 0 && (
                      // Square at the baseline, 4px rounded data-end.
                      <span
                        className="block h-full rounded-r-[4px] transition-opacity"
                        style={{
                          width: `${Math.max((r.value / max) * 100, 0.8)}%`,
                          background: r.critical ? 'var(--color-critical)' : 'var(--color-series-1)',
                          opacity: hover && hover !== r.key ? 0.45 : 1,
                        }}
                      />
                    )}
                  </span>
                  <span className="w-20 shrink-0 text-right text-[12px] tabular-nums">
                    <span className="font-medium text-fg">{fmt.format(r.value)}</span>{' '}
                    <span className={cn('text-fg-muted', hover !== r.key && 'invisible')}>{pct.format(share)}</span>
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {note && <p className="mt-3 text-[11px] text-fg-muted">{note}</p>}
    </figure>
  )
}
