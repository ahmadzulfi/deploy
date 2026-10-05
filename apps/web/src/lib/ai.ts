import { prisma, FlowStatus } from '@wa/db'
import { buildRouteCatalog, flowGraphSchema, type FlowGraph, type RouteDestination } from '@wa/core/flow'

/**
 * Which flows use which AI endpoint, as endpoint id -> flow names.
 *
 * Reads both the draft and the live version: a flow whose draft no longer
 * asks an AI may still be running a published version that does.
 */
export async function aiUsage(orgId: string): Promise<Map<string, string[]>> {
  const flows = await prisma.flow.findMany({
    where: { orgId, status: { not: FlowStatus.ARCHIVED } },
    select: { name: true, draftGraph: true, publishedVersion: { select: { graph: true } } },
  })

  const usage = new Map<string, string[]>()
  for (const flow of flows) {
    const ids = new Set([...endpointIds(flow.draftGraph), ...endpointIds(flow.publishedVersion?.graph)])
    for (const id of ids) usage.set(id, [...(usage.get(id) ?? []), flow.name])
  }
  return usage
}

/** Loose on purpose: an unparseable graph should not hide a reference. */
function endpointIds(graph: unknown): string[] {
  const nodes = (graph as { nodes?: { data?: { kind?: string; endpointId?: string } }[] } | null)?.nodes
  if (!Array.isArray(nodes)) return []
  return nodes.flatMap((n) =>
    (n?.data?.kind === 'askAi' || n?.data?.kind === 'aiRoute') && n.data.endpointId ? [n.data.endpointId] : [],
  )
}

/** Stands in when no flow has a menu yet, so the test button still works. */
const SAMPLE_CATALOG: RouteDestination[] = [
  {
    id: 'contoh_skck',
    path: 'Layanan Publik › Polres (SKCK)',
    description: 'Surat Keterangan Catatan Kepolisian',
    content: 'Pembuatan SKCK di Mal Pelayanan Publik.',
    target: '',
  },
  {
    id: 'contoh_paspor',
    path: 'Layanan Publik › Imigrasi (Paspor)',
    description: 'Permohonan dan penggantian paspor',
    content: 'Layanan paspor di Mal Pelayanan Publik.',
    target: '',
  },
  {
    id: 'contoh_pengaduan',
    path: 'Pengaduan › Tulis Pengaduan',
    description: 'Sampaikan keluhan langsung di chat ini',
    content: 'Silakan tuliskan keluhan atau aspirasi Anda.',
    target: '',
  },
]

/**
 * The menu the AI page tests a router against: the first flow using Arahkan
 * AI (published graph first), else the first flow with any menu.
 */
export async function routeTestCatalog(orgId: string): Promise<{ label: string; destinations: RouteDestination[] }> {
  const flows = await prisma.flow.findMany({
    where: { orgId, status: { not: FlowStatus.ARCHIVED } },
    orderBy: { updatedAt: 'desc' },
    select: { name: true, draftGraph: true, publishedVersion: { select: { graph: true } } },
  })

  const graphs = flows.flatMap((f) => {
    const g = parse(f.publishedVersion?.graph) ?? parse(f.draftGraph)
    return g ? [{ name: f.name, graph: g }] : []
  })
  const routed = graphs.find((f) => f.graph.nodes.some((n) => n.data.kind === 'aiRoute'))
  for (const f of routed ? [routed, ...graphs] : graphs) {
    const destinations = buildRouteCatalog(f.graph)
    if (destinations.length) return { label: `menu flow "${f.name}"`, destinations }
  }
  return { label: 'menu contoh (belum ada flow bermenu)', destinations: SAMPLE_CATALOG }
}

function parse(graph: unknown): FlowGraph | null {
  const parsed = flowGraphSchema.safeParse(graph)
  return parsed.success ? parsed.data : null
}
