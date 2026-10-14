import { Worker, type Job } from 'bullmq'
import { prisma, Prisma, FlowStatus, OptInStatus, RouteOutcome, SessionStatus, type Channel, type Contact } from '@wa/db'
import {
  aiConfigOf,
  buildTemplateComponents,
  emitEvent,
  findFallbackTrigger,
  flowGraphSchema,
  flowTemplateValues,
  IDLE_TIMEOUT_MINUTES,
  logger,
  maskRouteQuestion,
  routeExamplesFor,
  matchTrigger,
  nextNodeId,
  ROUTE_QUESTION_VARIABLE,
  runFlow,
  type EngineEffects,
  type EngineInput,
  type FlowContext,
  type FlowGraph,
  type FlowNode,
  type InboundSignal,
  type RouteOutcome as EngineRouteOutcome,
  type SessionState,
} from '@wa/core'
import { QUEUE, flowQueue, workerOptions } from '@wa/core/queues'
import { callAi, callRoute, safeFetch } from '@wa/core/ai-call'
import { enqueueSend } from './outbound.js'

const log = logger.child({ worker: 'flow' })

export interface FlowJob {
  conversationId: string
  input:
    | { kind: 'inbound'; messageType: string; text?: string; replyId?: string; isNewConversation?: boolean }
    | { kind: 'resume'; sessionId: string }
    // The step the wait began on: a timeout that fires after the session has
    // moved on is stale and must not drop a wait that is still live.
    | { kind: 'timeout'; sessionId: string; stepCount?: number }
    /** Started by the public API on a flow's "Dipicu lewat API" trigger. */
    | { kind: 'api'; flowId: string; variables: Record<string, string>; force?: boolean }
}

export function startFlowWorker() {
  return new Worker<FlowJob>(QUEUE.flow, (job) => handle(job.data), workerOptions({ concurrency: 5 }))
}

/** Called by the inbound processor for every message a contact sends. */
export async function enqueueInbound(conversationId: string, signal: InboundSignal & { messageType: string }) {
  await flowQueue().add('tick', {
    conversationId,
    input: {
      kind: 'inbound',
      messageType: signal.messageType,
      text: signal.text,
      replyId: signal.replyId,
      isNewConversation: signal.isNewConversation,
    },
  } satisfies FlowJob)
}

async function handle(job: FlowJob) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: job.conversationId },
    include: { contact: true, channel: true },
  })
  if (!conversation) return

  // A human took over. The engine must stay out of the way until an agent
  // hands it back, or the bot talks over them.
  if (conversation.botPaused) {
    log.debug({ conversationId: conversation.id }, 'bot dijeda, flow dilewati')
    return
  }

  if (job.input.kind === 'api') {
    await startFromApi(job.input, conversation)
    return
  }

  const session = await activeSession(job, conversation.id)

  if (job.input.kind === 'inbound') {
    const signal: InboundSignal = {
      text: job.input.text,
      replyId: job.input.replyId,
      isNewConversation: job.input.isNewConversation,
    }

    if (session) {
      await tick(session, { kind: 'reply', messageType: job.input.messageType, ...signal }, conversation)
      return
    }
    await start(signal, job.input.messageType, conversation)
    return
  }

  if (!session) return
  await tick(session, job.input.kind === 'resume' ? { kind: 'resume' } : { kind: 'timeout' }, conversation)
}

type Conversation = Awaited<ReturnType<typeof prisma.conversation.findUnique>> & {
  contact: Contact
  channel: Channel
}

async function activeSession(job: FlowJob, conversationId: string) {
  if (job.input.kind === 'resume' || job.input.kind === 'timeout') {
    const session = await prisma.flowSession.findFirst({
      where: { id: job.input.sessionId, status: SessionStatus.WAITING },
      include: { flowVersion: true },
    })
    if (
      session &&
      job.input.kind === 'timeout' &&
      job.input.stepCount !== undefined &&
      job.input.stepCount !== session.stepCount
    ) {
      // The contact answered and the flow walked on; this timeout belongs to
      // a wait that is already over.
      return null
    }
    return session
  }
  return prisma.flowSession.findFirst({
    where: { conversationId, status: SessionStatus.WAITING },
    orderBy: { updatedAt: 'desc' },
    include: { flowVersion: true },
  })
}

