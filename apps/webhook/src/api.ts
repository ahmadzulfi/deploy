import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { prisma, ChannelStatus, Direction, MessageStatus, OptInStatus, SessionStatus, type Prisma } from '@wa/db'
import {
  authenticateApiKey,
  buildTemplateComponents,
  canUseChannel,
  credentialsFor,
  flowGraphSchema,
  isWindowOpen,
  mediaKindOf,
  messageEventData,
  nextNodeId,
  providerFor,
  ProviderError,
  renderTemplate,
  templateSlots,
  WA_MEDIA,
  type ApiPrincipal,
  type ApiScope,
  type OutboundMessage,
} from '@wa/core'
import { enqueueSend, flowQueue, redis } from '@wa/core/queues'
import { freeFormMessage, sendSchema, waIdSchema } from './message-input.js'

/**
 * Public REST API, v1.
 *
 * Mounted on the webhook service because that is the process already exposed
 * to the internet. Everything here is thin: sends go through the same
 * per-conversation outbound queue the flow engine uses, so an API message can
 * never overtake or interleave with a bot reply.
 */

declare module 'fastify' {
  interface FastifyRequest {
    principal?: ApiPrincipal
  }
}

class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Per-key request budget: a fixed one-minute window counted in Redis.
 *
 * In Redis rather than process memory so the count survives a restart and
 * holds across every webhook instance, not per instance.
 */
const RATE_LIMIT = 120
const RATE_WINDOW_MS = 60_000

async function rateLimit(keyId: string, reply: FastifyReply) {
  const now = Date.now()
  const windowStart = now - (now % RATE_WINDOW_MS)
  const key = `wa:rl:${keyId}:${windowStart}`

  let count: number
  try {
    count = await redis().incr(key)
    if (count === 1) await redis().pexpire(key, RATE_WINDOW_MS)
  } catch (err) {
    // A Redis outage should not take the whole API down with it; sends fail
    // on their own anyway without a queue. Let the request through, loudly.
    reply.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'rate limit tidak bisa dicek; request dilewatkan')
    return
  }

  reply.header('X-RateLimit-Limit', RATE_LIMIT)
  reply.header('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT - count))
  if (count > RATE_LIMIT) {
    reply.header('Retry-After', Math.ceil((windowStart + RATE_WINDOW_MS - now) / 1000))
    throw new ApiError(429, 'rate_limited', `Maksimum ${RATE_LIMIT} request per menit per API key.`)
  }
}

function need(req: FastifyRequest, scope: ApiScope): ApiPrincipal {
  const p = req.principal!
  if (!p.scopes.includes(scope)) throw new ApiError(403, 'missing_scope', `API key ini tidak punya izin ${scope}.`)
  return p
}

/**
 * Prisma filter for the channels this key may touch. `undefined` for an
 * unrestricted key, so it can be spread into a where clause unconditionally.
 */
function channelFilter(p: ApiPrincipal) {
  return p.channelIds.length ? { in: p.channelIds } : undefined
}

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown, what = 'body'): z.output<S> {
  const r = schema.safeParse(input ?? {})
  if (!r.success) {
    const i = r.error.issues[0]!
    throw new ApiError(400, 'invalid_request', `${i.path.join('.') || what}: ${i.message}`)
  }
  return r.data
}

async function resolveChannel(p: ApiPrincipal, channelId: string | undefined) {
  if (channelId) {
    const c = await prisma.channel.findFirst({ where: { id: channelId, orgId: p.orgId } })
    if (!c) throw new ApiError(404, 'channel_not_found', 'Channel tidak ditemukan.')
    if (!canUseChannel(p, c.id)) {
      throw new ApiError(403, 'channel_forbidden', `API key ini tidak diizinkan memakai nomor ${c.name}.`)
    }
    return c
  }
  // Optional only while it cannot be ambiguous - among the numbers this key may use.
  const all = await prisma.channel.findMany({
    where: { orgId: p.orgId, status: ChannelStatus.CONNECTED, id: channelFilter(p) },
    take: 2,
  })
  if (all.length === 1) return all[0]!
  throw new ApiError(
    400,
    'channel_required',
    all.length ? 'Ada lebih dari satu nomor yang bisa dipakai key ini; sebutkan channelId.' : 'Belum ada nomor terhubung yang boleh dipakai key ini.',
  )
}

