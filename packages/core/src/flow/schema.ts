import { z } from 'zod'

/**
 * The flow graph format, shared by the editor and the engine.
 *
 * Both read this file, so a node the editor can draw is always a node the
 * engine can run. Adding a node type in one place and forgetting the other is
 * the failure mode this is built to prevent.
 *
 * Lengths and counts are NOT enforced here. This schema is the storage
 * format, so it must accept a half-written draft; WhatsApp's limits and every
 * required-field rule live in validateFlow, which gates publishing.
 *
 * Branching lives in the edges, not the nodes: an edge carries a
 * `sourceHandle` naming which output it leaves from. A buttons node exposes
 * one handle per button, so the graph literally encodes "tapped btn_yes ->
 * go here". The engine matches the inbound reply id against that handle.
 */

export const NODE_KINDS = [
  'trigger',
  'sendText',
  'sendMedia',
  'sendButtons',
  'sendList',
  'sendTemplate',
  'waitReply',
  'condition',
  'setVariable',
  'httpRequest',
  'askAi',
  'aiRoute',
  'delay',
  'assign',
  'tag',
  'handover',
  'end',
] as const

export type NodeKind = (typeof NODE_KINDS)[number]

/**
 * Holds the text of the message that started a session. Filled by the worker
 * for every session an inbound message starts, so Arahkan AI has a question
 * without a Tunggu balasan in front of it.
 */
export const ROUTE_QUESTION_VARIABLE = 'pesan_awal'

/** What Arahkan AI says above the destinations it is unsure between. */
export const ROUTE_CLARIFY_BODY = 'Maksud Anda yang mana? Pilih salah satu, atau "Lainnya" untuk melihat menu.'

const position = z.object({ x: z.number(), y: z.number() })

const triggerData = z.object({
  kind: z.literal('trigger'),
  /**
   * keyword: any of `values` appears; exact: whole message equals one.
   * fallback: a text message no other trigger in any flow fired on - the
   * door to Arahkan AI for questions typed in the contact's own words.
   */
  match: z.enum(['keyword', 'exact', 'regex', 'newConversation', 'buttonPayload', 'api', 'fallback']),
  values: z.array(z.string()).default([]),
  caseSensitive: z.boolean().default(false),
})

const sendTextData = z.object({
  kind: z.literal('sendText'),
  body: z.string(),
})

const sendMediaData = z.object({
  kind: z.literal('sendMedia'),
  media: z.enum(['image', 'video', 'document', 'audio']),
  /**
   * Either a publicly reachable URL that Meta can fetch, or a media id from
   * Meta's own upload endpoint. An id avoids needing public hosting at all,
   * which is why both are allowed.
   */
  source: z.enum(['link', 'id']).default('link'),
  value: z.string(),
  caption: z.string().default(''),
  /** Shown as the file name for documents. */
  filename: z.string().optional(),
})

const button = z.object({
  id: z.string(),
  title: z.string(),
})

const sendButtonsData = z.object({
  kind: z.literal('sendButtons'),
  header: z.string().optional(),
  /** Image shown above the body. Meta allows one media header per message. */
  headerImage: z.string().optional(),
  body: z.string(),
  footer: z.string().optional(),
  buttons: z.array(button),
})

const listRow = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
})

const sendListData = z.object({
  kind: z.literal('sendList'),
  header: z.string().optional(),
  body: z.string(),
  footer: z.string().optional(),
  buttonText: z.string(),
  sections: z
    .array(
      z.object({
        title: z.string(),
        rows: z.array(listRow),
      }),
    ),
})

const sendTemplateData = z.object({
  kind: z.literal('sendTemplate'),
  templateName: z.string(),
  language: z.string().default('id'),
  /** Positional body parameters, each a literal or a {{variable}}. */
  bodyParams: z.array(z.string()).default([]),
  /** Header variable, or the media link for an image/video/document header. */
  headerParam: z.string().default(''),
})

const waitReplyData = z.object({
  kind: z.literal('waitReply'),
  saveAs: z.string(),
  expect: z.enum(['any', 'text', 'number', 'email', 'phone', 'media', 'location']).default('any'),
  invalidMessage: z.string().optional(),
  maxRetries: z.number().int().min(0).max(5).default(2),
  timeoutMinutes: z.number().int().min(0).default(60),
})

const conditionData = z.object({
  kind: z.literal('condition'),
  variable: z.string(),
  operator: z.enum(['eq', 'neq', 'contains', 'startsWith', 'gt', 'lt', 'isSet', 'isEmpty']),
  value: z.string().default(''),
  caseSensitive: z.boolean().default(false),
})

const setVariableData = z.object({
  kind: z.literal('setVariable'),
  name: z.string(),
  value: z.string(),
})

const httpRequestData = z.object({
  kind: z.literal('httpRequest'),
  method: z.enum(['GET', 'POST']).default('GET'),
  /** Values interpolated into the URL are percent-encoded. */
  url: z.string(),
  /** One `Name: value` per line. Values may hold {{variables}}. */
  headers: z.string().default(''),
  /** JSON sent with POST. Interpolated values are JSON-escaped. */
  body: z.string().default(''),
  /** The parsed response lands here; read it with {{saveAs.path.to.field}}. */
  saveAs: z.string(),
  timeoutSeconds: z.number().int().min(1).max(30).default(15),
})

