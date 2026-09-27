import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma, ChannelStatus, TemplateStatus } from '@wa/db'
import { requireUser } from '@/lib/auth'
import { orgTags } from '@/lib/contacts'
import { CampaignForm } from '@/components/campaign-form'

export const dynamic = 'force-dynamic'

export default async function NewBroadcastPage() {
  const user = await requireUser()
  if (!['SUPERVISOR', 'ADMIN', 'OWNER'].includes(user.role)) redirect('/broadcast')

  const [channels, tags] = await Promise.all([
    prisma.channel.findMany({
      where: { orgId: user.orgId, status: ChannelStatus.CONNECTED },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, displayPhone: true, wabaId: true },
    }),
    orgTags(user.orgId),
  ])

  const wabaIds = [...new Set(channels.map((c) => c.wabaId).filter((w): w is string => !!w))]
  const templates = await prisma.template.findMany({
    where: { wabaId: { in: wabaIds }, metaStatus: TemplateStatus.APPROVED },
    orderBy: [{ name: 'asc' }, { language: 'asc' }],
    select: { id: true, name: true, language: true, category: true, wabaId: true, components: true },
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-6">
        <Link href="/broadcast" className="text-xs text-fg-muted hover:text-fg">
          ← Broadcast
        </Link>
        <h1 className="mt-2 mb-5 text-h5 text-fg">Broadcast baru</h1>
        <CampaignForm channels={channels} templates={templates} tags={tags} />
      </div>
    </div>
  )
}
