import { isIP } from 'node:net'
import { Agent, fetch } from 'undici'
import { prisma, DeliveryStatus } from '@wa/db'
import { decrypt, isLocalhostUrl, isPrivateAddress, logger, publicOnlyLookup, signWebhook, webhookEnvelope } from '@wa/core'

const log = logger.child({ worker: 'webhooks' })

/** How often the outbox is checked for due deliveries. */
const POLL_MS = 2_000
const BATCH = 20

/** A receiver slower than this counts as down. */
const TIMEOUT_MS = 10_000

/**
 * Wait before each retry. Seven attempts spread over about eight hours rides
 * out a receiver's deploy or a short outage without hammering it.
 */
const BACKOFF_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000]
const MAX_ATTEMPTS = BACKOFF_MS.length + 1

/** How long a claimed row stays invisible to other workers. */
const LEASE_MS = 60_000

/** Delivered rows are only kept for looking back at recent traffic. */
const KEEP_SUCCEEDED_MS = 7 * 24 * 3600_000
const KEEP_FAILED_MS = 30 * 24 * 3600_000

/**
 * Every delivery connects through a resolver that refuses private addresses,
 * so the address that passed the check is the one dialled - DNS cannot swap
 * in an internal one between the check and the connection.
 */
const publicAgent = new Agent({ connect: { lookup: publicOnlyLookup as never } })

/**
 * Why a URL may not be delivered to, or null if it may. The form checks this
 * too, but endpoints saved before that check existed are caught here, and an
 * IP literal never goes through the resolver above at all.
 */
function refuseTarget(url: URL): string | null {
  // Development only, like the form: a receiver script on this machine.
  if (process.env.NODE_ENV !== 'production' && isLocalhostUrl(url)) return null
  if (url.protocol !== 'https:') return 'URL harus https'
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && isPrivateAddress(host)) return `${host} adalah alamat jaringan internal`
  return null
}

export async function drainOutbox(now = new Date()) {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: DeliveryStatus.PENDING, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: BATCH,
    select: { id: true, nextAttemptAt: true },
  })

  await Promise.all(
    due.map(async (row) => {
      // Claim by moving the row's clock forward, conditional on it not having
      // moved already. Whoever wins the update sends; everyone else skips.
      const { count } = await prisma.webhookDelivery.updateMany({
        where: { id: row.id, status: DeliveryStatus.PENDING, nextAttemptAt: row.nextAttemptAt },
        data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
      })
      if (count === 1) await deliver(row.id)
    }),
  )

  return due.length
}

/** Sends one delivery now. Also used by "Kirim ulang" via the outbox. */
async function deliver(id: string) {
  const d = await prisma.webhookDelivery.findUnique({ where: { id }, include: { endpoint: true } })
  if (!d) return

  // Deactivated after the event was queued: drop it rather than surprise
  // whoever turned the endpoint off.
  if (!d.endpoint.active) {
    await prisma.webhookDelivery.update({
      where: { id },
      data: { status: DeliveryStatus.FAILED, error: 'endpoint dinonaktifkan' },
    })
    return
  }

  const body = webhookEnvelope({ id: d.id, event: d.event, data: d.data, createdAt: d.createdAt })
  const timestamp = Math.floor(Date.now() / 1000)
  const attempts = d.attempts + 1

  let status: number | undefined
  let error: string | undefined
  const target = new URL(d.endpoint.url)
  const refused = refuseTarget(target)
  try {
    if (refused) throw Object.assign(new Error(refused), { cause: { code: 'EPRIVATEADDR', message: refused } })
    const res = await fetch(target, {
      dispatcher: isLocalhostUrl(target) && process.env.NODE_ENV !== 'production' ? undefined : publicAgent,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'wa-platform-webhooks/1',
        'X-WA-Event': d.event,
        'X-WA-Delivery': d.id,
        'X-WA-Timestamp': String(timestamp),
        'X-WA-Signature': signWebhook(decrypt(d.endpoint.secretEnc), timestamp, body),
      },
      body,
      // A redirect could point anywhere, including inside our own network;
      // the configured URL is the only place a signed payload may go.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    status = res.status
    if (!res.ok) error = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`
  } catch (err) {
    // fetch reports every network failure as "fetch failed"; the useful part
    // (ECONNREFUSED, ENOTFOUND, a TLS error) sits on the cause.
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause
    error =
      err instanceof Error && err.name === 'TimeoutError'
        ? `timeout ${TIMEOUT_MS / 1000} detik`
        : cause
          ? `${cause.code ?? ''} ${cause.message ?? ''}`.trim()
          : err instanceof Error
            ? err.message
            : String(err)
  }

  const now = new Date()

  if (!error) {
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id },
        data: { status: DeliveryStatus.SUCCEEDED, attempts, responseStatus: status, error: null, deliveredAt: now },
      }),
      prisma.webhookEndpoint.update({ where: { id: d.endpointId }, data: { lastSuccessAt: now } }),
    ])
    return
  }

  const giveUp = attempts >= MAX_ATTEMPTS
  await prisma.$transaction([
    prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: giveUp ? DeliveryStatus.FAILED : DeliveryStatus.PENDING,
        attempts,
        responseStatus: status ?? null,
        error,
        nextAttemptAt: giveUp ? now : new Date(now.getTime() + BACKOFF_MS[attempts - 1]!),
      },
    }),
    prisma.webhookEndpoint.update({
      where: { id: d.endpointId },
      data: { lastFailureAt: now, lastError: error },
    }),
  ])
  log.warn({ deliveryId: id, endpointId: d.endpointId, attempts, giveUp, error }, 'webhook keluar gagal')
}

async function prune(now = new Date()) {
  await prisma.webhookDelivery.deleteMany({
    where: {
      OR: [
        { status: DeliveryStatus.SUCCEEDED, createdAt: { lt: new Date(now.getTime() - KEEP_SUCCEEDED_MS) } },
        { status: DeliveryStatus.FAILED, createdAt: { lt: new Date(now.getTime() - KEEP_FAILED_MS) } },
      ],
    },
  })
}

/** Polls the outbox until `stop()`. */
export function startWebhookDispatcher() {
  let running = false
  let stopped = false

  // Skips a beat instead of overlapping: a slow receiver must not stack up
  // concurrent drains that each claim and send the same backlog.
  const tick = async () => {
    if (running || stopped) return
    running = true
    try {
      await drainOutbox()
    } catch (err) {
      log.error(err, 'drain outbox gagal')
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), POLL_MS)
  const pruneTimer = setInterval(() => void prune().catch((err) => log.error(err, 'prune gagal')), 3600_000)
  timer.unref()
  pruneTimer.unref()
  void tick()

  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
      clearInterval(pruneTimer)
    },
  }
}
