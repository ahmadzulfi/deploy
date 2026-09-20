'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Number and status filters. Local state for now - wiring them to the query
 * comes with the saved-view work; showing them keeps the multi-number shape of
 * the product visible from the first screen.
 */
export function ChannelFilter({ channels }: { channels: { id: string; name: string }[] }) {
  const [status, setStatus] = useState<'open' | 'mine' | 'closed'>('open')

  return (
    <div className="shrink-0 border-b p-3">
      <label className="flex items-center gap-1.5">
        <span className="text-[11px] text-fg-muted">Nomor</span>
        <select className="min-w-0 flex-1 rounded border-none bg-transparent text-xs text-fg outline-none">
          <option>Semua ({channels.length})</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-2 flex gap-1">
        {(['open', 'mine', 'closed'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] transition-colors',
              status === s ? 'bg-muted text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {s === 'open' ? 'Terbuka' : s === 'mine' ? 'Saya' : 'Selesai'}
          </button>
        ))}
      </div>
    </div>
  )
}
