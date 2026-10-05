import { WA_LIMITS } from '../providers/limits.js'
import { buildRouteCatalog, type RouteDestination } from './catalog.js'
import { nextNodeId } from './match.js'
import { compare, interpolate, resolve, validateAnswer, type FlowContext } from './runtime.js'
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
  sendTemplate(p: { name: string; language: string; bodyParams: string[]; headerParam?: string }): Promise<void>
  /**
   * Calls an outside API. Resolves with whatever came back, including non-2xx
   * statuses; rejects only when there was no response at all (network error,
   * timeout). The engine turns both into the node's "error" branch.
   */
  httpRequest(p: {
    method: 'GET' | 'POST'
    url: string
    headers: Record<string, string>
    body?: string
    timeoutMs: number
  }): Promise<{ status: number; data: unknown }>
  /**
   * Asks a saved AI endpoint. Resolves with the answer text; rejects when the
   * endpoint is gone, unreachable, refused, or answered nothing usable.
   */
  askAi(p: { endpointId: string; question: string }): Promise<{ answer: string }>
  /**
   * Asks a saved router endpoint which destination the question belongs to.
   * Resolves with whatever it picked, unchecked - the engine checks the id
   * and score itself. Rejects when there was no usable answer at all.
   */
  routeAi(p: { endpointId: string; question: string; destinations: RouteDestination[] }): Promise<RoutePick>
  changeTags(action: 'add' | 'remove', tags: string[]): Promise<void>
  assign(userId: string | null, note?: string): Promise<void>
  handover(): Promise<void>
}

export interface RoutePick {
  destinationId: string | null
  score: number
  candidates: { id: string; score: number }[]
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
  /** Parked too long with no usable answer; the session is dropped. */
  | { status: 'expired' }
  | { status: 'failed'; error: string }

/**
 * How long a session may sit parked on buttons or a list before it is
 * dropped. Nothing else frees it: those nodes answer only to a tapped reply
 * id, so a contact who types instead of tapping would otherwise stay parked
 * forever, with every later message swallowed by the dead session.
 */
export const IDLE_TIMEOUT_MINUTES = 10

/** Reply id of the button Tanya AI can put under its answer. */
export const ASK_AI_END_BUTTON_ID = 'selesai'
/** Carries that button when the answer itself is too long to hold it. */
export const ASK_AI_FOLLOW_UP = 'Ada pertanyaan lain? Ketik saja, atau tekan tombol di bawah.'

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
    // Only waitReply has a branch for "no answer". Anywhere else the wait is
    // over for good, and ending the session is what lets the contact's next
    // message start a flow from the trigger again.
    if (node.data.kind !== 'waitReply') return { outcome: { status: 'expired' } }
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
        headerParam: d.headerParam ? interpolate(d.headerParam, ctx) : undefined,
      })
      return go()

    case 'waitReply':
      return { kind: 'halt', outcome: { status: 'waiting' } }

    case 'delay':
      return { kind: 'halt', outcome: { status: 'sleeping', seconds: d.seconds } }

    case 'condition': {
      // resolve, not a plain lookup, so a condition can test a field inside
      // a saved API response, e.g. `ai.status`.
      const left = resolve(d.variable, ctx)
      const hit = compare(left, d.operator, interpolate(d.value, ctx), d.caseSensitive)
      return go(hit ? 'true' : 'false')
    }

    case 'setVariable':
      state.variables[d.name] = interpolate(d.value, ctx)
      return go()

    case 'httpRequest': {
      const headers: Record<string, string> = {}
      for (const line of d.headers.split('\n')) {
        const at = line.indexOf(':')
        if (at > 0) headers[line.slice(0, at).trim()] = interpolate(line.slice(at + 1).trim(), ctx)
      }
      const body = d.method === 'POST' && d.body.trim() ? interpolate(d.body, ctx, jsonEscape) : undefined
      if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json'
      }

      try {
        const res = await fx.httpRequest({
          method: d.method,
          url: interpolate(d.url, ctx, encodeURIComponent),
          headers,
          body,
          timeoutMs: d.timeoutSeconds * 1000,
        })
        state.variables[d.saveAs] = res.data
        return go(res.status >= 200 && res.status < 300 ? 'success' : 'error')
      } catch (err) {
        // Saved so the error branch can tell the contact, or a condition can
        // tell a timeout from a refusal.
        state.variables[d.saveAs] = { error: err instanceof Error ? err.message : String(err) }
        return go('error')
      }
    }

    case 'askAi': {
      const question = interpolate(`{{${d.question}}}`, ctx).trim()
      // An empty question only earns a "query kosong" refusal; skip the call.
      if (!question) {
        state.variables[d.saveAs] = ''
        return go('error')
      }

      let answer: string
      try {
        answer = (await fx.askAi({ endpointId: d.endpointId, question })).answer
      } catch {
        // The worker has logged why and recorded it on the endpoint.
        state.variables[d.saveAs] = ''
        return go('error')
      }

      // Chat models can run long; WhatsApp refuses a text over its limit.
      const max = WA_LIMITS.text.bodyMax
      const text = answer.length > max ? `${answer.slice(0, max - 1)}…` : answer
      state.variables[d.saveAs] = text
      // Outside the try: a failed send is not the AI's failure.
      if (d.sendAnswer) {
        const title = interpolate(d.endButton, ctx).trim()
        if (!title) {
          await fx.sendText(text)
        } else {
          const buttons = [{ id: ASK_AI_END_BUTTON_ID, title }]
          // An interactive body holds far less than a text; a long answer
          // goes out whole, with the button on a short note after it.
          if (text.length <= WA_LIMITS.interactive.bodyMax) {
            await fx.sendButtons({ body: text, buttons })
          } else {
            await fx.sendText(text)
            await fx.sendButtons({ body: ASK_AI_FOLLOW_UP, buttons })
          }
        }
      }
      return go('success')
    }

    case 'aiRoute': {
      const question = interpolate(`{{${d.question}}}`, ctx).trim()
      const destinations = question ? buildRouteCatalog(graph) : []
      if (destinations.length === 0) {
        state.variables[d.saveAs] = { id: null, score: 0 }
        return go('error')
      }

      let pick: RoutePick
      try {
        pick = await fx.routeAi({ endpointId: d.endpointId, question, destinations })
      } catch {
        // The worker has logged why and recorded it on the endpoint.
        state.variables[d.saveAs] = { id: null, score: 0 }
        return go('error')
      }

      // Only an id we sent counts. Anything else - a typo, an id from some
      // other catalog, a confident guess below the bar - is treated as the
      // router not knowing, and the contact gets the menu instead.
      const score = Number.isFinite(pick.score) ? pick.score : 0
      const dest = destinations.find((x) => x.id === pick.destinationId)
      const candidates = pick.candidates.slice(0, 3)
      if (!dest || score < d.minScore) {
        state.variables[d.saveAs] = { id: null, score, candidates }
        return go('unsure')
      }

      state.variables[d.saveAs] = { id: dest.id, score, path: dest.path, candidates }
      return { kind: 'next', next: dest.target }
    }

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

/** Escapes a value for use inside a JSON string literal the author wrote. */
function jsonEscape(value: string) {
  return JSON.stringify(value).slice(1, -1)
}
