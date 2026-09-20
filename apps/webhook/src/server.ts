import Fastify, { type FastifyRequest } from 'fastify'
import { prisma } from '@wa/db'
import {
  env,
  logger,
  inboundQueue,
  metaSettings,
  verifyMetaSignature,
  normalizeCloudApiWebhook,
} from '@wa/core'

/**
 * Webhook receiver. Deliberately the dumbest service in the system.
 *
 * Meta retries on anything slow or non-2xx and will disable the subscription
 * after repeated failures, so this process does four things and nothing else:
 * verify the signature, persist the raw payload, enqueue, return 200. Every
 * decision about what the payload *means* happens in the worker.
 */

const app = Fastify({
  // Fastify 5: `logger` takes a config object, `loggerInstance` takes an
  // already-constructed pino - we want ours, with its redaction rules.
  loggerInstance: logger,
  bodyLimit: 5 * 1024 * 1024,
})

// Signature verification needs the exact bytes Meta sent, so keep the raw
// buffer alongside the parsed body instead of re-serializing later.
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer
  }
}

app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req: FastifyRequest, body, done) => {
  req.rawBody = body as Buffer
  try {
    done(null, body.length ? JSON.parse(body.toString('utf8')) : {})
  } catch (err) {
    done(err as Error, undefined)
  }
})

app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }))

/** Meta's subscription handshake. Called once when you save the webhook URL. */
app.get('/webhooks/whatsapp', async (req, reply) => {
  const q = req.query as Record<string, string | undefined>
  const { verifyToken } = await metaSettings()

  if (q['hub.mode'] === 'subscribe' && verifyToken && q['hub.verify_token'] === verifyToken) {
    app.log.info('webhook verification handshake succeeded')
    return reply.code(200).type('text/plain').send(q['hub.challenge'] ?? '')
  }
  app.log.warn({ mode: q['hub.mode'] }, 'webhook verification handshake rejected')
  return reply.code(403).send()
})

app.post('/webhooks/whatsapp', async (req, reply) => {
  const { appSecret } = await metaSettings()

  if (!appSecret) {
    // Refusing beats accepting unverified payloads: without a secret every
    // request would be indistinguishable from a forged one.
    app.log.error('META app secret belum diatur - webhook ditolak')
    return reply.code(503).send()
  }

  const signatureOk = verifyMetaSignature(
    req.rawBody ?? Buffer.alloc(0),
    req.headers['x-hub-signature-256'] as string | undefined,
    appSecret,
  )

  if (!signatureOk) {
    // 401, not 200: an unsigned payload is either a misconfigured app secret or
    // someone probing the endpoint, and neither should look like success.
    app.log.warn({ ip: req.ip }, 'rejected webhook with bad signature')
    return reply.code(401).send()
  }

  const payload = req.body as unknown
  const events = normalizeCloudApiWebhook(payload)

  // A single POST can carry traffic for several numbers, so resolve the channel
  // per event rather than per request.
  const phoneNumberIds = [
    ...new Set(events.map((e) => e.channelPhoneNumberId).filter((v): v is string => !!v)),
  ]

  const channels = phoneNumberIds.length
    ? await prisma.channel.findMany({
        where: { phoneNumberId: { in: phoneNumberIds } },
        select: { id: true, phoneNumberId: true },
      })
    : []

  const channelByPhone = new Map(channels.map((c) => [c.phoneNumberId!, c.id]))

  const unknown = phoneNumberIds.filter((p) => !channelByPhone.has(p))
  if (unknown.length) {
    // Recorded rather than dropped: this is what an unregistered number or a
    // stale Meta subscription looks like, and it should be findable later.
    app.log.warn({ phoneNumberIds: unknown }, 'webhook for unregistered phone_number_id')
  }

  const event = await prisma.webhookEvent.create({
    data: {
      channelId: channelByPhone.get(phoneNumberIds[0] ?? '') ?? null,
      rawPayload: payload as object,
      signatureOk: true,
    },
    select: { id: true },
  })

  await inboundQueue().add(
    'process',
    { webhookEventId: event.id },
    // Meta can deliver the same payload twice; the worker also dedupes on
    // waMessageId, but collapsing here saves the round trip.
    { jobId: `webhook-${event.id}` },
  )

  return reply.code(200).send()
})

async function main() {
  env() // fail fast on missing config
  await app.listen({ port: env().WEBHOOK_PORT, host: '0.0.0.0' })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    await prisma.$disconnect()
    process.exit(0)
  })
}

main().catch((err) => {
  logger.fatal(err, 'webhook service failed to start')
  process.exit(1)
})
