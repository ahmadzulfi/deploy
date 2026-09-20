import { prisma, FlowStatus } from '@wa/db'
import { requireUser } from '@/lib/auth'
import { createFlow } from '@/lib/actions/flows'
import { FlowRow } from '@/components/flow-row'
import { shortTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function FlowsPage() {
  const user = await requireUser()

  const flows = await prisma.flow.findMany({
    where: { orgId: user.orgId, status: { not: FlowStatus.ARCHIVED } },
    // Stable order. Sorting by updatedAt made a row jump to the top the
    // moment its switch was flipped, so it looked like a different flow had
    // been toggled.
    orderBy: { createdAt: 'asc' },
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
          berjalan tetap memakai versi lamanya sampai selesai. Saklar di kanan mematikan flow
          tanpa membatalkan penerbitannya; pakai itu kalau dua flow berebut kata kunci yang sama.
        </p>

        <div className="overflow-hidden rounded-lg border bg-surface">
          {flows.length === 0 && (
            <p className="p-8 text-center text-sm text-fg-muted">
              Belum ada flow. Buat yang pertama di bawah.
            </p>
          )}

          {flows.map((f, i) => (
            <FlowRow
              key={f.id}
              id={f.id}
              name={f.name}
              updatedAt={shortTime(f.updatedAt)}
              version={f.publishedVersion?.version ?? null}
              enabled={f.enabled}
              triggerCount={f._count.triggers}
              canEdit={canEdit}
              bordered={i > 0}
            />
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