/** Finds or creates the contact and its conversation on this channel. */
async function conversationFor(orgId: string, channelId: string, waId: string, name?: string) {
  const contact = await prisma.contact.upsert({
    where: { orgId_waId: { orgId, waId } },
    create: { orgId, waId, name },
    update: name ? { name } : {},
  })
  const conversation = await prisma.conversation.upsert({
    where: { channelId_contactId: { channelId, contactId: contact.id } },
    create: { channelId, contactId: contact.id },
    update: {},
  })
  return { contact, conversation }
}

const contactSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  /** Replaces the tag list when given. */
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  /** Shallow-merged into the existing attributes; null deletes a key. */
  attributes: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})

const triggerSchema = z.object({
  channelId: z.string().optional(),
  to: waIdSchema,
  name: z.string().trim().min(1).max(200).optional(),
  /** Seeded into the session; the flow reads them as {{nama}}. */
  variables: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Ends a session already running for this contact instead of refusing. */
  force: z.boolean().default(false),
})

function contactView(c: {
  waId: string
  name: string | null
  tags: string[]
  attributes: Prisma.JsonValue
  optInStatus: string
  lastSeenAt: Date | null
  createdAt: Date
}) {
  return {
    waId: c.waId,
    name: c.name,
    tags: c.tags,
    attributes: c.attributes,
    optInStatus: c.optInStatus.toLowerCase(),
    lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  }
}

