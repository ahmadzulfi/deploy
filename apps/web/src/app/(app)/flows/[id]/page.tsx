import { notFound } from 'next/navigation'
import { prisma } from '@wa/db'
import { flowGraphSchema, EMPTY_GRAPH } from '@wa/core/flow'
import { requireUser } from '@/lib/auth'
import { FlowEditor } from '@/components/flow/editor'

export const dynamic = 'force-dynamic'

export default async function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params

  const flow = await prisma.flow.findUnique({
    where: { id },
    include: { publishedVersion: { select: { version: true } } },
  })
  if (!flow || flow.orgId !== user.orgId) notFound()

  const parsed = flowGraphSchema.safeParse(flow.draftGraph)

  // A flow is not tied to one number, so offer every approved template in the
  // org. The same name+language on two WABAs shows once.
  const rows = await prisma.template.findMany({
    where: { channel: { orgId: user.orgId }, metaStatus: 'APPROVED', category: { not: 'AUTHENTICATION' } },
    orderBy: [{ name: 'asc' }, { language: 'asc' }],
    select: { name: true, language: true, category: true, metaStatus: true, components: true },
  })
  const seen = new Set<string>()
  const templates = rows
    .filter((t) => {
      const k = `${t.name}:${t.language}`
      return seen.has(k) ? false : (seen.add(k), true)
    })
    .map((t) => ({ ...t, status: t.metaStatus }))

  const aiEndpoints = await prisma.aiEndpoint.findMany({
    where: { orgId: user.orgId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-surface px-4">
        <span className="text-sm text-fg">{flow.name}</span>
        {!flow.enabled && (
          <span
            className="rounded bg-warn-bg px-1.5 py-px text-[10px] text-warn"
            title="Flow ini tidak menjawab pesan masuk. Aktifkan lagi dari daftar Flow."
          >
            nonaktif
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <FlowEditor
          flowId={flow.id}
          initial={parsed.success ? parsed.data : EMPTY_GRAPH}
          publishedVersion={flow.publishedVersion?.version ?? null}
          templates={templates}
          aiEndpoints={aiEndpoints}
        />
      </div>
    </div>
  )
}
