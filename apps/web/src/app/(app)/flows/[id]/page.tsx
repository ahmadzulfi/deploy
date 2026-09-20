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

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center border-b bg-surface px-4">
        <span className="text-sm text-fg">{flow.name}</span>
      </div>
      <div className="min-h-0 flex-1">
        <FlowEditor
          flowId={flow.id}
          initial={parsed.success ? parsed.data : EMPTY_GRAPH}
          publishedVersion={flow.publishedVersion?.version ?? null}
        />
      </div>
    </div>
  )
}
