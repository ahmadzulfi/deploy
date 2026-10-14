import Link from 'next/link'
import { hasRole, requireUser } from '@/lib/auth'
import { cn, shortTime } from '@/lib/utils'
import {
  REVIEW_PAGE_SIZE,
  REVIEW_VIEWS,
  chooseFlow,
  flowMenu,
  pendingPicks,
  reviewCounts,
  reviewQueue,
  routeStats,
  routedFlows,
  type ReviewView,
  type RouteStats,
} from '@/lib/route-review'
import { AdminOnly, AiHeader } from '@/components/ai/ai-header'
import { RouteReviewTable, type ReviewRow } from '@/components/ai/route-review-table'

export const dynamic = 'force-dynamic'

const INTRO =
  'Setiap keputusan Arahkan AI dicatat di sini selama 90 hari. Jadikan contoh pertanyaan yang tujuannya benar, supaya ' +
  'pertanyaan yang mirip nanti langsung diarahkan tanpa tanya balik. Nomor panjang dan email sudah disamarkan.'

const VIEW_HINT: Record<ReviewView, string> = {
  picked: 'Warga tidak langsung diarahkan, lalu memilih sendiri dari list "Maksud Anda". Pilihannya biasanya benar.',
  missed: 'Warga akhirnya ke menu utama: AI ragu, atau warga memilih "Lainnya". Beri tujuan yang benar kalau ada.',
  jumped: 'AI langsung mengarahkan. Periksa sesekali untuk menemukan arah yang salah.',
}

const EMPTY: Record<ReviewView, string> = {
  picked: 'Belum ada pilihan warga yang perlu ditinjau.',
  missed: 'Tidak ada pertanyaan yang tidak terjawab.',
  jumped: 'Belum ada keputusan langsung yang perlu diperiksa.',
}

export default async function RouteReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string; view?: string; days?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams

  if (!hasRole(user, 'ADMIN')) {
    return (
      <Page>
        <AiHeader active="/ai/review" intro={INTRO} />
        <AdminOnly />
      </Page>
    )
  }

  const flows = await routedFlows(user.orgId)
  const flow = chooseFlow(flows, sp.flow)
  const view: ReviewView = sp.view && sp.view in REVIEW_VIEWS ? (sp.view as ReviewView) : 'picked'
  const days = sp.days === '30' ? 30 : 7
  const href = (p: { flow?: string; view?: ReviewView; days?: number }) => {
    const q = new URLSearchParams({
      flow: p.flow ?? flow?.id ?? '',
      view: p.view ?? view,
      days: String(p.days ?? days),
    })
    return `/ai/review?${q}`
  }

  const pending = await pendingPicks(user.orgId)
  if (!flow) {
    return (
      <Page>
        <AiHeader active="/ai/review" pending={pending} intro={INTRO} />
        <div className="rounded-lg border bg-surface p-10 text-center text-sm text-fg-muted">
          Belum ada flow yang memakai node Arahkan AI.
        </div>
      </Page>
    )
  }

  const [menu, queue, counts, stats] = await Promise.all([
    flowMenu(user.orgId, flow.id),
    reviewQueue(user.orgId, flow.id, view),
    reviewCounts(user.orgId, flow.id),
    routeStats(user.orgId, flow.id, days),
  ])
  const pathOf = new Map(menu.map((m) => [m.id, m.path]))

  const rows: ReviewRow[] = queue.rows.map((d) => ({
    id: d.id,
    when: shortTime(d.createdAt),
    question: d.question ?? '',
    outcome: d.outcome as ReviewRow['outcome'],
    path: d.destinationPath,
    destinationId: d.destinationId,
    score: d.score,
    candidates: ((d.candidates ?? []) as { id: string; score: number }[]).map((c) => ({
      id: c.id,
      path: pathOf.get(c.id) ?? c.id,
      score: c.score,
    })),
  }))

  return (
    <Page>
      <AiHeader
        active="/ai/review"
        pending={pending}
        intro={INTRO}
        flows={flows}
        flowId={flow.id}
        hrefFor={(id) => href({ flow: id })}
      />

      <Stats stats={stats} days={days} hrefFor={(d) => href({ days: d })} />

      <div className="space-y-2">
        <nav aria-label="Saring keputusan" className="flex flex-wrap gap-1.5 text-xs">
          {(Object.keys(REVIEW_VIEWS) as ReviewView[]).map((v) => (
            <Link
              key={v}
              href={href({ view: v })}
              aria-current={v === view ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1',
                v === view ? 'border-accent bg-accent-bg text-accent' : 'text-fg-muted hover:text-fg',
              )}
            >
              {REVIEW_VIEWS[v].label}
              <span className="text-[10px]">{counts[v]}</span>
            </Link>
          ))}
        </nav>
        <p className="text-[11px] text-fg-muted">{VIEW_HINT[view]}</p>
      </div>

      <RouteReviewTable
        rows={rows}
        flowId={flow.id}
        menu={[...menu].sort((a, b) => a.path.localeCompare(b.path, 'id'))}
        empty={EMPTY[view]}
      />
      {queue.total > REVIEW_PAGE_SIZE && (
        <p className="text-[11px] text-fg-muted">
          Menampilkan {REVIEW_PAGE_SIZE} terbaru dari {queue.total}. Tinjau atau tolak yang ini dulu untuk melihat sisanya.
        </p>
      )}
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

/** Where questions ended up, as counts and shares of every decision. */
function Stats({ stats, days, hrefFor }: { stats: RouteStats; days: number; hrefFor: (days: number) => string }) {
  const pct = (n: number) => (stats.total ? `${Math.round((n / stats.total) * 100)}%` : '–')
  const tiles = [
    { label: 'Langsung diarahkan', value: stats.jumped, tone: 'text-accent' },
    { label: 'Lewat "Maksud Anda"', value: stats.picked, tone: 'text-ok' },
    { label: 'Ke menu utama', value: stats.unsure + stats.other + stats.unanswered, tone: 'text-fg' },
    { label: 'Disaring (pesan tipis)', value: stats.skipped, tone: 'text-fg-muted' },
    { label: 'AI gagal', value: stats.error, tone: stats.error ? 'text-danger' : 'text-fg-muted' },
  ]

  return (
    <section className="rounded-lg border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[13px] text-fg">{stats.total} keputusan</h2>
        <div className="ml-auto flex gap-1 text-[11px]">
          {[7, 30].map((d) => (
            <Link
              key={d}
              href={hrefFor(d)}
              aria-current={d === days ? 'page' : undefined}
              className={cn('rounded px-2 py-0.5', d === days ? 'bg-muted text-fg' : 'text-fg-muted hover:text-fg')}
            >
              {d} hari
            </Link>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label}>
            <dt className="text-[11px] text-fg-muted">{t.label}</dt>
            <dd className={cn('text-h5', t.tone)}>
              {t.value} <span className="text-[11px] text-fg-muted">{pct(t.value)}</span>
            </dd>
          </div>
        ))}
      </dl>
      {stats.other + stats.unanswered > 0 && (
        <p className="mt-3 text-[11px] text-fg-muted">
          &ldquo;Ke menu utama&rdquo; termasuk {stats.other} warga yang memilih &ldquo;Lainnya&rdquo; dan {stats.unanswered}{' '}
          yang tidak menjawab list &ldquo;Maksud Anda&rdquo;.
        </p>
      )}
    </section>
  )
}
