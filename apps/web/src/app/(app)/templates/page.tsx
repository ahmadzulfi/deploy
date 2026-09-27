import { prisma, TemplateStatus, type Prisma } from '@wa/db'
import { renderTemplate } from '@wa/core/templates'
import { templateKind } from '@wa/core/template-draft'
import { hasRole, requireUser } from '@/lib/auth'
import { TEMPLATE_TABS, languageLabel, stamp, type TemplateTab } from '@/lib/template-labels'
import { TemplatesView, type TemplateRow } from '@/components/templates/templates-view'

export const dynamic = 'force-dynamic'

const PAGE_SIZES = [10, 25, 50]

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; category?: string; page?: string; per?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams
  const tab: TemplateTab = sp.tab && sp.tab in TEMPLATE_TABS ? (sp.tab as TemplateTab) : 'all'
  const q = sp.q?.trim() ?? ''
  const category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(sp.category ?? '') ? sp.category! : ''
  const per = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 10
  const page = Math.max(1, Number(sp.page) || 1)

  // Tab counts follow the search and category, so a tab never promises rows it will not show.
  const base: Prisma.TemplateWhereInput = {
    channel: { orgId: user.orgId },
    ...(category ? { category } : {}),
    ...(q ? { name: { contains: q.toLowerCase().replace(/\s+/g, '_'), mode: 'insensitive' } } : {}),
  }
  const statuses = TEMPLATE_TABS[tab].statuses
  const where: Prisma.TemplateWhereInput = {
    ...base,
    ...(statuses ? { metaStatus: { in: statuses as unknown as TemplateStatus[] } } : {}),
  }

  const [templates, total, byStatus, lastSynced] = await Promise.all([
    prisma.template.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * per,
      take: per,
      include: { channel: { select: { name: true } } },
    }),
    prisma.template.count({ where }),
    prisma.template.groupBy({ by: ['metaStatus'], where: base, _count: true }),
    prisma.template.findFirst({
      where: { channel: { orgId: user.orgId }, syncedAt: { not: null } },
      orderBy: { syncedAt: 'desc' },
      select: { syncedAt: true },
    }),
  ])

  const counts = Object.fromEntries(
    (Object.keys(TEMPLATE_TABS) as TemplateTab[]).map((t) => {
      const st = TEMPLATE_TABS[t].statuses as readonly string[] | null
      return [t, byStatus.filter((r) => !st || st.includes(r.metaStatus)).reduce((n, r) => n + r._count, 0)]
    }),
  ) as Record<TemplateTab, number>

  const rows: TemplateRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    language: languageLabel(t.language),
    body: renderTemplate(t.components).body,
    category: t.category,
    kind: templateKind(t.category, t.components),
    status: t.metaStatus,
    rejectionReason: t.rejectionReason,
    updated: stamp(t.updatedAt),
    channel: t.channel.name,
  }))

  return (
    <TemplatesView
      rows={rows}
      total={total}
      counts={counts}
      state={{ tab, q, category, page, per }}
      lastSync={lastSynced?.syncedAt ? stamp(lastSynced.syncedAt) : null}
      canSync={hasRole(user, 'AGENT')}
      canCreate={hasRole(user, 'SUPERVISOR')}
      canDelete={hasRole(user, 'ADMIN')}
    />
  )
}
