'use server'

import { revalidatePath } from 'next/cache'
import { prisma, Prisma, RouteReview } from '@wa/db'
import { cleanRouteExample, ROUTE_EXAMPLE_MAX } from '@wa/core/flow'
import { requireRole } from '@/lib/auth'
import { flowMenu } from '@/lib/route-review'

export type ExampleFormState = { error?: string; saved?: boolean }

function refresh() {
  revalidatePath('/ai/review')
  revalidatePath('/ai/examples')
}

/**
 * Saves an example question for one menu destination - from a decision on
 * the review page, or typed in by hand on the examples page.
 *
 * The admin may reword the question and pick another destination; both are
 * checked against the flow's live menu, since that is what the router sees.
 */
export async function saveRouteExample(_prev: ExampleFormState, formData: FormData): Promise<ExampleFormState> {
  const user = await requireRole('ADMIN')
  const flowId = String(formData.get('flowId') ?? '')
  const decisionId = String(formData.get('decisionId') ?? '') || null
  const destinationId = String(formData.get('destinationId') ?? '')
  const question = cleanRouteExample(String(formData.get('question') ?? ''))

  if (!question) return { error: 'Tulis pertanyaannya dulu.' }
  if (question.length > ROUTE_EXAMPLE_MAX) return { error: `Pertanyaan maksimal ${ROUTE_EXAMPLE_MAX} karakter.` }

  const flow = await prisma.flow.findFirst({ where: { id: flowId, orgId: user.orgId }, select: { id: true } })
  if (!flow) return { error: 'Flow tidak ditemukan.' }

  const dest = (await flowMenu(user.orgId, flowId)).find((d) => d.id === destinationId)
  if (!dest) return { error: 'Tujuan itu sudah tidak ada di menu flow ini. Pilih tujuan lain.' }

  if (decisionId) {
    const decision = await prisma.routeDecision.findFirst({
      where: { id: decisionId, orgId: user.orgId, flowId },
      select: { id: true },
    })
    if (!decision) return { error: 'Keputusan ini sudah tidak ada, mungkin sudah lewat 90 hari.' }
  }

  // Exact duplicates are the unique index's job; this catches the same
  // words in another case, which would teach the router the same thing twice.
  const twin = await prisma.routeExample.findFirst({
    where: { flowId, question: { equals: question, mode: 'insensitive' } },
    select: { destinationId: true },
  })
  if (twin) {
    return {
      error:
        twin.destinationId === destinationId
          ? 'Pertanyaan ini sudah jadi contoh untuk tujuan yang sama.'
          : 'Pertanyaan ini sudah jadi contoh untuk tujuan lain. Hapus dulu contoh itu di tab Contoh aktif.',
    }
  }

  let exampleId: string
  try {
    const [example] = await prisma.$transaction([
      prisma.routeExample.create({
        data: { orgId: user.orgId, flowId, destinationId, question, sourceDecisionId: decisionId, createdById: user.id },
        select: { id: true },
      }),
      ...(decisionId
        ? [prisma.routeDecision.update({ where: { id: decisionId }, data: { reviewStatus: RouteReview.APPROVED } })]
        : []),
    ])
    exampleId = example.id
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { error: 'Pertanyaan ini sudah jadi contoh.' }
    }
    throw err
  }

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'route.example.create',
      resourceType: 'RouteExample',
      resourceId: exampleId,
      diff: { flowId, destinationId, path: dest.path, question, decisionId },
    },
  })
  refresh()
  return { saved: true }
}

/** Takes a decision off the review list without learning from it. */
export async function rejectRouteDecision(id: string): Promise<{ error?: string }> {
  const user = await requireRole('ADMIN')
  const { count } = await prisma.routeDecision.updateMany({
    where: { id, orgId: user.orgId, reviewStatus: RouteReview.PENDING },
    data: { reviewStatus: RouteReview.REJECTED },
  })
  if (count === 0) return { error: 'Keputusan ini sudah ditinjau atau sudah tidak ada.' }

  await prisma.auditLog.create({
    data: { orgId: user.orgId, actorId: user.id, action: 'route.decision.reject', resourceType: 'RouteDecision', resourceId: id },
  })
  refresh()
  return {}
}

export async function deleteRouteExample(id: string): Promise<{ error?: string }> {
  const user = await requireRole('ADMIN')
  const example = await prisma.routeExample.findFirst({ where: { id, orgId: user.orgId } })
  if (!example) return {}

  await prisma.routeExample.delete({ where: { id } })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'route.example.delete',
      resourceType: 'RouteExample',
      resourceId: id,
      diff: { flowId: example.flowId, destinationId: example.destinationId, question: example.question },
    },
  })
  refresh()
  return {}
}
