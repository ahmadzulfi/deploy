import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@wa/db'
import { templateSlots } from '@wa/core/templates'
import { previewComponents, templateKind } from '@wa/core/template-draft'
import { requireUser } from '@/lib/auth'
import { CATEGORY_LABEL, TEMPLATE_STATUS, languageLabel, stamp } from '@/lib/template-labels'
import { WaBubble } from '@/components/templates/wa-preview'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params

  const t = await prisma.template.findUnique({
    where: { id },
    include: { channel: { select: { orgId: true, name: true, displayPhone: true } }, _count: { select: { campaigns: true } } },
  })
  if (!t || t.channel.orgId !== user.orgId) notFound()

  // Meta's review samples fill the blanks, so the preview reads like a real message.
  const slots = templateSlots(t.components)
  const samples = Object.fromEntries(slots.filter((s) => s.example).map((s) => [s.key, s.example!]))
  const preview = previewComponents(t.components, samples)
  const st = TEMPLATE_STATUS[t.metaStatus] ?? TEMPLATE_STATUS.PENDING!
  const cat = CATEGORY_LABEL[t.category]

  const facts: [string, React.ReactNode][] = [
    ['Kategori', cat?.label ?? t.category],
    ['Tipe', templateKind(t.category, t.components)],
    ['Bahasa', `${languageLabel(t.language)} (${t.language})`],
    ['Nomor', `${t.channel.name}${t.channel.displayPhone ? ` · ${t.channel.displayPhone}` : ''}`],
    ['WABA', <span key="w" className="font-mono">{t.wabaId}</span>],
    ['ID Meta', t.metaTemplateId ? <span key="m" className="font-mono">{t.metaTemplateId}</span> : '—'],
    ['Isian', slots.length ? slots.map((s) => s.key).join(', ') : 'tanpa isian'],
    ['Dipakai broadcast', `${t._count.campaigns}×`],
    ['Terakhir diubah', stamp(t.updatedAt)],
    ['Terakhir sinkron', t.syncedAt ? stamp(t.syncedAt) : '—'],
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-6">
        <div>
          <Link href="/templates" className="text-xs text-fg-muted hover:text-fg">
            ← Template
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-h5 text-fg">{t.name}</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-2 py-0.5 text-[11px] text-fg">
              <span className={cn('size-2 rounded-full', st.dot)} />
              {st.label}
            </span>
          </div>
        </div>

        {t.metaStatus === 'REJECTED' && (
          <div className="rounded-lg bg-danger-bg px-4 py-3 text-xs text-danger">
            <b>Ditolak Meta</b>
            {t.rejectionReason ? `: ${t.rejectionReason.toLowerCase().replaceAll('_', ' ')}.` : '.'} Perbaiki isinya
            lalu buat template baru dengan nama lain, atau ajukan banding di WhatsApp Manager.
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
          <section className="rounded-lg border bg-surface p-3">
            <h2 className="mb-2 text-xs text-fg-muted">Pratinjau</h2>
            <WaBubble preview={preview} className="min-h-72" />
          </section>

          <section className="rounded-lg border bg-surface">
            <dl className="divide-y text-[13px]">
              {facts.map(([k, v]) => (
                <div key={k} className="flex gap-4 px-4 py-2.5">
                  <dt className="w-36 shrink-0 text-fg-muted">{k}</dt>
                  <dd className="min-w-0 break-words text-fg">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <details className="rounded-lg border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-xs text-fg-muted">Definisi komponen (JSON)</summary>
          <pre className="overflow-x-auto border-t px-4 py-3 font-mono text-[11px] text-fg">
            {JSON.stringify(t.components, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  )
}
