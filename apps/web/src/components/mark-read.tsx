'use client'

import { useEffect } from 'react'
import { markRead } from '@/lib/actions/messages'

/**
 * Clears the unread badge once the thread is on screen.
 *
 * Renders nothing. A server component must not write during render, so the
 * reset rides along as an effect. The sidebar badge is hidden by
 * ConversationRow itself, so the action does not refetch the layout.
 */
export function MarkRead({
  conversationId,
  unreadCount,
}: {
  conversationId: string
  unreadCount: number
}) {
  useEffect(() => {
    if (unreadCount === 0) return
    void markRead(conversationId)
  }, [conversationId, unreadCount])

  return null
}
