import { prisma } from '@wa/db'
import { hasRole, requireUser } from '@/lib/auth'
import { SettingsTabs } from '@/components/settings/settings-tabs'
import { LabelsTable } from '@/components/labels/labels-table'

export const dynamic = 'force-dynamic'

export default async function LabelsPage() {
  const user = await requireUser()
  const canManage = hasRole(user, 'SUPERVISOR')

  const labels = await prisma.label.findMany({
    where: { orgId: user.orgId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { conversations: true } } },
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h1 className="text-h5 text-fg">Pengaturan</h1>
          <p className="mt-1 text-xs text-fg-muted">
            Label memilah percakapan di Inbox: pasang dari kepala percakapan, lalu saring daftar Inbox per label.
            Berbeda dengan grup kontak, label tidak pernah dipakai sebagai target broadcast.
          </p>
        </div>

        <SettingsTabs active="/settings/labels" />

        <div className="space-y-3">
          <LabelsTable
            canManage={canManage}
            labels={labels.map((l) => ({
              id: l.id,
              name: l.name,
              description: l.description,
              color: l.color,
              conversations: l._count.conversations,
            }))}
          />
        </div>
      </div>
    </div>
  )
}
