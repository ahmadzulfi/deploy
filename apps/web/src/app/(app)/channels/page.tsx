import { prisma } from '@wa/db'
import { requireUser } from '@/lib/auth'
import { AddChannelForm } from '@/components/add-channel-form'
import { ChannelActions } from '@/components/channel-actions'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const QUALITY_TONE: Record<string, string> = {
  GREEN: 'bg-ok-bg text-ok',
  YELLOW: 'bg-warn-bg text-warn',
  RED: 'bg-danger-bg text-danger',
  UNKNOWN: 'bg-muted text-fg-muted',
}

export default async function ChannelsPage() {
  const user = await requireUser()

  const channels = await prisma.channel.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { conversations: true } } },
  })

  const canManage = user.role === 'OWNER' || user.role === 'ADMIN'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-1 flex items-baseline justify-between">
          <h1 className="text-base text-fg">Nomor WhatsApp</h1>
          <span className="text-xs text-fg-muted">{channels.length} terdaftar</span>
        </div>
        <p className="mb-5 text-xs text-fg-muted">
          Setiap nomor punya token, kuota, dan quality rating sendiri. Menambah nomor tidak
          menyentuh konfigurasi nomor lain.
        </p>

        <div className="overflow-hidden rounded-lg border bg-surface">
          {channels.length === 0 && (
            <p className="p-8 text-center text-sm text-fg-muted">
              Belum ada nomor. Tambahkan yang pertama di bawah.
            </p>
          )}

          {channels.map((c, i) => (
            <div key={c.id} className={cn('flex items-center gap-4 p-4', i > 0 && 'border-t')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-fg">{c.name}</span>
                  {c.sendingPaused && (
                    <span
                      className="rounded bg-danger-bg px-1.5 py-px text-[10px] text-danger"
                      title={c.pausedReason ?? undefined}
                    >
                      pengiriman dijeda
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-fg-muted">
                  {c.displayPhone ?? '—'}
                </div>
              </div>

              <div className="hidden w-28 shrink-0 sm:block">
                <div className="text-[10px] text-fg-muted">Kualitas</div>
                <span
                  className={cn(
                    'mt-0.5 inline-flex rounded px-1.5 py-px text-[10px]',
                    QUALITY_TONE[c.qualityRating] ?? QUALITY_TONE.UNKNOWN,
                  )}
                >
                  {c.qualityRating.toLowerCase()}
                </span>
              </div>

              <div className="hidden w-24 shrink-0 sm:block">
                <div className="text-[10px] text-fg-muted">Kuota</div>
                <div className="mt-0.5 text-xs text-fg">{c.messagingTier.replace('TIER_', '')}</div>
              </div>

              <div className="hidden w-20 shrink-0 md:block">
                <div className="text-[10px] text-fg-muted">Percakapan</div>
                <div className="mt-0.5 text-xs text-fg">{c._count.conversations}</div>
              </div>

              <ChannelActions
                channelId={c.id}
                paused={c.sendingPaused}
                canManage={user.role !== 'AGENT' && user.role !== 'VIEWER'}
              />
            </div>
          ))}
        </div>

        {canManage ? (
          <AddChannelForm />
        ) : (
          <p className="mt-5 text-xs text-fg-muted">
            Hanya admin yang dapat menambah nomor.
          </p>
        )}
      </div>
    </div>
  )
}
