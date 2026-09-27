import { DelayedError, Worker, UnrecoverableError, type Job } from 'bullmq'
import { prisma, Prisma, ChannelStatus, Direction, MessageStatus } from '@wa/db'
import {
  credentialsFor,
  emitEvent,
  isWindowOpen,
  logger,
  messageEventData,
  providerFor,
  ProviderError,
  recordRecipientOutcome,
  WhatsAppValidationError,
  RE_ENGAGEMENT_CODE,
  type OutboundMessage,
} from '@wa/core'
import {
  doneKey,
  enqueueSend,
  workerOptions,
  outboundQueueName,
  redis,
  ORDER_TTL_S,
  type SendJob,
} from '@wa/core/queues'

const log = logger.child({ worker: 'outbound' })

export { enqueueSend, type SendJob }

/**
 * Marks this message's turn as over, whether it was sent or permanently
 * failed. Skipping this on failure would stall every later message in the
 * conversation behind a ticket that never clears.
 */
async function releaseTurn(conversationId: string) {
  const key = doneKey(conversationId)
  await redis().incr(key)
  await redis().expire(key, ORDER_TTL_S)
}

/**
 * One worker per channel.
 *
 * Separate queues plus a per-channel rate limiter is what keeps a 50k campaign
 * on one number from delaying a live reply on another - a single shared queue
 * would serialize them behind each other no matter how the jobs are
 * prioritized.
 */
const workers = new Map<string, Worker>()

export async function startOutboundWorkers() {
  const channels = await prisma.channel.findMany({
    where: { status: ChannelStatus.CONNECTED },
    select: { id: true, name: true, throughputPerSec: true },
  })

  for (const c of channels) attachWorker(c.id, c.throughputPerSec)
  log.info({ count: channels.length }, 'outbound workers started')
  return [...workers.values()]
}

export function attachWorker(channelId: string, throughputPerSec: number) {
  if (workers.has(channelId)) return workers.get(channelId)!

  const worker = new Worker<SendJob>(
    outboundQueueName(channelId),
    processSend,
    workerOptions({ concurrency: 5, limiter: { max: throughputPerSec, duration: 1_000 } }),
  )

  worker.on('failed', (job, err) => {
    // A DelayedError is how a paused channel re-queues itself; BullMQ still
    // routes it through this event, and logging it as a failure would make
    // an idle kill switch look like an outage.
    if (err instanceof DelayedError || err?.name === 'DelayedError') return
    log.error({ channelId, jobId: job?.id, err: err.message }, 'send failed')
  })

  workers.set(channelId, worker)
  return worker
}

/** How long a job waits before re-checking a paused channel. */
const PAUSE_RECHECK_MS = 30_000

