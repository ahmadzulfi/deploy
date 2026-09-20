import { Worker, type Job } from 'bullmq'
import { prisma, Prisma, FlowStatus, OptInStatus, SessionStatus, type Channel, type Contact } from '@wa/db'
import {
  QUEUE,
  flowQueue,
  flowGraphSchema,
  logger,
  matchTrigger,
  nextNodeId,
  runFlow,
  workerOptions,
  type EngineEffects,
  type EngineInput,
  type FlowContext,
  type FlowGraph,
  type InboundSignal,
  type SessionState,
} from '@wa/core'
import { enqueueSend } from './outbound.js'

const log = logger.child({ worker: 'flow' })

export interface FlowJob {
  conversationId: string
  input:
    | { kind: 'inbound'; messageType: string; text?: string; replyId?: string; isNewConversation?: boolean }
    | { kind: 'resume'; sessionId: string }
    | { kind: 'timeout'; sessionId: string }
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
    await start(signal, conversation)
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
  if (job.input.kind !== 'inbound') {
    return prisma.flowSession.findFirst({
      where: { id: job.input.sessionId, status: SessionStatus.WAITING },
      include: { flowVersion: true },
    })
  }
  return prisma.flowSession.findFirst({
    where: { conversationId, status: SessionStatus.WAITING },
    orderBy: { updatedAt: 'desc' },
    include: { flowVersion: true },
  })
}

/** Looks for a published flow whose trigger this message fires. */
async function start(signal: InboundSignal, conversation: Conversation) {
  const flows = await prisma.flow.findMany({
    where: {
      orgId: conversation.channel.orgId,
      status: FlowStatus.PUBLISHED,
      publishedVersionId: { not: null },
    },
    include: { publishedVersion: true },
    orderBy: { updatedAt: 'desc' },
  })

  for (const flow of flows) {
    const version = flow.publishedVersion
    if (!version) continue

    const parsed = flowGraphSchema.safeParse(version.graph)
    if (!parsed.success) {
      log.warn({ flowId: flow.id }, 'graf versi terbit tidak valid, dilewati')
      continue
    }

    const hit = matchTrigger(parsed.data, signal)
    if (!hit) continue

    const startNodeId = nextNodeId(parsed.data, hit.node.id, null)
    if (!startNodeId) {
      log.warn({ flowId: flow.id }, 'trigger cocok tapi tidak terhubung ke mana pun')
      continue
    }

    const session = await prisma.flowSession.create({
      data: {
        flowVersionId: version.id,
        contactId: conversation.contactId,
        channelId: conversation.channelId,
        conversationId: conversation.id,
        currentNodeId: hit.node.id,
        variables: {},
        status: SessionStatus.ACTIVE,
      },
      include: { flowVersion: true },
    })

    log.info(
      { flowId: flow.id, matched: hit.matched, sessionId: session.id },
      'flow dimulai',
    )

    await tick(session, { kind: 'start', startNodeId }, conversation)
    return
  }
}

type SessionRow = Awaited<ReturnType<typeof prisma.flowSession.findFirst>> & {
  flowVersion: { id: string; graph: Prisma.JsonValue }
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

  const result = await runFlow(graph, state, input, ctx, effectsFor(conversation, session.id))

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
        data: { ...base, status: SessionStatus.WAITING, expiresAt: waitDeadline(graph, result.state) },
      })
      await scheduleTimeout(graph, result.state, session.id, conversation.id)
      break

    case 'sleeping':
      await prisma.flowSession.update({
        where: { id: session.id },
        data: { ...base, status: SessionStatus.WAITING },
      })
      await flowQueue().add(
        'resume',
        { conversationId: conversation.id, input: { kind: 'resume', sessionId: session.id } } satisfies FlowJob,
        { delay: result.outcome.seconds * 1000, jobId: `resume-${session.id}-${result.state.stepCount}` },
      )
      break

    case 'completed':
    case 'handedOver':
      await prisma.flowSession.update({
        where: { id: session.id },
        data: { ...base, status: SessionStatus.COMPLETED },
      })
      log.info({ sessionId: session.id, status: result.outcome.status }, 'flow selesai')
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

function waitDeadline(graph: FlowGraph, state: SessionState): Date | null {
  const node = graph.nodes.find((n) => n.id === state.currentNodeId)
  if (node?.data.kind !== 'waitReply') return null
  return new Date(Date.now() + node.data.timeoutMinutes * 60_000)
}

async function scheduleTimeout(
  graph: FlowGraph,
  state: SessionState,
  sessionId: string,
  conversationId: string,
) {
  const node = graph.nodes.find((n) => n.id === state.currentNodeId)
  if (node?.data.kind !== 'waitReply') return

  await flowQueue().add(
    'timeout',
    { conversationId, input: { kind: 'timeout', sessionId } } satisfies FlowJob,
    {
      delay: node.data.timeoutMinutes * 60_000,
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
function effectsFor(conversation: Conversation, sessionId: string): EngineEffects {
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
    sendTemplate: (p) =>
      send({
        kind: 'template',
        name: p.name,
        language: p.language,
        components: p.bodyParams.length
          ? [{ type: 'body', parameters: p.bodyParams.map((text) => ({ type: 'text', text })) }]
          : undefined,
      }),

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
        data: { botPaused: true },
      })
    },
  }
}

/** Marketing-style flows must not reach someone who opted out. */
export function mayRunFor(contact: { optInStatus: OptInStatus }) {
  return contact.optInStatus !== OptInStatus.OPTED_OUT
}
