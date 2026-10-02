import { prisma } from '@wa/db'
import { requireUser } from '@/lib/auth'
import { ConversationList } from '@/components/conversation-list'
import { loadInbox } from '@/lib/inbox'
import { DEFAULT_FILTER } from '@/lib/inbox-filter'

export const dynamic = 'force-dynamic'

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  const [channels, labels, conversations] = await Promise.all([
    prisma.channel.findMany({
      where: { orgId: user.orgId },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.label.findMany({
      where: { orgId: user.orgId },
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    }),
    loadInbox(user, DEFAULT_FILTER),
  ])

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-surface">
        <ConversationList initial={conversations} channels={channels} labels={labels} />
      </aside>

      <section className="min-w-0 flex-1">{children}</section>
    </div>
  )
}
