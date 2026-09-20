import { prisma, ConversationStatus } from '@wa/db'
import { requireUser } from '@/lib/auth'
import { ChannelFilter } from '@/components/channel-filter'
import { ConversationRow } from '@/components/conversation-row'
import { shortTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  const channels = await prisma.channel.findMany({
    where: { orgId: user.orgId },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })

  const conversations = await prisma.conversation.findMany({
    where: { channel: { orgId: user.orgId }, status: { not: ConversationStatus.CLOSED } },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
    include: {
      contact: { select: { name: true, waId: true } },
      channel: { select: { name: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { type: true, payload: true, direction: true },
      },
    },
  })

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-surface">
        <ChannelFilter channels={channels} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="p-6 text-center text-xs text-fg-muted">
              Belum ada percakapan. Pesan masuk akan muncul di sini.
            </p>
          )}

          {conversations.map((c) => (
            <ConversationRow
              key={c.id}
              id={c.id}
              title={c.contact.name || c.contact.waId}
              preview={preview(c.messages[0])}
              time={shortTime(c.lastMessageAt)}
              channelName={c.channel.name}
              windowExpiresAt={c.windowExpiresAt}
              unreadCount={c.unreadCount}
            />
          ))}
        </div>
      </aside>

      <section className="min-w-0 flex-1">{children}</section>
    </div>
  )
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