async function processSend(job: Job<SendJob>, token?: string) {
  const { channelId, conversationId, to, message, sentBy, sentByUserId, messageId } = job.data
  // Public API sends carry their own id; others fall back to the job id, as before.
  const requestId = job.data.requestId ?? job.id

  const channel = await prisma.channel.findUnique({ where: { id: channelId } })
  if (!channel) throw new UnrecoverableError(`channel ${channelId} no longer exists`)

  // Wait for this message's turn. Re-delaying costs no retry attempt, so a
  // long burst does not burn through the job's attempts while queueing.
  if (job.data.seq !== undefined) {
    const done = Number((await redis().get(doneKey(conversationId))) ?? 0)
    if (job.data.seq > done + 1) {
      await job.moveToDelayed(Date.now() + 150, token)
      throw new DelayedError()
    }
  }

  if (channel.sendingPaused) {
    // Kill switch or circuit breaker. Re-delay instead of throwing: a thrown
    // error consumes a retry attempt, and five of those expire in about half
    // a minute - a channel paused any longer than that would silently drop
    // every message queued behind it. moveToDelayed costs no attempt.
    log.debug({ channelId, jobId: job.id }, 'channel dijeda, job ditunda')
    await job.moveToDelayed(Date.now() + PAUSE_RECHECK_MS, token)
    throw new DelayedError()
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  })
  if (!conversation) {
    await releaseTurn(conversationId)
    throw new UnrecoverableError(`conversation ${conversationId} no longer exists`)
  }
  const eventScope = { id: conversationId, channel, contact: conversation.contact }

  /** Records a failed attempt and, once it is the last one, announces it. */
  const fail = async (err: unknown, final: boolean) => {
    const row = await recordFailure({ conversationId, message, sentBy, sentByUserId, messageId, final }, err)
    if (final) {
      await releaseTurn(conversationId)
      await recordRecipientOutcome(row)
      await emitEvent(channel.orgId, 'message.failed', messageEventData(row, eventScope, { requestId }))
    }
  }

  // Free-form sends are only legal inside the 24h window. Checking here rather
  // than letting Meta reject it saves a wasted API call and gives the caller a
  // message that actually says what to do instead.
  if (message.kind !== 'template' && !isWindowOpen(conversation.windowExpiresAt)) {
    // Recorded and released like any other permanent failure: dropping the
    // job silently would leave every later message in this conversation
    // waiting on a turn that never ends.
    await fail(new ProviderError('Window 24 jam tertutup; kirim template yang disetujui.', 'WINDOW_CLOSED'), true)
    throw new UnrecoverableError(
      `24h window closed for conversation ${conversationId}; send an approved template instead`,
    )
  }

  const provider = providerFor(channel)
  const creds = credentialsFor(channel)

  let result
  try {
    result = await provider.send(creds, to, message)
  } catch (err) {
    const terminal =
      err instanceof WhatsAppValidationError ||
      (err instanceof ProviderError && !err.retryable)

    // A retryable error on the last attempt is just as final to the caller.
    await fail(err, terminal || job.attemptsMade + 1 >= (job.opts.attempts ?? 1))

    if (err instanceof WhatsAppValidationError) {
      throw new UnrecoverableError(`invalid payload: ${err.message}`)
    }
    if (err instanceof ProviderError) {
      if (err.code === String(RE_ENGAGEMENT_CODE)) {
        throw new UnrecoverableError('Meta rejected the send: 24h window closed, a template is required')
      }
      if (!err.retryable) throw new UnrecoverableError(`${err.code ?? 'error'}: ${err.message}`)
    }
    throw err
  }

  const sent = messageId
    ? await prisma.message.update({
        where: { id: messageId },
        // Clears the error an earlier, retried attempt may have left behind.
        data: { waMessageId: result.waMessageId, status: MessageStatus.SENT, sentAt: new Date(), errorCode: null, errorMessage: null },
      })
    : await prisma.message.create({
        data: {
          conversationId,
          direction: Direction.OUT,
          waMessageId: result.waMessageId,
          type: message.kind,
          payload: message as unknown as Prisma.InputJsonValue,
          status: MessageStatus.SENT,
          sentBy,
          sentByUserId,
          sentAt: new Date(),
        },
      })

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  })

  await releaseTurn(conversationId)
  await recordRecipientOutcome(sent)

  // requestId is the job id the public API handed back, so a caller can match
  // this event to the request that caused it.
  await emitEvent(channel.orgId, 'message.sent', messageEventData(sent, eventScope, { requestId }))

  log.info({ channelId, to, kind: message.kind, waMessageId: result.waMessageId }, 'message sent')
  return result
}

async function recordFailure(
  s: {
    conversationId: string
    message: OutboundMessage
    sentBy: string
    sentByUserId: string | undefined
    /** Pre-created row to update, for sends that have one. */
    messageId: string | undefined
    /** False while BullMQ will still retry. */
    final: boolean
  },
  err: unknown,
) {
  const error = {
    errorCode: err instanceof ProviderError ? err.code : 'INTERNAL',
    errorMessage: err instanceof Error ? err.message : String(err),
  }

  if (s.messageId) {
    // One row per request: a retry still pending leaves it QUEUED with the
    // latest error attached, so a status lookup never reports "failed" for
    // a message that may yet go out.
    return prisma.message.update({
      where: { id: s.messageId },
      data: { status: s.final ? MessageStatus.FAILED : MessageStatus.QUEUED, ...error },
    })
  }

  return prisma.message.create({
    data: {
      conversationId: s.conversationId,
      direction: Direction.OUT,
      type: s.message.kind,
      payload: s.message as unknown as Prisma.InputJsonValue,
      status: MessageStatus.FAILED,
      ...error,
      sentBy: s.sentBy,
      sentByUserId: s.sentByUserId,
    },
  })
}
