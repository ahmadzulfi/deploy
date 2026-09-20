import { nextNodeId } from './match.js'
import { compare, interpolate, validateAnswer, type FlowContext } from './runtime.js'
import type { FlowGraph, FlowNode } from './schema.js'

/**
 * The flow state machine.
 *
 * Deliberately free of Prisma, Redis and the Graph API: every side effect
 * goes through `EngineEffects`, so the whole thing is testable with a fake.
 * The worker supplies the real implementation.
 */

export interface EngineEffects {
  sendText(body: string): Promise<void>
  sendMedia(p: {
    media: 'image' | 'video' | 'document' | 'audio'
    source: 'link' | 'id'
    value: string
    caption?: string
    filename?: string
  }): Promise<void>
  sendButtons(p: {
    header?: string
    headerImage?: string
    body: string
    footer?: string
    buttons: { id: string; title: string }[]
  }): Promise<void>
  sendList(p: {
    header?: string
    body: string
    footer?: string
    buttonText: string
    sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]
  }): Promise<void>
  sendTemplate(p: { name: string; language: string; bodyParams: string[] }): Promise<void>
  changeTags(action: 'add' | 'remove', tags: string[]): Promise<void>
  assign(userId: string | null, note?: string): Promise<void>
  handover(): Promise<void>
}

export interface SessionState {
  currentNodeId: string | null
  variables: Record<string, unknown>
  stepCount: number
  /** Failed validations on the waitReply node currently in play. */
  retries: number
}

export type EngineInput =
  | { kind: 'start'; startNodeId: string }
  /** The contact answered while the session was waiting. */
  | { kind: 'reply'; messageType: string; text?: string; replyId?: string }
  /** The waitReply window elapsed with no answer. */
  | { kind: 'timeout' }
  /** A delay finished. */
  | { kind: 'resume' }

export type EngineOutcome =
  | { status: 'waiting' }
  | { status: 'sleeping'; seconds: number }
  | { status: 'completed' }
  | { status: 'handedOver' }
  | { status: 'failed'; error: string }

/** Per-tick ceiling. A graph that spins hits this instead of the contact. */
export const MAX_STEPS_PER_TICK = 50
/** Whole-session ceiling, across every tick. */
export const MAX_STEPS_PER_SESSION = 500

export async function runFlow(
  graph: FlowGraph,
  state: SessionState,
  input: EngineInput,
  ctx: FlowContext,
  fx: EngineEffects,
): Promise<{ state: SessionState; outcome: EngineOutcome }> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const next = { ...state, variables: { ...state.variables } }
  const context = (): FlowContext => ({ ...ctx, variables: next.variables })

  // Resolve where this tick begins. A reply or a timeout is answered by the
  // node the session is parked on, not by walking forward from it.
  let cursor: string | null
  if (input.kind === 'start') {
    cursor = input.startNodeId
  } else {
    const parked = next.currentNodeId ? byId.get(next.currentNodeId) : undefined
    if (!parked) return { state: next, outcome: { status: 'failed', error: 'node tidak ditemukan' } }

    const resumed = await resumeFrom(parked, input, next, graph, context(), fx)
    if ('outcome' in resumed) return { state: next, outcome: resumed.outcome }
    cursor = resumed.cursor
  }

  let steps = 0
  while (cursor) {
    if (++steps > MAX_STEPS_PER_TICK || ++next.stepCount > MAX_STEPS_PER_SESSION) {
      next.currentNodeId = cursor
      return { state: next, outcome: { status: 'failed', error: 'batas langkah terlampaui' } }
    }

    const node = byId.get(cursor)
    if (!node) {
      return { state: next, outcome: { status: 'failed', error: `node ${cursor} tidak ada` } }
    }

    next.currentNodeId = node.id
    const step = await execute(node, next, graph, context(), fx)

    if (step.kind === 'halt') return { state: next, outcome: step.outcome }
    cursor = step.next
  }

  // Ran off the end of the graph without an explicit End node.
  return { state: next, outcome: { status: 'completed' } }
}

/**
 * Handles an inbound reply or a timeout landing on the node the session is
 * parked on, and returns where to continue from.
 */
