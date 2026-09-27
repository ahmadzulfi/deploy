import { createHmac, randomBytes } from 'node:crypto'
import { prisma, Prisma } from '@wa/db'
import { logger } from './logger.js'

const log = logger.child({ module: 'events' })

/**
 * Every event an outgoing webhook can subscribe to.
 *
 * `message.sent` means Meta accepted the send; `delivered` and `read` follow
 * from Meta's own status callbacks. `failed` covers both a send Meta refused
 * outright and one it accepted and later reported as undeliverable.
 */
export const WEBHOOK_EVENTS = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'flow.completed',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

/** Sent only by the dashboard's test button, to one endpoint. */
export const PING_EVENT = 'ping'

/**
 * Records an event for every endpoint that subscribes to it.
 *
 * Never throws: an outgoing webhook is a side channel, and a database hiccup
 * here must not fail the inbound message or the send that raised it.
 */
export async function emitEvent(orgId: string, event: WebhookEvent, data: Record<string, unknown>) {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { orgId, active: true, events: { has: event } },
      select: { id: true },
    })
    if (endpoints.length === 0) return

    await prisma.webhookDelivery.createMany({
      data: endpoints.map((e) => ({ endpointId: e.id, event, data: data as Prisma.InputJsonValue })),
    })
  } catch (err) {
    log.error({ orgId, event, err: err instanceof Error ? err.message : String(err) }, 'emit event gagal')
  }
}

/**
 * The `data` of every message.* event, in one shape so a receiver can handle
 * received, sent and status events with the same code.
 */
export function messageEventData(
  m: {
    id: string
    waMessageId: string | null
    direction: string
    type: string
    payload: unknown
    status: string
    sentBy: string | null
    errorCode?: string | null
    errorMessage?: string | null
    createdAt: Date
  },
  c: {
    id: string
    channel: { id: string; name: string; displayPhone: string | null }
    contact: { waId: string; name: string | null }
  },
  extra: Record<string, unknown> = {},
) {
  return {
    messageId: m.id,
    waMessageId: m.waMessageId,
    conversationId: c.id,
    direction: m.direction === 'IN' ? 'inbound' : 'outbound',
    type: m.type,
    content: m.payload,
    status: m.status.toLowerCase(),
    sentBy: m.sentBy,
    ...(m.errorMessage ? { error: { code: m.errorCode ?? null, message: m.errorMessage } } : {}),
    channel: { id: c.channel.id, name: c.channel.name, phone: c.channel.displayPhone },
    contact: { waId: c.contact.waId, name: c.contact.name },
    timestamp: m.createdAt.toISOString(),
    ...extra,
  }
}

export function newWebhookSecret() {
  return `whsec_${randomBytes(24).toString('base64url')}`
}

/**
 * `sha256=<hex>` of `<timestamp>.<body>`.
 *
 * The timestamp is inside the signed string so a captured request cannot be
 * replayed later with a fresh timestamp header.
 */
export function signWebhook(secret: string, timestamp: number, body: string) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

/** The JSON body a receiver gets. */
export function webhookEnvelope(d: { id: string; event: string; data: unknown; createdAt: Date }) {
  return JSON.stringify({ id: d.id, event: d.event, createdAt: d.createdAt.toISOString(), data: d.data })
}