/**
 * Looks for a published flow whose trigger this message fires.
 *
 * Two passes: every ordinary trigger in every flow first, and only when none
 * fired, a "no keyword matched" trigger - so a fallback in one flow can never
 * steal a keyword another flow answers to.
 */
async function start(signal: InboundSignal, messageType: string, conversation: Conversation) {
  const flows = await prisma.flow.findMany({
    where: {
      orgId: conversation.channel.orgId,
      status: FlowStatus.PUBLISHED,
      publishedVersionId: { not: null },
      // A disabled flow keeps its published version but stops answering.
      // Sessions already running finish on the version they started with.
      enabled: true,
    },
    include: { publishedVersion: true },
    orderBy: { updatedAt: 'desc' },
  })

  const live = flows.flatMap((flow) => {
    const version = flow.publishedVersion
    if (!version) return []
    const parsed = flowGraphSchema.safeParse(version.graph)
    if (!parsed.success) {
      log.warn({ flowId: flow.id }, 'graf versi terbit tidak valid, dilewati')
      return []
    }
    return [{ flowId: flow.id, versionId: version.id, graph: parsed.data }]
  })

  for (const flow of live) {
    const hit = matchTrigger(flow.graph, signal)
    if (hit && (await begin(flow, hit.node, hit.matched, signal, conversation))) return
  }

  // A tapped button or a photo is not a question an AI could place.
  if (messageType !== 'text' || !signal.text?.trim()) return
  for (const flow of live) {
    const fallback = findFallbackTrigger(flow.graph)
    if (fallback && (await begin(flow, fallback, 'tidak cocok kata kunci', signal, conversation))) return
  }
}

/** Opens a session at `trigger`. False when the trigger leads nowhere. */
async function begin(
  flow: { flowId: string; versionId: string; graph: FlowGraph },
  trigger: FlowNode,
  matched: string,
  signal: InboundSignal,
  conversation: Conversation,
) {
  const startNodeId = nextNodeId(flow.graph, trigger.id, null)
  if (!startNodeId) {
    log.warn({ flowId: flow.flowId }, 'trigger cocok tapi tidak terhubung ke mana pun')
    return false
  }

  const session = await prisma.flowSession.create({
    data: {
      flowVersionId: flow.versionId,
      contactId: conversation.contactId,
      channelId: conversation.channelId,
      conversationId: conversation.id,
      currentNodeId: trigger.id,
      // The message that started it, for Arahkan AI or any later node.
      variables: signal.text ? { [ROUTE_QUESTION_VARIABLE]: signal.text } : {},
      status: SessionStatus.ACTIVE,
    },
    include: { flowVersion: true },
  })

  log.info({ flowId: flow.flowId, matched, sessionId: session.id }, 'flow dimulai')

  await tick(session, { kind: 'start', startNodeId }, conversation)
  return true
}

/**
 * Starts one named flow for this conversation at its API trigger.
 *
 * The API refuses up front when a session is already running, but a reply
 * can start one between that check and this job, so it is checked again.
 */
