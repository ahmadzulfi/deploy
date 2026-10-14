import { hasRole, requireUser } from '@/lib/auth'
import { shortTime } from '@/lib/utils'
import { chooseFlow, flowMenu, pendingPicks, routeExamples, routedFlows } from '@/lib/route-review'
import { AdminOnly, AiHeader } from '@/components/ai/ai-header'
import { RouteExamples } from '@/components/ai/route-examples'

export const dynamic = 'force-dynamic'

const INTRO =
  'Contoh pertanyaan yang sudah disetujui admin, dikelompokkan per menu tujuan. Contoh dikirim ke router Arahkan AI ' +
  'bersama daftar menu: pertanyaan warga yang hampir sama langsung diarahkan, yang hanya mirip dipakai sebagai petunjuk.'

export default async function RouteExamplesPage({ searchParams }: { searchParams: Promise<{ flow?: string }> }) {
  const user = await requireUser()
  const sp = await searchParams

  if (!hasRole(user, 'ADMIN')) {
    return (
      <Page>
        <AiHeader active="/ai/examples" intro={INTRO} />
        <AdminOnly />
      </Page>
    )
  }

  const [flows, pending] = await Promise.all([routedFlows(user.orgId), pendingPicks(user.orgId)])
  const flow = chooseFlow(flows, sp.flow)
  if (!flow) {
    return (
      <Page>
        <AiHeader active="/ai/examples" pending={pending} intro={INTRO} />
        <div className="rounded-lg border bg-surface p-10 text-center text-sm text-fg-muted">
          Belum ada flow yang memakai node Arahkan AI.
        </div>
      </Page>
    )
  }

  const [menu, examples] = await Promise.all([flowMenu(user.orgId, flow.id), routeExamples(user.orgId, flow.id)])

  return (
    <Page>
      <AiHeader
        active="/ai/examples"
        pending={pending}
        intro={INTRO}
        flows={flows}
        flowId={flow.id}
        hrefFor={(id) => `/ai/examples?flow=${id}`}
      />
      <RouteExamples
        flowId={flow.id}
        menu={[...menu].sort((a, b) => a.path.localeCompare(b.path, 'id'))}
        examples={examples.map((e) => ({
          id: e.id,
          question: e.question,
          destinationId: e.destinationId,
          by: e.createdBy?.name ?? null,
          when: shortTime(e.createdAt),
        }))}
      />
    </Page>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">{children}</div>
    </div>
  )
}
