import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma, RecipientStatus } from '@wa/db'
import { campaignAudienceSchema, renderTemplate } from '@wa/core'
import { requireUser } from '@/lib/auth'
import { estimateAudience } from '@/lib/audience'
import { CAMPAIGN_STATUS, formatStamp, RECIPIENT_STATUS } from '@/lib/campaigns'
import { CampaignActions } from '@/components/campaign-actions'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const SHOWN = 200

export default async function BroadcastDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params

  const c = await prisma.campaign.findUnique({
    where: { id },
    include: { channel: true, template: true },
  })
  if (!c || c.orgId !== user.orgId) notFound()

  const audience = campaignAudienceSchema.parse(c.audienceQuery ?? {})
  const variableMap = (c.variableMap ?? {}) as Record<string, string>

  const [groups, recipients, estimate] = await Promise.all([
    prisma.campaignRecipient.groupBy({ by: ['status'], where: { campaignId: c.id }, _count: { _all: true } }),
    prisma.campaignRecipient.findMany({
      where: { campaignId: c.id },
      include: { contact: { select: { id: true, name: true, waId: true } } },
      // Grouped by status, in the enum's order: waiting, sent… then failed and skipped.
      orderBy: [{ status: 'asc' }, { id: 'asc' }],
      take: SHOWN,
    }),
    // Before start there are no recipient rows yet; show what start would produce.
    c.startedAt ? Promise.resolve(null) : estimateAudience(user.orgId, audience),
  ])

  const n = (s: RecipientStatus) => groups.find((g) => g.status === s)?._count._all ?? 0
  const total = groups.reduce((sum, g) => sum + g._count._all, 0)
  const st = CAMPAIGN_STATUS[c.status] ?? CAMPAIGN_STATUS.DRAFT!
  const preview = renderTemplate(c.template.components, variableMap)
  const canManage = ['SUPERVISOR', 'ADMIN', 'OWNER'].includes(user.role)

  const stats: [string, number, string][] = [
    ['menunggu', n(RecipientStatus.PENDING), 'text-fg-muted'],
    ['terkirim', n(RecipientStatus.SENT), 'text-fg'],
    ['sampai', n(RecipientStatus.DELIVERED), 'text-ok'],
    ['dibaca', n(RecipientStatus.READ), 'text-ok'],
    ['gagal', n(RecipientStatus.FAILED), 'text-danger'],
    ['dilewati', n(RecipientStatus.SKIPPED), 'text-fg-muted'],
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <Link href="/broadcast" className="text-xs text-fg-muted hover:text-fg">
            ← Broadcast
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-h5 text-fg">{c.name}</h1>
            <span className={cn('rounded px-1.5 py-px text-[10px]', st.tone)}>{st.label}</span>
          </div>
          <p className="mt-1 text-[11px] text-fg-muted">
            Dari {c.channel.name} · template <span className="font-mono">{c.template.name}</span> ({c.template.language}) ·{' '}
            {c.throttlePerMin} pesan/menit
            {c.scheduleAt && ` · jadwal ${formatStamp(c.scheduleAt)}`}
            {c.startedAt && ` · mulai ${formatStamp(c.startedAt)}`}
            {c.completedAt && ` · selesai ${formatStamp(c.completedAt)}`}
          </p>
        </div>

        {c.error && <p className="rounded-lg border border-danger bg-danger-bg p-3 text-xs text-danger">{c.error}</p>}

        <CampaignActions
          id={c.id}
          status={c.status}
          canManage={canManage}
          recipients={estimate?.send ?? null}
          scheduled={c.scheduleAt && c.scheduleAt.getTime() > Date.now() ? formatStamp(c.scheduleAt) : null}
        />
        {(c.status === 'RUNNING' || c.status === 'PAUSED') && (
          <p className="text-[11px] text-fg-muted">
            Menjeda menghentikan antrean berikutnya; pesan yang sudah masuk antrean pengiriman tetap berangkat.
          </p>
        )}

        {estimate ? (
          <section className="rounded-lg border bg-surface p-4 text-[13px]">
            <b>{estimate.send}</b> kontak akan dikirimi
            {estimate.skipped > 0 && <span className="text-fg-muted"> · {estimate.skipped} dilewati (belum opt-in atau berhenti)</span>}
            <p className="mt-1 text-[11px] text-fg-muted">
              Perkiraan dari kondisi sekarang. Daftar pastinya dikunci saat broadcast mulai.
            </p>
          </section>
        ) : (
          <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {stats.map(([label, value, tone]) => (
              <div key={label} className="rounded-lg border bg-surface p-3">
                <div className={cn('text-lg', tone)}>{value}</div>
                <div className="text-[10px] text-fg-muted">{label}</div>
              </div>
            ))}
          </section>
        )}

        <section>
          <h2 className="text-sm text-fg">Pesan</h2>
          <div className="mt-2 rounded-lg border bg-accent-bg p-3 text-[12px]">
            {preview.header && <div className="font-medium text-fg">{preview.header}</div>}
            {preview.headerMedia && <div className="text-[11px] text-fg-muted">[{preview.headerMedia}]</div>}
            <div className="whitespace-pre-wrap text-fg">{preview.body}</div>
            {preview.footer && <div className="mt-1 text-[11px] text-fg-muted">{preview.footer}</div>}
          </div>
          <p className="mt-1 text-[11px] text-fg-muted">
            Penerima:{' '}
            {audience.tags.length
              ? `kontak dengan ${audience.match === 'all' ? 'semua' : 'salah satu'} tag ${audience.tags.join(', ')}`
              : 'semua kontak'}
            {audience.optInOnly ? ', hanya yang opt-in' : ''}.
          </p>
        </section>

        {total > 0 && (
          <section>
            <h2 className="text-sm text-fg">
              Penerima <span className="text-xs text-fg-muted">{total > SHOWN ? `${SHOWN} dari ${total}` : total}</span>
            </h2>
            <div className="mt-2 overflow-hidden rounded-lg border bg-surface">
              {recipients.map((r, i) => {
                const rs = RECIPIENT_STATUS[r.status] ?? RECIPIENT_STATUS.PENDING!
                return (
                  <div key={r.id} className={cn('flex items-center gap-3 px-3 py-2', i > 0 && 'border-t')}>
                    <Link href={`/contacts/${r.contact.id}`} className="min-w-0 flex-1 truncate text-[13px] text-fg hover:underline">
                      {r.contact.name || `+${r.contact.waId}`}
                    </Link>
                    {r.error && <span className="hidden min-w-0 flex-1 truncate text-[11px] text-fg-muted sm:block">{r.error}</span>}
                    <span className={cn('shrink-0 text-[11px]', rs.tone)}>{rs.label}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
