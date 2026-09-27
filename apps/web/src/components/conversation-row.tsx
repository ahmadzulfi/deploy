'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { WindowBadge } from '@/components/window-badge'
import { cn } from '@/lib/utils'

/**
 * A client component purely so it can tell whether it is the open one.
 *
 * A layout does not receive its child route's dynamic params - `params.id` is
 * undefined in the inbox layout - so the active row has to read the pathname
 * itself rather than being told from above.
 */
export function ConversationRow({
  id,
  title,
  preview,
  time,
  channelName,
  windowExpiresAt,
  unreadCount,
}: {
  id: string
  title: string
  preview: string
  time: string
  channelName: string
  windowExpiresAt: Date | null
  unreadCount: number
}) {
  const active = usePathname() === `/inbox/${id}`

  // markRead no longer refreshes the layout, so this row forgets its own
  // badge once opened. Remembering the count it cleared lets a fresh one
  // (new messages after a refresh) show again.
  const [clearedAt, setClearedAt] = useState<number | null>(null)
  useEffect(() => {
    if (active && unreadCount > 0) setClearedAt(unreadCount)
  }, [active, unreadCount])
  const showUnread = unreadCount > 0 && !active && clearedAt !== unreadCount

  return (
    <Link
      href={`/inbox/${id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'block border-b border-l-2 px-3 py-2.5 transition-colors',
        active ? 'border-l-accent bg-muted' : 'border-l-transparent hover:bg-muted',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px] text-fg">{title}</span>
        <span className="shrink-0 text-[11px] text-fg-muted">{time}</span>
      </div>

      <p className="mt-0.5 truncate text-xs text-fg-muted">{preview}</p>

      <div className="mt-1.5 flex items-center gap-1.5">
        <WindowBadge expiresAt={windowExpiresAt} />
        <span className="truncate text-[10px] text-fg-muted">{channelName}</span>
        {showUnread && (
          <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 text-[10px] text-on-accent">
            {unreadCount}
          </span>
        )}
      </div>
    </Link>
  )
}