async function startFromApi(input: Extract<FlowJob['input'], { kind: 'api' }>, conversation: Conversation) {
  const flow = await prisma.flow.findFirst({
    where: { id: input.flowId, orgId: conversation.channel.orgId, enabled: true, status: FlowStatus.PUBLISHED },
    include: { publishedVersion: true },
  })
  const version = flow?.publishedVersion
  if (!flow || !version) {
    log.warn({ flowId: input.flowId }, 'flow API tidak ditemukan atau tidak aktif')
    return
  }

  const parsed = flowGraphSchema.safeParse(version.graph)
  const trigger = parsed.success
    ? parsed.data.nodes.find((n) => n.data.kind === 'trigger' && n.data.match === 'api')
    : undefined
  const startNodeId = trigger && parsed.success ? nextNodeId(parsed.data, trigger.id, null) : null
  if (!trigger || !startNodeId) {
    log.warn({ flowId: flow.id }, 'flow tidak punya trigger API yang tersambung')
    return
  }

  const running = { conversationId: conversation.id, status: { in: [SessionStatus.ACTIVE, SessionStatus.WAITING] } }
  if (input.force) {
    await prisma.flowSession.updateMany({ where: running, data: { status: SessionStatus.EXPIRED } })
  } else if (await prisma.flowSession.count({ where: running })) {
    log.info({ flowId: flow.id, conversationId: conversation.id }, 'flow API dilewati: sesi lain sedang berjalan')
    return
  }

  const session = await prisma.flowSession.create({
    data: {
      flowVersionId: version.id,
      contactId: conversation.contactId,
      channelId: conversation.channelId,
      conversationId: conversation.id,
      currentNodeId: trigger.id,
      variables: input.variables,
      status: SessionStatus.ACTIVE,
    },
    include: { flowVersion: true },
  })

  log.info({ flowId: flow.id, sessionId: session.id }, 'flow dimulai lewat API')
  await tick(session, { kind: 'start', startNodeId }, conversation)
}

type SessionRow = Awaited<ReturnType<typeof prisma.flowSession.findFirst>> & {
  flowVersion: { id: string; flowId: string; graph: Prisma.JsonValue }
}

async function tick(session: SessionRow, input: EngineInput, conversation: Conversation) {
  const parsed = flowGraphSchema.safeParse(session.flowVersion.graph)
  if (!parsed.success) {
    await fail(session.id, 'graf versi tidak valid')
    return
  }
  const graph: FlowGraph = parsed.data

  const state: SessionState = {
    currentNodeId: session.currentNodeId,
    variables: (session.variables as Record<string, unknown>) ?? {},
    stepCount: session.stepCount,
    retries: Number((session.variables as Record<string, unknown>)?.__retries ?? 0),
  }

  const ctx: FlowContext = {
    variables: state.variables,
    contact: {
      name: conversation.contact.name,
      waId: conversation.contact.waId,
      attributes: (conversation.contact.attributes as Record<string, unknown>) ?? {},
      tags: conversation.contact.tags,
    },
    channel: { name: conversation.channel.name, displayPhone: conversation.channel.displayPhone },
  }

  const result = await runFlow(graph, state, input, ctx, effectsFor(conversation, session))

  const variables = { ...result.state.variables, __retries: result.state.retries }
  const base = {
    currentNodeId: result.state.currentNodeId,
    variables: variables as Prisma.InputJsonValue,
    stepCount: result.state.stepCount,
  }

  switch (result.outcome.status) {
    case 'waiting':
      await prisma.flowSession.update({
        where: { id: session.id },
        data: {
          ...base,
          status: SessionStatus.WAITING,
          // A tick that moved nowhere (junk typed at a list, a re-prompt on an
          // invalid answer) keeps the original deadline: the queued timeout is
          // keyed by step and does not move either, and a contact must not be
          // able to hold a session open forever by sending nonsense.
          expiresAt:
            result.state.stepCount === session.stepCount
              ? session.expiresAt
              : waitDeadline(graph, result.state),
        },
      })
      await scheduleTimeout(graph, result.state, session.id, conversation.id)
      break

    case 'sleeping':
      await prisma.flowSession.update({
        where: { id: session.id },
        data: {
          ...base,
          status: SessionStatus.WAITING,
          // Only the queued resume wakes a delay. Recording when it is due
          // gives the sweeper something to act on if that job never arrives.
          expiresAt: new Date(Date.now() + result.outcome.seconds * 1000),
        },
      })
      await flowQueue().add(
        'resume',
        { conversationId: conversation.id, input: { kind: 'resume', sessionId: session.id } } satisfies FlowJob,
        { delay: result.outcome.seconds * 1000, jobId: `resume-${session.id}-${result.state.stepCount}` },
      )
      break

    case 'expired':
      await prisma.flowSession.update({
        where: { id: session.id },
        data: { ...base, status: SessionStatus.EXPIRED },
      })
      log.info({ sessionId: session.id }, 'sesi kedaluwarsa tanpa balasan')
      break

    case 'completed':
    case 'handedOver':
      await prisma.flowSession.update({
        where: { id: session.id },
        data: { ...base, status: SessionStatus.COMPLETED },
      })
      log.info({ sessionId: session.id, status: result.outcome.status }, 'flow selesai')
      await emitEvent(conversation.channel.orgId, 'flow.completed', {
        flowId: session.flowVersion.flowId,
        flowVersionId: session.flowVersion.id,
        sessionId: session.id,
        conversationId: conversation.id,
        outcome: result.outcome.status,
        // What the flow collected - usually the reason anyone subscribes.
        variables: result.state.variables,
        channel: { id: conversation.channel.id, name: conversation.channel.name, phone: conversation.channel.displayPhone },
        contact: { waId: conversation.contact.waId, name: conversation.contact.name },
        timestamp: new Date().toISOString(),
      })
      break

    case 'failed':
      await prisma.flowSession.update({
        where: { id: session.id },
        data: { ...base, status: SessionStatus.FAILED },
      })
      log.error({ sessionId: session.id, error: result.outcome.error }, 'flow gagal')
      break
  }
}

