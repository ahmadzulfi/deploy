import { Queue, type QueueOptions, type WorkerOptions } from 'bullmq'
import IORedis from 'ioredis'
import type { OutboundMessage } from '../providers/types.js'

/**
 * Redis key namespace. BullMQ rejects ':' inside a queue *name* and inside a
 * custom job id, because it builds its own keys with it - namespacing belongs
 * here instead, and every Worker must be constructed with the same prefix or
 * it watches a different set of keys than the Queue writes to.
 */
export const QUEUE_PREFIX = 'wa'

let _redis: IORedis | null = null

/**
 * Opened on first use, never at import time.
 *
 * This module is reachable from the package barrel, so eager construction
 * would open a socket in every CLI script that imports anything from @wa/core
 * and keep the event loop alive forever - the process would simply never exit.
 */
export function redis(): IORedis {
  if (!_redis) {
    _redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6381', {
      maxRetriesPerRequest: null, // required by BullMQ workers
    })
  }
  return _redis
}

function queueOptions(): QueueOptions {
  return {
    connection: redis(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 3_600, count: 5_000 },
      removeOnFail: { age: 7 * 24 * 3_600 },
    },
  }
}

/** Worker options carrying the same connection and prefix as the queues. */
export function workerOptions(extra: Partial<WorkerOptions> = {}): WorkerOptions {
  return { connection: redis(), prefix: QUEUE_PREFIX, ...extra }
}

export const QUEUE = {
  /** Raw Meta webhook payloads, parsed and persisted off the request path. */
  inbound: 'inbound',
  /** Flow engine ticks. */
  flow: 'flow',
  /** Campaign fan-out into per-recipient send jobs. */
  campaign: 'campaign',
} as const

const queues = new Map<string, Queue>()

function getQueue(name: string): Queue {
  let q = queues.get(name)
  if (!q) {
    q = new Queue(name, queueOptions())
    queues.set(name, q)
  }
  return q
}

export const inboundQueue = () => getQueue(QUEUE.inbound)
export const flowQueue = () => getQueue(QUEUE.flow)
export const campaignQueue = () => getQueue(QUEUE.campaign)

/**
 * Outbound sends get one queue per channel so a 50k blast on one number cannot
 * starve replies on another. The rate limiter is applied worker-side from the
 * channel's own throughputPerSec.
 */
export function outboundQueueName(channelId: string) {
  return `outbound-${channelId}`
}

export function outboundQueue(channelId: string): Queue {
  return getQueue(outboundQueueName(channelId))
}

export interface SendJob {
  channelId: string
  conversationId: string
  /** Position in this conversation's outbound order; see enqueueSend. */
  seq?: number
  to: string
  message: OutboundMessage
  /** "user:<id>" | "flow:<id>" | "campaign:<id>" | "api:<keyId>" | "system" */
  sentBy: string
  sentByUserId?: string
  /**
   * A Message row created before enqueueing, which the worker updates in
   * place instead of creating its own. Set by the public API so a request
   * has one row whose status can be looked up from the moment it is queued.
   */
  messageId?: string
  /** The public API's id for this send, echoed on message.sent / message.failed. */
  requestId?: string
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
export const seqKey = (conversationId: string) => `wa:seq:${conversationId}`
export const doneKey = (conversationId: string) => `wa:done:${conversationId}`

/** Conversations go quiet; the counters should not outlive them. */
export const ORDER_TTL_S = 7 * 24 * 3600

/**
 * Queues an outbound message on its channel's own lane, in order.
 *
 * Lives here rather than in the worker because the public API enqueues too,
 * and both must take tickets from the same counter.
 */
export async function enqueueSend(job: SendJob) {
  const key = seqKey(job.conversationId)
  const seq = await redis().incr(key)
  await redis().expire(key, ORDER_TTL_S)

  return outboundQueue(job.channelId).add('send', { ...job, seq })
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()))
  queues.clear()
  if (_redis) {
    await _redis.quit()
    _redis = null
  }
}
