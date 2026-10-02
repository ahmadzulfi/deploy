'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma, FlowStatus, Prisma } from '@wa/db'
import { flowGraphSchema, validateFlow, EMPTY_GRAPH, type FlowGraph } from '@wa/core/flow'
import { requireRole, requireUser } from '@/lib/auth'

export async function createFlow(formData: FormData) {
  const user = await requireRole('SUPERVISOR')
  const name = String(formData.get('name') ?? '').trim() || 'Flow baru'

  const flow = await prisma.flow.create({
    data: { orgId: user.orgId, name, draftGraph: EMPTY_GRAPH as unknown as Prisma.InputJsonValue },
    select: { id: true },
  })

  redirect(`/flows/${flow.id}`)
}

export type SaveResult = { savedAt: string } | { error: string }

/** Autosave target. Writes the working copy only - never what is live. */
export async function saveDraft(flowId: string, graph: unknown): Promise<SaveResult> {
  const user = await requireRole('SUPERVISOR')

  const parsed = flowGraphSchema.safeParse(graph)
  if (!parsed.success) return { error: 'Graf tidak valid dan tidak disimpan.' }

  const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { orgId: true } })
  if (!flow || flow.orgId !== user.orgId) return { error: 'Flow tidak ditemukan.' }

  await prisma.flow.update({
    where: { id: flowId },
    data: { draftGraph: parsed.data as unknown as Prisma.InputJsonValue },
  })

  return { savedAt: new Date().toISOString() }
}

export type PublishResult = { ok: true; version: number } | { ok: false; issues: string[] }

/**
 * Snapshots the draft into a new immutable FlowVersion and points the flow at
 * it.
 *
 * Running sessions keep their own version, so publishing never strands a
 * contact halfway through a graph whose nodes just changed underneath them.
 */
export async function publishFlow(flowId: string): Promise<PublishResult> {
  const user = await requireRole('SUPERVISOR')

  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true } } },
  })
  if (!flow || flow.orgId !== user.orgId) return { ok: false, issues: ['Flow tidak ditemukan.'] }

  const parsed = flowGraphSchema.safeParse(flow.draftGraph)
  if (!parsed.success) return { ok: false, issues: ['Graf tidak valid.'] }

  const ai = await prisma.aiEndpoint.findMany({ where: { orgId: user.orgId }, select: { id: true } })
  const blocking = validateFlow(parsed.data, { aiEndpointIds: new Set(ai.map((a) => a.id)) }).filter(
    (i) => i.severity === 'error',
  )
  if (blocking.length) return { ok: false, issues: blocking.map((i) => i.message) }

  const version = (flow.versions[0]?.version ?? 0) + 1

  const created = await prisma.flowVersion.create({
    data: {
      flowId,
      version,
      graph: parsed.data as unknown as Prisma.InputJsonValue,
      publishedBy: user.id,
    },
    select: { id: true },
  })

  await prisma.flow.update({
    where: { id: flowId },
    data: { publishedVersionId: created.id, status: FlowStatus.PUBLISHED },
  })

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'flow.publish',
      resourceType: 'Flow',
      resourceId: flowId,
      diff: { version },
    },
  })

  revalidatePath('/flows')
  revalidatePath(`/flows/${flowId}`)
  return { ok: true, version }
}

export async function renameFlow(flowId: string, name: string) {
  const user = await requireRole('SUPERVISOR')
  const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { orgId: true } })
  if (!flow || flow.orgId !== user.orgId) return

  await prisma.flow.update({ where: { id: flowId }, data: { name: name.trim() || 'Tanpa nama' } })
  revalidatePath('/flows')
}

/**
 * Turns a published flow on or off without unpublishing it.
 *
 * Conversations already in progress keep running on the version they started
 * with - stopping them mid-sentence would leave contacts waiting for a reply
 * that never comes.
 */
export async function toggleFlowEnabled(flowId: string) {
  const user = await requireRole('SUPERVISOR')

  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    select: { orgId: true, enabled: true, name: true },
  })
  if (!flow || flow.orgId !== user.orgId) return

  await prisma.flow.update({ where: { id: flowId }, data: { enabled: !flow.enabled } })

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: flow.enabled ? 'flow.disable' : 'flow.enable',
      resourceType: 'Flow',
      resourceId: flowId,
      diff: { name: flow.name },
    },
  })

  revalidatePath('/flows')
  revalidatePath(`/flows/${flowId}`)
}

/** Stops the engine from starting new runs without deleting anything. */
export async function archiveFlow(flowId: string) {
  const user = await requireRole('SUPERVISOR')
  const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { orgId: true } })
  if (!flow || flow.orgId !== user.orgId) return

  await prisma.flow.update({ where: { id: flowId }, data: { status: FlowStatus.ARCHIVED } })
  await prisma.trigger.updateMany({ where: { flowId }, data: { enabled: false } })
  revalidatePath('/flows')
}

export async function loadDraft(flowId: string): Promise<FlowGraph> {
  await requireUser()
  const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { draftGraph: true } })
  const parsed = flowGraphSchema.safeParse(flow?.draftGraph)
  return parsed.success ? parsed.data : EMPTY_GRAPH
}