/**
 * Minutes this node may stay parked before the session is dropped, or null
 * when the node does not wait for the contact at all.
 */
function parkMinutes(graph: FlowGraph, state: SessionState): number | null {
  const node = graph.nodes.find((n) => n.id === state.currentNodeId)
  if (!node) return null
  // A hand-edited 0 would schedule a timeout due immediately, giving up
  // before the contact can answer. Publishing rejects it; this covers graphs
  // that got one in some other way.
  if (node.data.kind === 'waitReply') return Math.max(1, node.data.timeoutMinutes)
  // Buttons and lists answer only to a tapped reply id, so without a deadline
  // of their own they park the conversation for good.
  // Arahkan AI parks only on its "Maksud Anda" list, which is no different.
  if (node.data.kind === 'sendButtons' || node.data.kind === 'sendList' || node.data.kind === 'aiRoute') {
    return IDLE_TIMEOUT_MINUTES
  }
  return null
}

function waitDeadline(graph: FlowGraph, state: SessionState): Date | null {
  const minutes = parkMinutes(graph, state)
  return minutes === null ? null : new Date(Date.now() + minutes * 60_000)
}

async function scheduleTimeout(
  graph: FlowGraph,
  state: SessionState,
  sessionId: string,
  conversationId: string,
) {
  const minutes = parkMinutes(graph, state)
  if (minutes === null) return

  await flowQueue().add(
    'timeout',
    { conversationId, input: { kind: 'timeout', sessionId, stepCount: state.stepCount } } satisfies FlowJob,
    {
      delay: minutes * 60_000,
      // Keyed by step so a re-prompt replaces the pending timeout rather than
      // stacking a second one.
      jobId: `timeout-${sessionId}-${state.stepCount}`,
    },
  )
}

async function fail(sessionId: string, error: string) {
  await prisma.flowSession.update({ where: { id: sessionId }, data: { status: SessionStatus.FAILED } })
  log.error({ sessionId, error }, 'flow gagal')
}