const askAiData = z.object({
  kind: z.literal('askAi'),
  /** An AiEndpoint id. The URL, key and answer format live there, not here. */
  endpointId: z.string().default(''),
  /** Name of the variable holding the question, usually a waitReply's saveAs. */
  question: z.string().default('pertanyaan'),
  /** Send the answer to the contact straight away. */
  sendAnswer: z.boolean().default(true),
  /**
   * Label of a reply button sent under the answer, e.g. "Selesai". Empty
   * sends plain text. The button does not park the run like Kirim tombol
   * does: a following Tunggu balasan receives the tap as its label, or any
   * typed follow-up question, which is what a question-answer loop needs.
   */
  endButton: z.string().default(''),
  /** The answer text is also kept here, for a later node to use. */
  saveAs: z.string().default('jawaban_ai'),
})

/**
 * Sends the contact's question and the flow's menu destinations to a router
 * endpoint, then jumps straight to the destination it picks - skipping every
 * menu in between, each of which is a billed message.
 *
 * It has no "success" output: where it goes on success is decided at
 * runtime by the menu row picked, not by an edge. The only message it sends
 * itself is the "Maksud Anda" list, when `clarify` is on.
 */
const aiRouteData = z.object({
  kind: z.literal('aiRoute'),
  /** An AiEndpoint id of kind ROUTE. */
  endpointId: z.string().default(''),
  /** Variable holding the question; the worker fills pesan_awal on start. */
  question: z.string().default(ROUTE_QUESTION_VARIABLE),
  /** A pick scoring below this takes the "unsure" branch instead. 0 to 1. */
  minScore: z.number().default(0.7),
  /**
   * When unsure, offer the router's closest destinations as a list ("Maksud
   * Anda: ...") before giving up: one tap still lands on the right answer.
   * Off unless set, so a worker deploy never changes what a published flow
   * sends.
   */
  clarify: z.boolean().default(false),
  /** Candidates scoring below this are not offered. 0 to 1. */
  clarifyMinScore: z.number().default(0.5),
  clarifyBody: z.string().default(ROUTE_CLARIFY_BODY),
  /** The decision is kept here: { id, score, path }. */
  saveAs: z.string().default('arah_ai'),
})

const delayData = z.object({
  kind: z.literal('delay'),
  seconds: z.number().int().min(0),
})

const assignData = z.object({
  kind: z.literal('assign'),
  userId: z.string().nullable().default(null),
  note: z.string().max(200).optional(),
})

const tagData = z.object({
  kind: z.literal('tag'),
  action: z.enum(['add', 'remove']),
  tags: z.array(z.string()),
})

const handoverData = z.object({
  kind: z.literal('handover'),
  message: z.string().optional(),
})

const endData = z.object({
  kind: z.literal('end'),
  reason: z.string().max(200).optional(),
})

export const nodeDataSchema = z.discriminatedUnion('kind', [
  triggerData,
  sendTextData,
  sendMediaData,
  sendButtonsData,
  sendListData,
  sendTemplateData,
  waitReplyData,
  conditionData,
  setVariableData,
  httpRequestData,
  askAiData,
  aiRouteData,
  delayData,
  assignData,
  tagData,
  handoverData,
  endData,
])

export type NodeData = z.infer<typeof nodeDataSchema>

export const flowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(NODE_KINDS),
  position,
  data: nodeDataSchema,
})

export const flowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  /**
   * Which output the edge leaves from. For a buttons node this is the button
   * id; for a condition it is "true" or "false"; for a waitReply it is
   * "reply" or "timeout"; for an httpRequest or askAi it is "success" or
   * "error"; for an aiRoute it is "unsure" or "error". Absent means the
   * node's single default output.
   */
  sourceHandle: z.string().nullish(),
})

export const flowGraphSchema = z.object({
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
})

export type FlowNode = z.infer<typeof flowNodeSchema>
export type FlowEdge = z.infer<typeof flowEdgeSchema>
export type FlowGraph = z.infer<typeof flowGraphSchema>

export const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] }

/** Outputs a node exposes, in the order the editor should render them. */
export function handlesOf(node: FlowNode): { id: string | null; label: string }[] {
  switch (node.data.kind) {
    case 'sendButtons':
      return node.data.buttons.map((b) => ({ id: b.id, label: b.title }))
    case 'sendList':
      return node.data.sections.flatMap((s) =>
        s.rows.map((r) => ({ id: r.id, label: r.title })),
      )
    case 'condition':
      return [
        { id: 'true', label: 'ya' },
        { id: 'false', label: 'tidak' },
      ]
    case 'waitReply':
      return [
        { id: 'reply', label: 'dibalas' },
        { id: 'timeout', label: 'tidak dibalas' },
      ]
    case 'httpRequest':
    case 'askAi':
      return [
        { id: 'success', label: 'berhasil' },
        { id: 'error', label: 'gagal' },
      ]
    case 'aiRoute':
      return [
        { id: 'unsure', label: 'tidak cocok' },
        { id: 'error', label: 'gagal' },
      ]
    case 'end':
      return []
    default:
      return [{ id: null, label: '' }]
  }
}

/** Nodes that hand control back to the contact and pause the run. */
export function isWaitingNode(kind: NodeKind) {
  return kind === 'waitReply' || kind === 'sendButtons' || kind === 'sendList'
}

/** Nodes that put a message on the wire, and so are subject to the 24h window. */
export function isSendingNode(kind: NodeKind) {
  return kind.startsWith('send')
}
