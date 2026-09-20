'use client'

import { useTransition } from 'react'
import { refreshChannelHealth, toggleChannelPause } from '@/lib/actions/channels'

export function ChannelActions({
  channelId,
  paused,
  canManage,
}: {
  channelId: string
  paused: boolean
  canManage: boolean
}) {
  const [pending, start] = useTransition()

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        disabled={pending}
        onClick={() => start(() => void refreshChannelHealth(channelId))}
        className="rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-muted hover:text-fg disabled:opacity-50"
        title="Baca ulang quality rating dan kuota dari Meta"
      >
        {pending ? '…' : 'Segarkan'}
      </button>

      {canManage && (
        <button
          disabled={pending}
          onClick={() => start(() => void toggleChannelPause(channelId))}
          className="rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-muted hover:text-fg disabled:opacity-50"
          title={
            paused
              ? 'Lanjutkan pengiriman keluar'
              : 'Hentikan semua pengiriman keluar dari nomor ini. Pesan masuk tetap diterima.'
          }
        >
          {paused ? 'Lanjutkan' : 'Jeda'}
        </button>
      )}
    </div>
  )
}
