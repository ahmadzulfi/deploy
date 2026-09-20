'use client'

import { useTransition } from 'react'
import { resumeBot } from '@/lib/actions/messages'
import { cn } from '@/lib/utils'

/**
 * Whether the flow engine is still driving this conversation.
 *
 * Replying by hand pauses the bot automatically; this is how an agent hands it
 * back once they are done.
 */
export function BotToggle({ conversationId, paused }: { conversationId: string; paused: boolean }) {
  const [pending, start] = useTransition()

  if (!paused) {
    return (
      <span className="shrink-0 rounded-full bg-accent-bg px-2 py-0.5 text-[11px] text-accent">
        Bot aktif
      </span>
    )
  }

  return (
    <button
      disabled={pending}
      onClick={() => start(() => void resumeBot(conversationId))}
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-fg-muted',
        'hover:bg-muted hover:text-fg disabled:opacity-50',
      )}
      title="Kembalikan percakapan ini ke flow engine"
    >
      {pending ? '…' : 'Bot dijeda — aktifkan'}
    </button>
  )
}