async function resumeFrom(
  node: FlowNode,
  input: Exclude<EngineInput, { kind: 'start' }>,
  state: SessionState,
  graph: FlowGraph,
  ctx: FlowContext,
  fx: EngineEffects,
): Promise<{ cursor: string | null } | { outcome: EngineOutcome }> {
  if (input.kind === 'resume') {
    return { cursor: nextNodeId(graph, node.id, null) }
  }

  if (input.kind === 'timeout') {
    if (node.data.kind !== 'waitReply') return { outcome: { status: 'waiting' } }
    return { cursor: nextNodeId(graph, node.id, 'timeout') }
  }

  // An interactive node routes purely by the reply id, never by the visible
  // label - renaming a button must not change which branch runs.
  if (node.data.kind === 'sendButtons' || node.data.kind === 'sendList') {
    if (!input.replyId) return { outcome: { status: 'waiting' } }
    const target = nextNodeId(graph, node.id, input.replyId)
    // An unwired branch leaves the session parked rather than ending it, so a
    // later correct tap still works.
    return target ? { cursor: target } : { outcome: { status: 'waiting' } }
  }

  if (node.data.kind === 'waitReply') {
    const answer = { type: input.messageType, text: input.text ?? input.replyId }

    if (!validateAnswer(node.data.expect, answer)) {
      state.retries += 1

      if (state.retries > node.data.maxRetries) {
        // Out of attempts. Treated as "no usable answer", which is what the
        // timeout branch already means.
        state.retries = 0
        return { cursor: nextNodeId(graph, node.id, 'timeout') }
      }

      if (node.data.invalidMessage) await fx.sendText(interpolate(node.data.invalidMessage, ctx))
      return { outcome: { status: 'waiting' } }
    }

    state.variables[node.data.saveAs] = input.text ?? input.replyId ?? ''
    state.retries = 0
    return { cursor: nextNodeId(graph, node.id, 'reply') }
  }

  // A reply arrived while parked somewhere that does not consume replies.
  return { outcome: { status: 'waiting' } }
}

type Step = { kind: 'next'; next: string | null } | { kind: 'halt'; outcome: EngineOutcome }

async function execute(
  node: FlowNode,
  state: SessionState,
  graph: FlowGraph,
  ctx: FlowContext,
  fx: EngineEffects,
): Promise<Step> {
  const d = node.data
  const go = (handle: string | null = null): Step => ({
    kind: 'next',
    next: nextNodeId(graph, node.id, handle),
  })

  switch (d.kind) {
    case 'trigger':
      return go()

    case 'sendText':
      await fx.sendText(interpolate(d.body, ctx))
      return go()

    case 'sendMedia':
      await fx.sendMedia({
        media: d.media,
        source: d.source,
        value: interpolate(d.value, ctx),
        caption: d.caption ? interpolate(d.caption, ctx) : undefined,
        filename: d.filename,
      })
      return go()

    case 'sendButtons':
      await fx.sendButtons({
        header: d.header ? interpolate(d.header, ctx) : undefined,
        headerImage: d.headerImage ? interpolate(d.headerImage, ctx) : undefined,
        body: interpolate(d.body, ctx),
        footer: d.footer ? interpolate(d.footer, ctx) : undefined,
        buttons: d.buttons.map((b) => ({ id: b.id, title: interpolate(b.title, ctx) })),
      })
      // Control passes to the contact until they tap something.
      return { kind: 'halt', outcome: { status: 'waiting' } }

    case 'sendList':
      await fx.sendList({
        header: d.header ? interpolate(d.header, ctx) : undefined,
        body: interpolate(d.body, ctx),
        footer: d.footer ? interpolate(d.footer, ctx) : undefined,
        buttonText: d.buttonText,
        sections: d.sections.map((s) => ({
          title: interpolate(s.title, ctx),
          rows: s.rows.map((r) => ({
            id: r.id,
            title: interpolate(r.title, ctx),
            description: r.description ? interpolate(r.description, ctx) : undefined,
          })),
        })),
      })
      return { kind: 'halt', outcome: { status: 'waiting' } }

    case 'sendTemplate':
      await fx.sendTemplate({
        name: d.templateName,
        language: d.language,
        bodyParams: d.bodyParams.map((p) => interpolate(p, ctx)),
      })
      return go()

    case 'waitReply':
      return { kind: 'halt', outcome: { status: 'waiting' } }

    case 'delay':
      return { kind: 'halt', outcome: { status: 'sleeping', seconds: d.seconds } }

    case 'condition': {
      const left = ctx.variables[d.variable] ?? undefined
      const hit = compare(left, d.operator, interpolate(d.value, ctx), d.caseSensitive)
      return go(hit ? 'true' : 'false')
    }

    case 'setVariable':
      state.variables[d.name] = interpolate(d.value, ctx)
      return go()

    case 'tag':
      await fx.changeTags(
        d.action,
        d.tags.map((t) => t.trim()).filter(Boolean),
      )
      return go()

    case 'assign':
      await fx.assign(d.userId, d.note)
      return go()

    case 'handover':
      if (d.message) await fx.sendText(interpolate(d.message, ctx))
      await fx.handover()
      return { kind: 'halt', outcome: { status: 'handedOver' } }

    case 'end':
      return { kind: 'halt', outcome: { status: 'completed' } }
  }
}
