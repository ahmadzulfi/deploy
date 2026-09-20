import { notFound } from 'next/navigation'
import { prisma } from '@wa/db'
import { requireUser } from '@/lib/auth'
import { WindowBadge, windowState } from '@/components/window-badge'
import { MessageBubble } from '@/components/message-bubble'
import { Composer } from '@/components/composer'
import { BotToggle } from '@/components/bot-toggle'

export const dynamic = 'force-dynamic'

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      contact: true,
      channel: { select: { orgId: true, name: true, sendingPaused: true } },
      assignee: { select: { name: true } },
      messages: { orderBy: { createdAt: 'asc' }, take: 200 },
    },
  })

  if (!conversation || conversation.channel.orgId !== user.orgId) notFound()

  const state = windowState(conversation.windowExpiresAt)

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-surface px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-fg">
              {conversation.contact.name || conversation.contact.waId}
            </span>
            <WindowBadge expiresAt={conversation.windowExpiresAt} />
          </div>
          <div className="mt-0.5 truncate text-[11px] text-fg-muted">
            <span className="font-mono">{conversation.contact.waId}</span> ·{' '}
            {conversation.channel.name}
            {conversation.assignee && <> · ditangani {conversation.assignee.name}</>}
          </div>
        </div>

        <BotToggle conversationId={conversation.id} paused={conversation.botPaused} />
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-bg p-4">
        {conversation.messages.length === 0 && (
          <p className="pt-8 text-center text-xs text-fg-muted">Belum ada pesan.</p>
        )}
        {conversation.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      <Composer
        conversationId={conversation.id}
        windowOpen={state.open}
        readOnly={user.role === 'VIEWER'}
        channelPaused={conversation.channel.sendingPaused}
      />
    </div>
  )
}
