import Link from 'next/link'
import { prisma, FlowStatus } from '@wa/db'
import { requireUser } from '@/lib/auth'
import { createFlow } from '@/lib/actions/flows'
import { cn, shortTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function FlowsPage() {
  const user = await requireUser()

  const flows = await prisma.flow.findMany({
    where: { orgId: user.orgId, status: { not: FlowStatus.ARCHIVED } },
    orderBy: { updatedAt: 'desc' },
    include: {
      publishedVersion: { select: { version: true, publishedAt: true } },
      _count: { select: { triggers: true } },
    },
  })

  const canEdit = !['AGENT', 'VIEWER'].includes(user.role)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-1 flex items-baseline justify-between">
          <h1 className="text-base text-fg">Flow</h1>
          <span className="text-xs text-fg-muted">{flows.length} flow</span>
        </div>
        <p className="mb-5 text-xs text-fg-muted">
          Percakapan otomatis. Menerbitkan flow membuat versi baru — percakapan yang sedang
          berjalan tetap memakai versi lamanya sampai selesai.
        </p>

        <div className="overflow-hidden rounded-lg border bg-surface">
          {flows.length === 0 && (
            <p className="p-8 text-center text-sm text-fg-muted">
              Belum ada flow. Buat yang pertama di bawah.
            </p>
          )}

          {flows.map((f, i) => (
            <Link
              key={f.id}
              href={`/flows/${f.id}`}
              className={cn('flex items-center gap-4 p-4 hover:bg-muted', i > 0 && 'border-t')}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">{f.name}</div>
                <div className="mt-0.5 text-xs text-fg-muted">
                  Diubah {shortTime(f.updatedAt)}
                </div>
              </div>

              <div className="w-28 shrink-0">
                {f.publishedVersion ? (
                  <span className="rounded bg-ok-bg px-1.5 py-px text-[10px] text-ok">
                    live v{f.publishedVersion.version}
                  </span>
                ) : (
                  <span className="rounded bg-muted px-1.5 py-px text-[10px] text-fg-muted">
                    draf
                  </span>
                )}
              </div>

              <div className="hidden w-20 shrink-0 sm:block">
                <div className="text-[10px] text-fg-muted">Trigger</div>
                <div className="mt-0.5 text-xs text-fg">{f._count.triggers}</div>
              </div>
            </Link>
          ))}
        </div>

        {canEdit ? (
          <form action={createFlow} className="mt-5 flex gap-2">
            <input
              name="name"
              placeholder="Nama flow baru"
              className="h-9 w-64 rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent"
            />
            <button className="h-9 rounded-md bg-fg px-3 text-sm text-white hover:opacity-90">
              Buat flow
            </button>
          </form>
        ) : (
          <p className="mt-5 text-xs text-fg-muted">Peran kamu tidak bisa mengubah flow.</p>
        )}
      </div>
    </div>
  )
}
