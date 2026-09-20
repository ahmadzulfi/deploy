'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { toggleFlowEnabled } from '@/lib/actions/flows'
import { cn } from '@/lib/utils'

/**
 * One row on the flow list.
 *
 * A client component because the on/off switch has to sit inside a row that is
 * otherwise a link - wrapping the whole row in <Link> would make every toggle
 * click navigate away instead.
 */
export function FlowRow({
  id,
  name,
  updatedAt,
  version,
  enabled,
  triggerCount,
  canEdit,
  bordered,
}: {
  id: string
  name: string
  updatedAt: string
  version: number | null
  enabled: boolean
  triggerCount: number
  canEdit: boolean
  bordered: boolean
}) {
  const [pending, start] = useTransition()
  const live = version !== null && enabled

  return (
    <div className={cn('flex items-center gap-4 p-4 hover:bg-muted', bordered && 'border-t')}>
      <Link href={`/flows/${id}`} className="min-w-0 flex-1">
        <div className={cn('truncate text-sm', enabled ? 'text-fg' : 'text-fg-muted')}>{name}</div>
        <div className="mt-0.5 text-xs text-fg-muted">Diubah {updatedAt}</div>
      </Link>

      <div className="w-28 shrink-0">
        {version === null ? (
          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-fg-muted">draf</span>
        ) : live ? (
          <span className="rounded bg-ok-bg px-1.5 py-px text-[10px] text-ok">live v{version}</span>
        ) : (
          <span className="rounded bg-warn-bg px-1.5 py-px text-[10px] text-warn">
            nonaktif · v{version}
          </span>
        )}
      </div>

      <div className="hidden w-20 shrink-0 sm:block">
        <div className="text-[10px] text-fg-muted">Trigger</div>
        <div className="mt-0.5 text-xs text-fg">{triggerCount}</div>
      </div>

      {canEdit && (
        <button
          disabled={pending}
          onClick={() => start(() => void toggleFlowEnabled(id))}
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? `Nonaktifkan ${name}` : `Aktifkan ${name}`}
          title={
            enabled
              ? 'Nonaktifkan. Percakapan yang sedang berjalan tetap selesai.'
              : 'Aktifkan kembali. Flow akan menjawab pesan masuk yang cocok.'
          }
          className={cn(
            // Flex instead of an absolutely positioned knob: the knob had no
            // left offset, so its resting place was whatever the layout
            // happened to give it.
            'flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-50',
            enabled ? 'justify-end bg-ok' : 'justify-start bg-border',
          )}
        >
          <span className="size-4 rounded-full bg-surface shadow-sm" />
        </button>
      )}
    </div>
  )
}
