import Link from 'next/link'
import { prisma } from '@wa/db'
import { requireUser } from '@/lib/auth'
import { CAMPAIGN_STATUS, formatStamp } from '@/lib/campaigns'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function BroadcastPage() {
  const user = await requireUser()

  const campaigns = await prisma.campaign.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: 'desc' },
    include: {
      channel: { select: { name: true } },
      template: { select: { name: true } },
    },
  })

  const canCreate = ['SUPERVISOR', 'ADMIN', 'OWNER'].includes(user.role)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-1 flex items-baseline justify-between">
          <h1 className="text-h5 text-fg">Broadcast</h1>
          {canCreate && (
            <Link href="/broadcast/new" className="h-8 rounded-md bg-brand px-3 text-xs leading-8 font-medium text-on-brand hover:opacity-90">
              Buat broadcast
            </Link>
          )}
        </div>
        <p className="mb-5 text-xs text-fg-muted">
          Satu template ke banyak kontak sekaligus, dipilih lewat tag. Hanya template yang disetujui Meta
          yang bisa dipakai, karena kebanyakan penerima berada di luar window 24 jam. Kontak yang
          membalas STOP selalu dilewati.
        </p>

        <div className="overflow-hidden rounded-lg border bg-surface">
          {campaigns.length === 0 && (
            <p className="p-8 text-center text-sm text-fg-muted">Belum ada broadcast.</p>
          )}

          {campaigns.map((c, i) => {
            const st = CAMPAIGN_STATUS[c.status] ?? CAMPAIGN_STATUS.DRAFT!
            const done = c.sentCount + c.failedCount + c.skippedCount
            const pct = c.totalCount ? Math.round((done / c.totalCount) * 100) : 0
            return (
              <Link
                key={c.id}
                href={`/broadcast/${c.id}`}
                className={cn('flex items-center gap-4 p-4 hover:bg-muted', i > 0 && 'border-t')}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-fg">{c.name}</span>
                    <span className={cn('rounded px-1.5 py-px text-[10px]', st.tone)}>{st.label}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-fg-muted">
                    {c.channel.name} · <span className="font-mono">{c.template.name}</span> ·{' '}
                    {c.status === 'SCHEDULED' ? `dijadwalkan ${formatStamp(c.scheduleAt)}` : `dibuat ${formatStamp(c.createdAt)}`}
                  </div>
                </div>

                <div className="hidden w-40 shrink-0 sm:block">
                  {c.totalCount > 0 ? (
                    <>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-ok" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-[10px] text-fg-muted">
                        {c.sentCount} terkirim · {c.failedCount} gagal · {c.totalCount} total
                      </div>
                    </>
                  ) : (
                    <div className="text-[10px] text-fg-muted">belum dimulai</div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
