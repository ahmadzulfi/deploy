import { prisma, ConversationStatus, type Prisma } from '@wa/db'
import { shortTime } from '@/lib/utils'
import type { InboxFilter, InboxRow } from '@/lib/inbox-filter'

export async function loadInbox(user: { id: string; orgId: string }, filter: InboxFilter): Promise<InboxRow[]> {
  const where: Prisma.ConversationWhereInput = {
    channel: { orgId: user.orgId },
    status: filter.status === 'closed' ? ConversationStatus.CLOSED : { not: ConversationStatus.CLOSED },
    ...(filter.status === 'mine' ? { assigneeId: user.id } : {}),
    ...(filter.channelId ? { channelId: filter.channelId } : {}),
    ...(filter.labelId ? { labels: { some: { labelId: filter.labelId } } } : {}),
  }

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
    include: {
      contact: { select: { name: true, waId: true } },
      channel: { select: { name: true } },
      labels: {
        // Same order as the thread header, so a chip does not jump between them.
        orderBy: { label: { name: 'asc' } },
        select: { label: { select: { id: true, name: true, color: true } } },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { type: true, payload: true, direction: true },
      },
    },
  })

  return conversations.map((c) => ({
    id: c.id,
    title: c.contact.name || c.contact.waId,
    preview: preview(c.messages[0]),
    time: shortTime(c.lastMessageAt),
    channelName: c.channel.name,
    windowExpiresAt: c.windowExpiresAt,
    unreadCount: c.unreadCount,
    labels: c.labels.map((l) => l.label),
  }))
}

/** One-line summary of the latest message for the list row. */
function preview(m: { type: string; payload: unknown; direction: string } | undefined) {
  if (!m) return 'Belum ada pesan'
  const p = (m.payload ?? {}) as Record<string, unknown>
  const prefix = m.direction === 'OUT' ? 'Kamu: ' : ''

  if (typeof p.body === 'string') return prefix + p.body
  if (typeof p.title === 'string') return prefix + p.title
  if (typeof p.replyId === 'string') return `${prefix}↩ ${p.replyId}`
  if (m.type === 'template') return `${prefix}Template terkirim`
  return prefix + m.type
}