/** Binds the engine's abstract effects to this conversation. */
function effectsFor(conversation: Conversation, session: SessionRow): EngineEffects {
  const sessionId = session.id
  const send = (message: Parameters<typeof enqueueSend>[0]['message']) =>
    enqueueSend({
      channelId: conversation.channelId,
      conversationId: conversation.id,
      to: conversation.contact.waId,
      message,
      sentBy: `flow:${sessionId}`,
    }).then(() => undefined)

  return {
    sendText: (body) => send({ kind: 'text', body }),

    sendMedia: (p) =>
      send({
        kind: p.media,
        // Meta takes either a public link it fetches, or an id from its own
        // upload endpoint - never both.
        ...(p.source === 'id' ? { mediaId: p.value } : { link: p.value }),
        // Audio carries no caption; WhatsApp silently drops it.
        ...(p.media === 'audio' ? {} : { caption: p.caption }),
        ...(p.media === 'document' && p.filename ? { filename: p.filename } : {}),
      } as Parameters<typeof enqueueSend>[0]['message']),

    sendButtons: (p) =>
      send({
        kind: 'buttons',
        body: p.body,
        footer: p.footer,
        buttons: p.buttons,
        header: p.headerImage
          ? { type: 'image', link: p.headerImage }
          : p.header
            ? { type: 'text', text: p.header }
            : undefined,
      }),
    sendList: (p) => send({ kind: 'list', ...p }),
    async sendTemplate(p) {
      // The node only stores values in order; the synced definition says
      // where they go - named parameters, a header, a media link. Without a
      // synced copy fall back to plain positional body parameters.
      const template = conversation.channel.wabaId
        ? await prisma.template.findUnique({
            where: {
              wabaId_name_language: { wabaId: conversation.channel.wabaId, name: p.name, language: p.language },
            },
            select: { components: true },
          })
        : null

      await send({
        kind: 'template',
        name: p.name,
        language: p.language,
        components: template
          ? buildTemplateComponents(template.components, flowTemplateValues(template.components, p))
          : p.bodyParams.length
            ? [{ type: 'body', parameters: p.bodyParams.map((text) => ({ type: 'text', text })) }]
            : undefined,
      })
    },

    async httpRequest(p) {
      // safeFetch refuses internal addresses and caps the body, which ends up
      // stored whole in the session's variables.
      const res = await safeFetch(p.url, p)
      log.info({ sessionId, url: p.url, status: res.status }, 'flow memanggil API')
      return res
    },

    async askAi({ endpointId, question }) {
      // Scoped to the org, so a graph cannot borrow another org's endpoint
      // and its API key by id.
      const endpoint = await prisma.aiEndpoint.findFirst({
        where: { id: endpointId, orgId: conversation.channel.orgId },
      })
      if (!endpoint) {
        log.warn({ sessionId, endpointId }, 'AI tidak ditemukan')
        throw new Error('AI tidak ditemukan')
      }

      const result = await callAi(aiConfigOf(endpoint), {
        pertanyaan: question,
        nama: conversation.contact.name ?? '',
        nomor: conversation.contact.waId,
      })

      // One timestamp for both: the AI page reads "failing" as lastErrorAt
      // not older than lastUsedAt.
      const now = new Date()
      await prisma.aiEndpoint.update({
        where: { id: endpoint.id },
        data: result.ok
          ? { lastUsedAt: now }
          : { lastUsedAt: now, lastErrorAt: now, lastError: result.error.slice(0, 500) },
      })

      if (!result.ok) {
        log.warn({ sessionId, ai: endpoint.name, error: result.error, ms: result.ms }, 'Tanya AI gagal')
        throw new Error(result.error)
      }
      log.info({ sessionId, ai: endpoint.name, ms: result.ms }, 'Tanya AI dijawab')
      return { answer: result.answer }
    },

    async routeAi({ endpointId, question, destinations }) {
      const endpoint = await prisma.aiEndpoint.findFirst({
        where: { id: endpointId, orgId: conversation.channel.orgId },
      })
      // Publishing checks the kind too, but an endpoint is never re-checked
      // against flows already live.
      if (!endpoint || endpoint.kind !== 'ROUTE') {
        log.warn({ sessionId, endpointId }, 'AI untuk Arahkan AI tidak ditemukan')
        throw new Error('AI tidak ditemukan')
      }

      // Examples only sharpen the answer; without them the router still has
      // the menu, so a failed lookup costs nothing but that.
      const examples = await routeExamplesFor(
        session.flowVersion.flowId,
        destinations.map((d) => d.id),
      ).catch((err) => {
        log.warn({ sessionId, err: String(err) }, 'contoh Arahkan AI tidak terbaca, dikirim tanpa contoh')
        return []
      })
      const result = await callRoute(aiConfigOf(endpoint), { question, destinations, examples })

      const now = new Date()
      await prisma.aiEndpoint.update({
        where: { id: endpoint.id },
        data: result.ok
          ? { lastUsedAt: now }
          : { lastUsedAt: now, lastErrorAt: now, lastError: result.error.slice(0, 500) },
      })

      if (!result.ok) {
        log.warn({ sessionId, ai: endpoint.name, error: result.error, ms: result.ms }, 'Arahkan AI gagal')
        throw new Error(result.error)
      }
      // Never the question itself: a contact's words may carry their name,
      // address or complaint. Only recordRoute keeps them, masked, where
      // admins alone read them and they expire.
      log.info(
        {
          sessionId,
          ai: endpoint.name,
          examples: examples.length,
          destinationId: result.destinationId,
          score: result.score,
          ms: result.ms,
        },
        'Arahkan AI menjawab',
      )
      return { destinationId: result.destinationId, score: result.score, candidates: result.candidates }
    },

    async recordRoute(p) {
      try {
        const row = await prisma.routeDecision.create({
          data: {
            orgId: conversation.channel.orgId,
            flowId: session.flowVersion.flowId,
            flowVersionId: session.flowVersion.id,
            sessionId,
            contactId: conversation.contactId,
            endpointId: p.endpointId,
            question: p.outcome === 'skipped' ? null : maskRouteQuestion(p.question),
            outcome: ROUTE_OUTCOME[p.outcome],
            destinationId: p.destinationId,
            destinationPath: p.destinationPath,
            score: p.score,
            candidates: p.candidates,
            offered: p.offered,
          },
          select: { id: true },
        })
        return row.id
      } catch (err) {
        log.warn({ sessionId, err: String(err) }, 'keputusan Arahkan AI gagal dicatat')
        return null
      }
    },

    async settleRoute(p) {
      // updateMany, not update: the row may already be purged, and an answer
      // to a list that was settled once must not overwrite it.
      await prisma.routeDecision
        .updateMany({
          where: { id: p.decisionId, outcome: RouteOutcome.ASKED },
          data: {
            outcome: ROUTE_OUTCOME[p.outcome],
            destinationId: p.destinationId,
            destinationPath: p.destinationPath,
            resolvedAt: new Date(),
          },
        })
        .catch((err) => log.warn({ sessionId, err: String(err) }, 'jawaban "Maksud Anda" gagal dicatat'))
    },

    async changeTags(action, tags) {
      const current = new Set(conversation.contact.tags)
      for (const t of tags) action === 'add' ? current.add(t) : current.delete(t)
      await prisma.contact.update({
        where: { id: conversation.contactId },
        data: { tags: [...current] },
      })
      conversation.contact.tags = [...current]
    },

    async assign(userId) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { assigneeId: userId },
      })
    },

    async handover() {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { botPaused: true, botPausedAt: new Date() },
      })
    },
  }
}

/** Marketing-style flows must not reach someone who opted out. */
export function mayRunFor(contact: { optInStatus: OptInStatus }) {
  return contact.optInStatus !== OptInStatus.OPTED_OUT
}

const ROUTE_OUTCOME = {
  jumped: RouteOutcome.JUMPED,
  asked: RouteOutcome.ASKED,
  picked: RouteOutcome.PICKED,
  other: RouteOutcome.OTHER,
  unsure: RouteOutcome.UNSURE,
  error: RouteOutcome.ERROR,
  skipped: RouteOutcome.SKIPPED,
} as const satisfies Record<EngineRouteOutcome, RouteOutcome>

