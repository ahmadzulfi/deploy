'use client'

import { cn } from '@/lib/utils'
import type { InboxFilter, InboxStatus } from '@/lib/inbox-filter'
import { LabelDot } from '@/components/labels/label-chip'

/**
 * Number, label and status filters. The state lives in the URL, so a
 * filtered view survives opening a conversation and can be linked to.
 */
export function ChannelFilter({
  channels,
  labels,
  filter,
  onChange,
}: {
  channels: { id: string; name: string }[]
  labels: { id: string; name: string; color: string }[]
  filter: InboxFilter
  onChange: (next: InboxFilter) => void
}) {
  const activeLabel = labels.find((l) => l.id === filter.labelId)

  return (
    <div className="shrink-0 space-y-1 border-b p-3">
      <label className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[11px] text-fg-muted">Nomor</span>
        <select
          value={filter.channelId ?? ''}
          onChange={(e) => onChange({ ...filter, channelId: e.target.value || null })}
          className="min-w-0 flex-1 rounded border-none bg-transparent text-xs text-fg outline-none"
        >
          <option value="">Semua ({channels.length})</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {labels.length > 0 && (
        <label className="flex items-center gap-1.5">
          <span className="w-10 shrink-0 text-[11px] text-fg-muted">Label</span>
          {activeLabel && <LabelDot color={activeLabel.color} className="size-2" />}
          <select
            value={filter.labelId ?? ''}
            onChange={(e) => onChange({ ...filter, labelId: e.target.value || null })}
            className="min-w-0 flex-1 rounded border-none bg-transparent text-xs text-fg outline-none"
          >
            <option value="">Semua label</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex gap-1 pt-1">
        {(['open', 'mine', 'closed'] as const satisfies readonly InboxStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={filter.status === s}
            onClick={() => onChange({ ...filter, status: s })}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] transition-colors',
              filter.status === s ? 'bg-muted text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {s === 'open' ? 'Terbuka' : s === 'mine' ? 'Saya' : 'Selesai'}
          </button>
        ))}
      </div>
    </div>
  )
}
