import { cn } from '@/lib/utils'

/**
 * Remaining time in the 24h customer service window.
 *
 * The single most load-bearing piece of UI here. An agent must know whether a
 * free-form reply will go through *before* typing it - finding out from a
 * failed send is too late, and the colour is what makes it glanceable across a
 * list of forty conversations.
 */
export function WindowBadge({
  expiresAt,
  className,
}: {
  expiresAt: Date | null | undefined
  className?: string
}) {
  const state = windowState(expiresAt)

  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-px text-[10px] leading-4 whitespace-nowrap',
        state.tone === 'ok' && 'bg-ok-bg text-ok',
        state.tone === 'warn' && 'bg-warn-bg text-warn',
        state.tone === 'danger' && 'bg-danger-bg text-danger',
        className,
      )}
      title={
        state.tone === 'danger'
          ? 'Window 24 jam tertutup. Hanya template yang sudah disetujui bisa dikirim.'
          : `Pesan bebas bisa dikirim sampai ${expiresAt?.toLocaleString('id-ID')}`
      }
    >
      {state.label}
    </span>
  )
}

export function windowState(expiresAt: Date | null | undefined, now = new Date()) {
  if (!expiresAt) return { tone: 'danger' as const, label: 'tertutup', open: false }

  const ms = expiresAt.getTime() - now.getTime()
  if (ms <= 0) return { tone: 'danger' as const, label: 'tertutup', open: false }

  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor(ms / 60_000)

  // Under two hours is the point where an agent should stop drafting and
  // start deciding, so that is where the colour changes.
  const tone = hours < 2 ? ('warn' as const) : ('ok' as const)
  const label = hours >= 1 ? `${hours}j tersisa` : `${minutes}m tersisa`

  return { tone, label, open: true }
}
