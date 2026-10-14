import { prisma, FlowStatus, RouteOutcome, RouteReview, type Prisma } from '@wa/db'
import { buildRouteCatalog, flowGraphSchema, type FlowGraph } from '@wa/core/flow'

/**
 * What the Arahkan AI review pages read: which flows route, their menus,
 * the decisions waiting for an admin, and the examples already approved.
 */

export interface MenuOption {
  id: string
  path: string
}

/** Flows an admin can review: those routing now, or that left decisions. */
export async function routedFlows(orgId: string): Promise<{ id: string; name: string }[]> {
  const [flows, decided] = await Promise.all([
    prisma.flow.findMany({
      where: { orgId, status: { not: FlowStatus.ARCHIVED } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, draftGraph: true, publishedVersion: { select: { graph: true } } },
    }),
    prisma.routeDecision.groupBy({ by: ['flowId'], where: { orgId } }),
  ])
  const withDecisions = new Set(decided.map((d) => d.flowId))
  return flows
    .filter((f) => withDecisions.has(f.id) || routes(f.publishedVersion?.graph) || routes(f.draftGraph))
    .map((f) => ({ id: f.id, name: f.name }))
}

/**
 * The destinations an example can point at: the live menu, else the draft.
 * Examples are matched by id, and the live menu is what the router is sent.
 */
export async function flowMenu(orgId: string, flowId: string): Promise<MenuOption[]> {
  const flow = await prisma.flow.findFirst({
    where: { id: flowId, orgId },
    select: { draftGraph: true, publishedVersion: { select: { graph: true } } },
  })
  const graph = parse(flow?.publishedVersion?.graph) ?? parse(flow?.draftGraph)
  return graph ? buildRouteCatalog(graph).map((d) => ({ id: d.id, path: d.path })) : []
}

/** The review page's filters, each a set of outcomes. */
export const REVIEW_VIEWS = {
  picked: { label: 'Dipilih warga', outcomes: [RouteOutcome.PICKED] },
  missed: { label: 'Tidak terjawab', outcomes: [RouteOutcome.OTHER, RouteOutcome.UNSURE] },
  jumped: { label: 'Langsung diarahkan', outcomes: [RouteOutcome.JUMPED] },
} as const satisfies Record<string, { label: string; outcomes: RouteOutcome[] }>

export type ReviewView = keyof typeof REVIEW_VIEWS

export const REVIEW_PAGE_SIZE = 100

function pending(orgId: string, flowId: string, view: ReviewView): Prisma.RouteDecisionWhereInput {
  return {
    orgId,
    flowId,
    outcome: { in: [...REVIEW_VIEWS[view].outcomes] },
    reviewStatus: RouteReview.PENDING,
    question: { not: null },
  }
}

export async function reviewQueue(orgId: string, flowId: string, view: ReviewView) {
  const where = pending(orgId, flowId, view)
  const [rows, total] = await Promise.all([
    prisma.routeDecision.findMany({ where, orderBy: { createdAt: 'desc' }, take: REVIEW_PAGE_SIZE }),
    prisma.routeDecision.count({ where }),
  ])
  return { rows, total }
}

/** How many decisions wait in each view, for the filter badges. */
export async function reviewCounts(orgId: string, flowId: string): Promise<Record<ReviewView, number>> {
  const views = Object.keys(REVIEW_VIEWS) as ReviewView[]
  const counts = await Promise.all(views.map((v) => prisma.routeDecision.count({ where: pending(orgId, flowId, v) })))
  return Object.fromEntries(views.map((v, i) => [v, counts[i]])) as Record<ReviewView, number>
}

export interface RouteStats {
  total: number
  jumped: number
  /** Shown "Maksud Anda" and tapped one of the destinations. */
  picked: number
  /** Shown "Maksud Anda" and tapped Lainnya or typed instead. */
  other: number
  /** Shown "Maksud Anda" and never answered. */
  unanswered: number
  unsure: number
  skipped: number
  error: number
}

export async function routeStats(orgId: string, flowId: string, days: number): Promise<RouteStats> {
  const groups = await prisma.routeDecision.groupBy({
    by: ['outcome'],
    where: { orgId, flowId, createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60_000) } },
    _count: { _all: true },
  })
  const n = (o: RouteOutcome) => groups.find((g) => g.outcome === o)?._count._all ?? 0
  const stats = {
    jumped: n(RouteOutcome.JUMPED),
    picked: n(RouteOutcome.PICKED),
    other: n(RouteOutcome.OTHER),
    unanswered: n(RouteOutcome.ASKED),
    unsure: n(RouteOutcome.UNSURE),
    skipped: n(RouteOutcome.SKIPPED),
    error: n(RouteOutcome.ERROR),
  }
  return { ...stats, total: Object.values(stats).reduce((a, b) => a + b, 0) }
}

/** What contacts picked that no admin has looked at yet, across flows. */
export async function pendingPicks(orgId: string) {
  return prisma.routeDecision.count({
    where: { orgId, outcome: RouteOutcome.PICKED, reviewStatus: RouteReview.PENDING, question: { not: null } },
  })
}

/** The flow a page shows: the one asked for, else the first that routes. */
export function chooseFlow<T extends { id: string }>(flows: T[], wanted: string | undefined): T | undefined {
  return flows.find((f) => f.id === wanted) ?? flows[0]
}

export async function routeExamples(orgId: string, flowId: string) {
  return prisma.routeExample.findMany({
    where: { orgId, flowId },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { name: true } } },
  })
}

function routes(graph: unknown): boolean {
  return !!parse(graph)?.nodes.some((n) => n.data.kind === 'aiRoute')
}

function parse(graph: unknown): FlowGraph | null {
  const parsed = flowGraphSchema.safeParse(graph)
  return parsed.success ? parsed.data : null
}
