import { prisma } from '@wa/db'

/** Most examples sent with one question; past it the newest win. */
export const ROUTE_EXAMPLES_SENT_MAX = 500

/** One approved example as the POST /route contract sends it. */
export interface RouteWireExample {
  destination_id: string
  question: string
}

/**
 * The examples an admin approved for a flow, as a router is sent them with
 * that flow's menu: only those whose destination is still on it, so a row
 * removed from the menu stops teaching without anyone cleaning up.
 */
export async function routeExamplesFor(flowId: string, destinationIds: Iterable<string>): Promise<RouteWireExample[]> {
  const ids = [...new Set(destinationIds)]
  if (ids.length === 0) return []
  const rows = await prisma.routeExample.findMany({
    where: { flowId, destinationId: { in: ids } },
    orderBy: { createdAt: 'desc' },
    take: ROUTE_EXAMPLES_SENT_MAX,
    select: { destinationId: true, question: true },
  })
  return rows.map((r) => ({ destination_id: r.destinationId, question: r.question }))
}
