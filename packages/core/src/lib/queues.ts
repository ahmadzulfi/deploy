import { Queue, type QueueOptions, type WorkerOptions } from 'bullmq'
import IORedis from 'ioredis'

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

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()))
  queues.clear()
  if (_redis) {
    await _redis.quit()
    _redis = null
  }
}
