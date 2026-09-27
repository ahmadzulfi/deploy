'use server'

import { revalidatePath } from 'next/cache'
import { prisma, DeliveryStatus } from '@wa/db'
import { checkPublicUrl, encrypt, newWebhookSecret, PING_EVENT, WEBHOOK_EVENTS } from '@wa/core'
import { requireRole } from '@/lib/auth'

export type EndpointState = { error?: string; secret?: string }

/**
 * https only, so signed payloads never travel in the clear, and never to an
 * address inside our own network - the worker POSTs from in here, so a URL
 * naming the database or a metadata endpoint would reach it. Plain http is
 * let through for localhost during development, where a receiver is usually
 * a script on the same machine. The worker re-checks at send time.
 */
function checkUrl(raw: string): Promise<string | null> {
  return checkPublicUrl(raw, { allowLocalhost: process.env.NODE_ENV !== 'production' })
}

async function ownEndpoint(orgId: string, id: string) {
  const e = await prisma.webhookEndpoint.findUnique({ where: { id } })
  return e && e.orgId === orgId ? e : null
}

export async function createEndpoint(_prev: EndpointState, formData: FormData): Promise<EndpointState> {
  const user = await requireRole('ADMIN')

  const name = String(formData.get('name') ?? '').trim()
  const url = String(formData.get('url') ?? '').trim()
  const events = WEBHOOK_EVENTS.filter((e) => formData.get(`event:${e}`) === 'on')

  if (!name) return { error: 'Beri nama supaya nanti bisa dikenali.' }
  const bad = await checkUrl(url)
  if (bad) return { error: bad }
  if (events.length === 0) return { error: 'Pilih minimal satu event.' }

  const secret = newWebhookSecret()
  const endpoint = await prisma.webhookEndpoint.create({
    data: { orgId: user.orgId, name, url, events: [...events], secretEnc: encrypt(secret) },
  })

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'webhook.create',
      resourceType: 'WebhookEndpoint',
      resourceId: endpoint.id,
      diff: { name, url, events },
    },
  })

  revalidatePath('/settings')
  // Shown once. The receiver needs it to verify signatures; after this the
  // dashboard only keeps the ciphertext.
  return { secret }
}

export async function toggleEndpoint(id: string) {
  const user = await requireRole('ADMIN')
  const e = await ownEndpoint(user.orgId, id)
  if (!e) return
  await prisma.webhookEndpoint.update({ where: { id }, data: { active: !e.active } })
  revalidatePath('/settings')
}

export async function deleteEndpoint(id: string) {
  const user = await requireRole('ADMIN')
  const e = await ownEndpoint(user.orgId, id)
  if (!e) return
  await prisma.webhookEndpoint.delete({ where: { id } })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'webhook.delete',
      resourceType: 'WebhookEndpoint',
      resourceId: id,
      diff: { name: e.name, url: e.url },
    },
  })
  revalidatePath('/settings')
}

/** Queues a `ping` to this endpoint only, to check URL and signature. */
export async function pingEndpoint(id: string) {
  const user = await requireRole('ADMIN')
  const e = await ownEndpoint(user.orgId, id)
  if (!e) return
  await prisma.webhookDelivery.create({
    data: {
      endpointId: id,
      event: PING_EVENT,
      data: { message: 'Tes dari dashboard. Kalau tanda tangan cocok, endpoint siap.', endpoint: e.name },
    },
  })
  revalidatePath('/settings')
}

/** Puts a failed delivery back in the outbox with a fresh set of attempts. */
export async function retryDelivery(id: string) {
  const user = await requireRole('ADMIN')
  const d = await prisma.webhookDelivery.findUnique({ where: { id }, include: { endpoint: true } })
  if (!d || d.endpoint.orgId !== user.orgId) return
  await prisma.webhookDelivery.update({
    where: { id },
    data: { status: DeliveryStatus.PENDING, attempts: 0, nextAttemptAt: new Date(), error: null },
  })
  revalidatePath('/settings')
}
