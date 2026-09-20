import { Worker, type Job } from 'bullmq'
import { prisma, Prisma, Direction, MessageStatus, OptInStatus } from '@wa/db'
import {
  QUEUE,
  workerOptions,
  logger,
  normalizeCloudApiWebhook,
  windowExpiryFrom,
  type NormalizedEvent,
} from '@wa/core'

const log = logger.child({ worker: 'inbound' })

/** Replying with any of these opts the contact out of marketing sends. */
const OPT_OUT_KEYWORDS = new Set(['stop', 'berhenti', 'unsubscribe', 'keluar', 'batal langganan'])

export function startInboundWorker() {
  return new Worker(
    QUEUE.inbound,
    async (job: Job<{ webhookEventId: string }>) => {
      const event = await prisma.webhookEvent.findUnique({ where: { id: job.data.webhookEventId } })
      if (!event) {
        log.warn({ webhookEventId: job.data.webhookEventId }, 'webhook event vanished')
        return
      }
      if (event.processedAt) return // replayed job; already handled

      try {
        for (const e of normalizeCloudApiWebhook(event.rawPayload)) {
          await handleEvent(e)
        }
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), error: null },
        })
      } catch (err) {
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: { error: err instanceof Error ? err.message : String(err) },
        })
        throw err // let BullMQ retry with backoff
      }
    },
    workerOptions({ concurrency: 10 }),
  )
}

async function handleEvent(e: NormalizedEvent) {
  if (e.kind === 'account_update') {
    log.info({ event: e.event, wabaId: e.wabaId }, 'account update')
    return
  }

  if (!e.channelPhoneNumberId) return

  const channel = await prisma.channel.findUnique({ where: { phoneNumberId: e.channelPhoneNumberId } })
  if (!channel) {
    log.warn({ phoneNumberId: e.channelPhoneNumberId }, 'event for unregistered channel')
    return
  }

  if (e.kind === 'status') {
    await applyStatus(e)
    return
  }

  await ingestMessage(channel.id, channel.orgId, e)
}

async function applyStatus(e: Extract<NormalizedEvent, { kind: 'status' }>) {
  const status = {
    sent: MessageStatus.SENT,
    delivered: MessageStatus.DELIVERED,
    read: MessageStatus.READ,
    failed: MessageStatus.FAILED,
  }[e.status]

  const timestampField =
    e.status === 'sent'
      ? { sentAt: e.timestamp }
      : e.status === 'delivered'
        ? { deliveredAt: e.timestamp }
        : e.status === 'read'
          ? { readAt: e.timestamp }
          : {}

  try {
    await prisma.message.update({
      where: { waMessageId: e.waMessageId },
      data: {
        status,
        ...timestampField,
        ...(e.status === 'failed' ? { errorCode: e.errorCode, errorMessage: e.errorMessage } : {}),
      },
    })
  } catch (err) {
    // A status callback can beat our own INSERT for the outbound message, or
    // refer to something sent outside this system. Neither is worth a retry.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      log.debug({ waMessageId: e.waMessageId, status: e.status }, 'status for unknown message')
      return
    }
    throw err
  }
}

async function ingestMessage(channelId: string, orgId: string, e: Extract<NormalizedEvent, { kind: 'message' }>) {
  const contact = await prisma.contact.upsert({
    where: { orgId_waId: { orgId, waId: e.from } },
    create: {
      orgId,
      waId: e.from,
      name: e.profileName,
      lastSeenAt: e.timestamp,
      // An inbound message is the opt-in signal Meta's policy asks for.
      optInStatus: OptInStatus.OPTED_IN,
      optInSource: 'inbound_message',
      optInAt: e.timestamp,
    },
    update: {
      name: e.profileName ?? undefined,
      lastSeenAt: e.timestamp,
    },
  })

  const conversation = await prisma.conversation.upsert({
    where: { channelId_contactId: { channelId, contactId: contact.id } },
    create: {
      channelId,
      contactId: contact.id,
      lastMessageAt: e.timestamp,
      windowExpiresAt: windowExpiryFrom(e.timestamp),
      unreadCount: 1,
    },
    update: {
      lastMessageAt: e.timestamp,
      // Every inbound message restarts the 24h free-form window.
      windowExpiresAt: windowExpiryFrom(e.timestamp),
      unreadCount: { increment: 1 },
    },
  })

  try {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: Direction.IN,
        waMessageId: e.waMessageId,
        type: e.message.type,
        payload: e.message as unknown as Prisma.InputJsonValue,
        status: MessageStatus.DELIVERED,
        sentBy: 'contact',
        createdAt: e.timestamp,
      },
    })
  } catch (err) {
    // Unique violation on waMessageId means Meta redelivered a payload we have
    // already stored. That is the dedupe working, not a failure.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      log.debug({ waMessageId: e.waMessageId }, 'duplicate inbound message ignored')
      return
    }
    throw err
  }

  if (e.message.type === 'text') {
    await maybeOptOut(contact.id, e.message.body)
  }

  log.info(
    { channelId, from: e.from, type: e.message.type, conversationId: conversation.id },
    'inbound message stored',
  )

  // Fase 4: enqueue a flow tick here once the engine exists.
  // await flowQueue.add('tick', { conversationId: conversation.id, waMessageId: e.waMessageId })
}

async function maybeOptOut(contactId: string, body: string) {
  if (!OPT_OUT_KEYWORDS.has(body.trim().toLowerCase())) return
  await prisma.contact.update({
    where: { id: contactId },
    data: { optInStatus: OptInStatus.OPTED_OUT, optOutAt: new Date() },
  })
  log.info({ contactId }, 'contact opted out')
}
