import { DelayedError, Worker, UnrecoverableError, type Job } from 'bullmq'
import { prisma, Prisma, ChannelStatus, Direction, MessageStatus } from '@wa/db'
import {
  credentialsFor,
  isWindowOpen,
  logger,
  providerFor,
  ProviderError,
  WhatsAppValidationError,
  RE_ENGAGEMENT_CODE,
  type OutboundMessage,
} from '@wa/core'
import { workerOptions, outboundQueue, outboundQueueName, redis } from '@wa/core/queues'

const log = logger.child({ worker: 'outbound' })

export interface SendJob {
  channelId: string
  conversationId: string
  /** Position in this conversation's outbound order; see enqueueSend. */
  seq?: number
  to: string
  message: OutboundMessage
  /** "user:<id>" | "flow:<id>" | "campaign:<id>" | "system" */
  sentBy: string
  sentByUserId?: string
}

/**
 * Keys that order one conversation's outbound messages.
 *
 * The worker runs several jobs at once so a broadcast is not bottlenecked on
 * round-trip latency, but that lets two messages for the same contact race -
 * and a flow that sends an answer then a follow-up prompt would arrive
 * backwards. Each message takes a ticket on enqueue and waits its turn on the
 * way out; conversations still run fully in parallel with each other.
 */
const seqKey = (conversationId: string) => `wa:seq:${conversationId}`
const doneKey = (conversationId: string) => `wa:done:${conversationId}`

/** Conversations go quiet; the counters should not outlive them. */
const ORDER_TTL_S = 7 * 24 * 3600

/** Queues an outbound message on its channel's own lane, in order. */
export async function enqueueSend(job: SendJob) {
  const key = seqKey(job.conversationId)
  const seq = await redis().incr(key)
  await redis().expire(key, ORDER_TTL_S)

  return outboundQueue(job.channelId).add('send', { ...job, seq })
}

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
  const { channelId, conversationId, to, message, sentBy, sentByUserId } = job.data

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

  // Free-form sends are only legal inside the 24h window. Checking here rather
  // than letting Meta reject it saves a wasted API call and gives the caller a
  // message that actually says what to do instead.
  if (message.kind !== 'template') {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { windowExpiresAt: true },
    })
    if (!isWindowOpen(conversation?.windowExpiresAt)) {
      throw new UnrecoverableError(
        `24h window closed for conversation ${conversationId}; send an approved template instead`,
      )
    }
  }

  const provider = providerFor(channel)
  const creds = credentialsFor(channel)

  let result
  try {
    result = await provider.send(creds, to, message)
  } catch (err) {
    await recordFailure(conversationId, message, sentBy, sentByUserId, err)

    const terminal =
      err instanceof WhatsAppValidationError ||
      (err instanceof ProviderError && !err.retryable)

    if (terminal) await releaseTurn(conversationId)

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

  await prisma.message.create({
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

  log.info({ channelId, to, kind: message.kind, waMessageId: result.waMessageId }, 'message sent')
  return result
}

async function recordFailure(
  conversationId: string,
  message: OutboundMessage,
  sentBy: string,
  sentByUserId: string | undefined,
  err: unknown,
) {
  const isProviderErr = err instanceof ProviderError
  await prisma.message.create({
    data: {
      conversationId,
      direction: Direction.OUT,
      type: message.kind,
      payload: message as unknown as Prisma.InputJsonValue,
      status: MessageStatus.FAILED,
      errorCode: isProviderErr ? err.code : 'INTERNAL',
      errorMessage: err instanceof Error ? err.message : String(err),
      sentBy,
      sentByUserId,
    },
  })
}
