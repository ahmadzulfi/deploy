import { notFound } from 'next/navigation'
import { prisma } from '@wa/db'
import { hasRole, requireUser } from '@/lib/auth'
import { WindowBadge, windowState } from '@/components/window-badge'
import { MessageBubble } from '@/components/message-bubble'
import { Composer } from '@/components/composer'
import { BotToggle } from '@/components/bot-toggle'
import { EndSession } from '@/components/end-session'
import { MarkRead } from '@/components/mark-read'
import { LabelPicker } from '@/components/labels/label-picker'

export const dynamic = 'force-dynamic'

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      contact: true,
      channel: { select: { orgId: true, name: true, sendingPaused: true, wabaId: true } },
      assignee: { select: { name: true } },
      labels: { select: { labelId: true }, orderBy: { createdAt: 'asc' } },
      messages: { orderBy: { createdAt: 'asc' }, take: 200 },
    },
  })

  if (!conversation || conversation.channel.orgId !== user.orgId) notFound()

  const state = windowState(conversation.windowExpiresAt)

  // Templates live on the WABA, so any number under it can send them.
  // Authentication templates carry one-time codes an agent should never type.
  const templates = conversation.channel.wabaId
    ? await prisma.template.findMany({
        where: {
          wabaId: conversation.channel.wabaId,
          metaStatus: 'APPROVED',
          category: { not: 'AUTHENTICATION' },
        },
        orderBy: [{ name: 'asc' }, { language: 'asc' }],
        select: { id: true, name: true, language: true, category: true, components: true },
      })
    : []

  const labels = await prisma.label.findMany({
    where: { orgId: user.orgId },
    select: { id: true, name: true, color: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="flex h-full flex-col">
      <MarkRead conversationId={conversation.id} unreadCount={conversation.unreadCount} />

      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-surface px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-fg">
              {conversation.contact.name || conversation.contact.waId}
            </span>
            <WindowBadge expiresAt={conversation.windowExpiresAt} />
            {conversation.status === 'CLOSED' && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] text-fg-muted">selesai</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-fg-muted">
            <span className="font-mono">{conversation.contact.waId}</span> ·{' '}
            {conversation.channel.name}
            {conversation.assignee && <> · ditangani {conversation.assignee.name}</>}
          </div>
        </div>

        <div className="flex min-w-0 shrink items-center gap-2 pl-3">
          <LabelPicker
            conversationId={conversation.id}
            labels={labels}
            selected={conversation.labels.map((l) => l.labelId)}
            readOnly={user.role === 'VIEWER'}
            canManage={hasRole(user, 'SUPERVISOR')}
          />
          {user.role !== 'VIEWER' && (
            <EndSession conversationId={conversation.id} closed={conversation.status === 'CLOSED'} />
          )}
          <BotToggle conversationId={conversation.id} paused={conversation.botPaused} />
        </div>
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
        templates={templates}
      />
    </div>
  )
}