export async function apiRoutes(app: FastifyInstance) {
  app.decorateRequest('principal', undefined)

  app.addHook('onRequest', async (req, reply) => {
    const header = req.headers.authorization
    const plain = header?.startsWith('Bearer ') ? header.slice(7).trim() : (req.headers['x-api-key'] as string | undefined)
    if (!plain) throw new ApiError(401, 'unauthorized', 'Sertakan header Authorization: Bearer <api key>.')

    const principal = await authenticateApiKey(plain)
    if (!principal) throw new ApiError(401, 'unauthorized', 'API key tidak dikenal atau sudah dicabut.')

    req.principal = principal
    await rateLimit(principal.keyId, reply)
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } })
    }
    // Thrown by the JSON body parser, which carries no status of its own.
    if (err instanceof SyntaxError) {
      return reply.code(400).send({ error: { code: 'invalid_json', message: 'Body bukan JSON yang valid.' } })
    }
    // Fastify's own errors: wrong content type, body too large.
    const status = (err as { statusCode?: number }).statusCode
    if (status && status < 500) {
      return reply.code(status).send({ error: { code: 'invalid_request', message: (err as Error).message } })
    }
    req.log.error(err, 'api error')
    return reply.code(500).send({ error: { code: 'internal', message: 'Terjadi kesalahan di server.' } })
  })

  app.get('/channels', async (req) => {
    const p = req.principal!
    const rows = await prisma.channel.findMany({
      // A key limited to some numbers only learns that those exist.
      where: { orgId: p.orgId, id: channelFilter(p) },
      orderBy: { createdAt: 'asc' },
    })
    return {
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.displayPhone,
        status: c.status.toLowerCase(),
        sendingPaused: c.sendingPaused,
      })),
    }
  })

  app.post('/messages', async (req, reply) => {
    const p = need(req, 'messages:send')
    const { orgId, keyId } = p
    const body = parse(sendSchema, req.body)
    const channel = await resolveChannel(p, body.channelId)
    const { contact, conversation } = await conversationFor(orgId, channel.id, body.to, body.name)

    let message: OutboundMessage
    let preview: ReturnType<typeof renderTemplate> | undefined
    if (!body.template) {
      // Text and media are free-form: checked here so the caller gets a real
      // error instead of a queued request that can only ever fail.
      if (!isWindowOpen(conversation.windowExpiresAt)) {
        throw new ApiError(
          422,
          'window_closed',
          'Window 24 jam untuk kontak ini tertutup (atau belum pernah terbuka). Kirim template.',
        )
      }
      message = freeFormMessage(body)
    } else {
      const t = body.template!
      const template = await prisma.template.findUnique({
        where: { wabaId_name_language: { wabaId: channel.wabaId ?? '', name: t.name, language: t.language } },
      })
      if (!template) {
        throw new ApiError(
          404,
          'template_not_found',
          `Template ${t.name} (${t.language}) tidak ada di WABA nomor ini. Sinkronkan dulu dari dashboard.`,
        )
      }
      if (template.metaStatus !== 'APPROVED') {
        throw new ApiError(422, 'template_not_approved', `Template berstatus ${template.metaStatus}.`)
      }
      if (template.category === 'MARKETING' && contact.optInStatus === OptInStatus.OPTED_OUT) {
        throw new ApiError(422, 'contact_opted_out', 'Kontak ini sudah berhenti berlangganan pesan marketing.')
      }
      const missing = templateSlots(template.components).filter((s) => !t.params[s.key]?.trim())
      if (missing.length) {
        throw new ApiError(
          400,
          'missing_params',
          `Isian template belum lengkap: ${missing.map((s) => s.key).join(', ')}.`,
        )
      }
      message = {
        kind: 'template' as const,
        name: template.name,
        language: template.language,
        components: buildTemplateComponents(template.components, t.params),
      }
      // Display only, like inbox sends: the inbox shows the filled-in text.
      preview = renderTemplate(template.components, t.params)
    }

    // Our own id rather than the BullMQ job id: job ids count per queue, and
    // every channel has its own queue, so two channels hand out the same ones.
    const requestId = `req_${randomBytes(16).toString('base64url')}`
    const sentBy = `api:${keyId}`

    // The row exists before the job does, so GET /messages/:requestId can
    // answer "queued" instead of "not found" while the job waits its turn.
    const row = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: Direction.OUT,
        type: message.kind,
        payload: { ...message, ...(preview ? { preview } : {}) } as unknown as Prisma.InputJsonValue,
        status: MessageStatus.QUEUED,
        sentBy,
        requestId,
      },
    })

    try {
      await enqueueSend({
        channelId: channel.id,
        conversationId: conversation.id,
        to: contact.waId,
        message,
        sentBy,
        messageId: row.id,
        requestId,
      })
    } catch (err) {
      // No job will ever pick this row up; do not leave it claiming "queued".
      await prisma.message.update({
        where: { id: row.id },
        data: { status: MessageStatus.FAILED, errorCode: 'ENQUEUE_FAILED', errorMessage: 'Gagal masuk antrean.' },
      })
      throw err
    }

    // 202: accepted, not sent. The outcome arrives as message.sent or
    // message.failed carrying this requestId, or by polling GET /messages/:requestId.
    return reply.code(202).send({
      requestId,
      conversationId: conversation.id,
      status: 'queued',
      // The only handle on a form's answers: they come back in message.received carrying it.
      ...(message.kind === 'flow' ? { flowToken: message.flowToken } : {}),
    })
  })

  app.get('/messages/:requestId', async (req) => {
    const p = need(req, 'messages:read')
    const { requestId } = req.params as { requestId: string }

    const m = await prisma.message.findFirst({
      // Scoped to the key's org and numbers: anything else is "not found", not forbidden.
      where: { requestId, conversation: { channelId: channelFilter(p), channel: { orgId: p.orgId } } },
      include: { conversation: { include: { channel: true, contact: true } } },
    })
    if (!m) throw new ApiError(404, 'message_not_found', 'Pesan dengan requestId ini tidak ditemukan.')

    return {
      data: messageEventData(m, m.conversation, {
        requestId,
        sentAt: m.sentAt?.toISOString() ?? null,
        deliveredAt: m.deliveredAt?.toISOString() ?? null,
        readAt: m.readAt?.toISOString() ?? null,
      }),
    }
  })

  app.get('/contacts/:waId', async (req) => {
    const { orgId } = need(req, 'contacts:read')
    const waId = parse(waIdSchema, (req.params as { waId: string }).waId, 'waId')
    const contact = await prisma.contact.findUnique({ where: { orgId_waId: { orgId, waId } } })
    if (!contact) throw new ApiError(404, 'contact_not_found', 'Kontak tidak ditemukan.')
    return { data: contactView(contact) }
  })

  app.put('/contacts/:waId', async (req) => {
    const { orgId } = need(req, 'contacts:write')
    const waId = parse(waIdSchema, (req.params as { waId: string }).waId, 'waId')
    const body = parse(contactSchema, req.body)

    const existing = await prisma.contact.findUnique({ where: { orgId_waId: { orgId, waId } } })
    const attributes: Record<string, unknown> = { ...((existing?.attributes as Record<string, unknown>) ?? {}) }
    for (const [k, v] of Object.entries(body.attributes ?? {})) {
      if (v === null) delete attributes[k]
      else attributes[k] = v
    }

    const data = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.tags ? { tags: [...new Set(body.tags)] } : {}),
      attributes: attributes as Prisma.InputJsonValue,
    }
    const contact = await prisma.contact.upsert({
      where: { orgId_waId: { orgId, waId } },
      create: { orgId, waId, ...data },
      update: data,
    })
    return { data: contactView(contact) }
  })

  app.get('/contacts/:waId/messages', async (req) => {
    const p = need(req, 'messages:read')
    const { orgId } = p
    const waId = parse(waIdSchema, (req.params as { waId: string }).waId, 'waId')
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        /** ISO time; returns messages strictly older, for paging back. */
        before: z.string().datetime().optional(),
        channelId: z.string().optional(),
      }),
      req.query,
    )

    if (q.channelId && !canUseChannel(p, q.channelId)) {
      throw new ApiError(403, 'channel_forbidden', 'API key ini tidak diizinkan membaca nomor itu.')
    }

    const contact = await prisma.contact.findUnique({ where: { orgId_waId: { orgId, waId } } })
    if (!contact) throw new ApiError(404, 'contact_not_found', 'Kontak tidak ditemukan.')

    const rows = await prisma.message.findMany({
      where: {
        // A key limited to some numbers only sees those numbers' side of the history.
        conversation: { contactId: contact.id, channelId: q.channelId ?? channelFilter(p) },
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: { conversation: { include: { channel: true, contact: true } } },
    })

    return {
      data: rows.map((m) => messageEventData(m, m.conversation)),
      // Pass back as ?before= for the next page.
      nextBefore: rows.length === q.limit ? rows[rows.length - 1]!.createdAt.toISOString() : null,
    }
  })

  app.post('/flows/:flowId/trigger', async (req, reply) => {
    const p = need(req, 'flows:trigger')
    const { orgId } = p
    const { flowId } = req.params as { flowId: string }
    const body = parse(triggerSchema, req.body)

    const flow = await prisma.flow.findFirst({ where: { id: flowId, orgId }, include: { publishedVersion: true } })
    if (!flow) throw new ApiError(404, 'flow_not_found', 'Flow tidak ditemukan.')
    if (!flow.publishedVersion) throw new ApiError(422, 'flow_not_published', 'Flow belum diterbitkan.')
    if (!flow.enabled) throw new ApiError(422, 'flow_disabled', 'Flow sedang dinonaktifkan.')

    const graph = flowGraphSchema.safeParse(flow.publishedVersion.graph)
    const trigger = graph.success
      ? graph.data.nodes.find((n) => n.data.kind === 'trigger' && n.data.match === 'api')
      : undefined
    if (!trigger || !graph.success || !nextNodeId(graph.data, trigger.id, null)) {
      throw new ApiError(
        422,
        'no_api_trigger',
        'Versi terbit flow ini tidak punya trigger "Dipicu lewat API" yang tersambung ke node lain.',
      )
    }

    const channel = await resolveChannel(p, body.channelId)
    const { conversation } = await conversationFor(orgId, channel.id, body.to, body.name)

    if (conversation.botPaused) {
      throw new ApiError(409, 'bot_paused', 'Percakapan ini sedang ditangani agen; flow tidak dijalankan.')
    }
    if (!body.force) {
      const running = await prisma.flowSession.count({
        where: { conversationId: conversation.id, status: { in: [SessionStatus.ACTIVE, SessionStatus.WAITING] } },
      })
      if (running) {
        throw new ApiError(
          409,
          'session_running',
          'Kontak ini sedang berada di tengah flow lain. Kirim "force": true untuk menghentikannya.',
        )
      }
    }

    const variables = Object.fromEntries(Object.entries(body.variables).map(([k, v]) => [k, String(v)]))
    await flowQueue().add('tick', {
      conversationId: conversation.id,
      input: { kind: 'api', flowId: flow.id, variables, force: body.force },
    })

    return reply.code(202).send({
      conversationId: conversation.id,
      status: 'queued',
      // Free-form nodes fail outside the window; only template nodes get
      // through. Worth knowing before wondering why nothing arrived.
      windowOpen: isWindowOpen(conversation.windowExpiresAt),
    })
  })

  app.get('/templates', async (req) => {
    const p = need(req, 'templates:read')
    const q = parse(
      z.object({
        channelId: z.string().optional(),
        status: z.enum(['approved', 'pending', 'rejected', 'paused', 'disabled']).optional(),
      }),
      req.query,
    )
    if (q.channelId && !canUseChannel(p, q.channelId)) {
      throw new ApiError(403, 'channel_forbidden', 'API key ini tidak diizinkan membaca nomor itu.')
    }

    // Templates belong to a WABA, not a number: a number can send every
    // template of its WABA. So the channel filter picks WABAs.
    const channels = await prisma.channel.findMany({
      where: { orgId: p.orgId, id: q.channelId ?? channelFilter(p), wabaId: { not: null } },
      select: { wabaId: true },
    })
    if (q.channelId && channels.length === 0) throw new ApiError(404, 'channel_not_found', 'Channel tidak ditemukan.')
    const wabaIds = [...new Set(channels.map((c) => c.wabaId!))]

    const rows = await prisma.template.findMany({
      where: { wabaId: { in: wabaIds }, ...(q.status ? { metaStatus: q.status.toUpperCase() as 'APPROVED' } : {}) },
      orderBy: [{ name: 'asc' }, { language: 'asc' }],
    })

    return {
      data: rows.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.metaStatus.toLowerCase(),
        rejectionReason: t.rejectionReason,
        wabaId: t.wabaId,
        // Exactly the keys POST /messages expects in template.params.
        params: templateSlots(t.components).map((s) => ({
          key: s.key,
          component: s.component,
          format: s.format,
          example: s.example ?? null,
        })),
        preview: renderTemplate(t.components),
        syncedAt: t.syncedAt?.toISOString() ?? null,
      })),
    }
  })

  app.get('/flows', async (req) => {
    const p = need(req, 'flows:read')
    const rows = await prisma.flow.findMany({
      where: { orgId: p.orgId, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'asc' },
      include: { publishedVersion: { select: { version: true, publishedAt: true, graph: true } } },
    })

    return {
      data: rows.map((f) => {
        const graph = f.publishedVersion ? flowGraphSchema.safeParse(f.publishedVersion.graph) : undefined
        const trigger = graph?.success
          ? graph.data.nodes.find((n) => n.data.kind === 'trigger' && n.data.match === 'api')
          : undefined
        return {
          id: f.id,
          name: f.name,
          description: f.description,
          enabled: f.enabled,
          publishedVersion: f.publishedVersion?.version ?? null,
          publishedAt: f.publishedVersion?.publishedAt.toISOString() ?? null,
          // What POST /flows/:flowId/trigger checks: an API trigger wired to a next node.
          triggerable:
            f.enabled && !!trigger && !!graph?.success && !!nextNodeId(graph.data, trigger.id, null),
          updatedAt: f.updatedAt.toISOString(),
        }
      }),
    }
  })

  // Multipart only here: every other route stays JSON-only.
  await app.register(multipart, {
    limits: { files: 1, fields: 5, fileSize: Math.max(...Object.values(WA_MEDIA).map((m) => m.maxBytes)) },
  })

  app.post('/media', async (req, reply) => {
    const p = need(req, 'messages:send')
    if (!req.isMultipart()) {
      throw new ApiError(415, 'invalid_request', 'Kirim sebagai multipart/form-data dengan field "file".')
    }

    const part = await req.file()
    if (!part) throw new ApiError(400, 'invalid_request', 'Field "file" kosong.')

    const kind = mediaKindOf(part.mimetype)
    if (!kind) {
      // Drain the stream so the connection can be reused.
      part.file.resume()
      throw new ApiError(415, 'unsupported_media_type', `Tipe ${part.mimetype} tidak diterima WhatsApp.`)
    }

    let data: Buffer
    try {
      data = await part.toBuffer()
    } catch {
      throw new ApiError(413, 'file_too_large', 'Berkas melebihi batas terbesar WhatsApp (100 MB untuk dokumen).')
    }
    if (data.length === 0) throw new ApiError(400, 'invalid_request', 'Berkas kosong.')
    if (data.length > WA_MEDIA[kind].maxBytes) {
      throw new ApiError(
        413,
        'file_too_large',
        `${kind} maksimal ${Math.round(WA_MEDIA[kind].maxBytes / 1024 / 1024 * 10) / 10} MB; berkas ini ${Math.round(data.length / 1024 / 1024 * 10) / 10} MB.`,
      )
    }

    // channelId as a query parameter, or a form field sent before the file.
    const field = part.fields.channelId as { value?: unknown } | undefined
    const channelId = (req.query as { channelId?: string }).channelId ?? (typeof field?.value === 'string' ? field.value : undefined)
    const channel = await resolveChannel(p, channelId)

    let mediaId: string
    try {
      ;({ mediaId } = await providerFor(channel).uploadMedia(credentialsFor(channel), {
        data,
        mimeType: part.mimetype,
        filename: part.filename || 'file',
      }))
    } catch (err) {
      if (err instanceof ProviderError) {
        throw new ApiError(502, 'upload_failed', `Meta menolak unggahan: ${err.message}`)
      }
      throw err
    }

    return reply.code(201).send({
      mediaId,
      channelId: channel.id,
      type: kind,
      mimeType: part.mimetype,
      filename: part.filename || null,
      size: data.length,
    })
  })
}
