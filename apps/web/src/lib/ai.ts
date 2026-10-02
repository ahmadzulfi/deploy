import { prisma, FlowStatus } from '@wa/db'

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
  return nodes.flatMap((n) => (n?.data?.kind === 'askAi' && n.data.endpointId ? [n.data.endpointId] : []))
}
