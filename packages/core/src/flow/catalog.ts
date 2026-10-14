import type { FlowEdge, FlowGraph, FlowNode } from './schema.js'

/**
 * The menu destinations Arahkan AI may jump to, built from the flow itself.
 *
 * Every list row the menus lead to forward is a destination, named by the
 * row titles a contact would have tapped to reach it. Nobody maintains a
 * second mapping: renaming or adding a menu row changes what the router
 * sees on the next publish.
 *
 * Pure, so the editor can preview exactly what the worker will send.
 */

export interface RouteDestination {
  /**
   * The row id, or `rowId@listNodeId` when another list uses the same row id.
   * The editor numbers rows row_1, row_2, ... in every list, so bare ids
   * collide in any hand-built flow.
   */
  id: string
  /** Row titles from the first menu down to this one, joined by " › ". */
  path: string
  /** The row's description, then its Petunjuk AI, joined by " — ". */
  description: string
  /**
   * The start of what the contact receives there, as plain text. Empty when
   * the row has a Petunjuk AI, which says the same thing better.
   */
  content: string
  /** Node the engine continues at. Internal; never sent to the router. */
  target: string
}

export const ROUTE_PATH_SEPARATOR = ' › '
export const ROUTE_CONTENT_MAX = 500
/** Longest Petunjuk AI a row may carry. */
export const ROUTE_HINT_MAX = 500

/** Nodes a content lookup may walk past to reach the message behind them. */
const SILENT_KINDS = new Set(['tag', 'setVariable', 'assign'])
const CONTENT_LOOKAHEAD = 5

export function buildRouteCatalog(graph: FlowGraph): RouteDestination[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const outgoing = new Map<string, FlowEdge[]>()
  for (const e of graph.edges) outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e])

  const rowUses = new Map<string, number>()
  for (const n of graph.nodes) {
    if (n.data.kind !== 'sendList') continue
    for (const s of n.data.sections) for (const r of s.rows) rowUses.set(r.id, (rowUses.get(r.id) ?? 0) + 1)
  }

  const out: RouteDestination[] = []
  const triggers = graph.nodes.filter((n) => n.data.kind === 'trigger')
  const seen = new Set(triggers.map((t) => t.id))
  const queue: { id: string; path: string[] }[] = triggers.map((t) => ({ id: t.id, path: [] }))

  // Breadth first, so a node is claimed by the shortest way into it. An edge
  // to a node already claimed points back up the tree - "Menu Utama",
  // "Kembali" - and is navigation, not somewhere a question could lead.
  while (queue.length) {
    const { id, path } = queue.shift()!
    const node = byId.get(id)
    if (!node) continue
    const edges = outgoing.get(id) ?? []

    if (node.data.kind === 'sendList') {
      for (const section of node.data.sections) {
        for (const row of section.rows) {
          const edge = edges.find((e) => e.sourceHandle === row.id)
          if (!edge || seen.has(edge.target) || !byId.has(edge.target)) continue
          seen.add(edge.target)

          const rowPath = [...path, row.title]
          const hint = row.aiHint?.trim() ?? ''
          out.push({
            id: (rowUses.get(row.id) ?? 0) > 1 ? `${row.id}@${node.id}` : row.id,
            path: rowPath.join(ROUTE_PATH_SEPARATOR),
            description: [row.description?.trim(), hint].filter(Boolean).join(' — '),
            // A hint is the admin saying what this row is about. The message
            // then only adds noise: greetings like "Halo Wargi Cimahi!" read
            // as close to every question.
            content: hint ? '' : contentAt(edge.target, byId, outgoing),
            target: edge.target,
          })
          queue.push({ id: edge.target, path: rowPath })
        }
      }
      continue
    }

    for (const e of edges) {
      if (seen.has(e.target)) continue
      seen.add(e.target)
      queue.push({ id: e.target, path })
    }
  }

  return out
}

/** What a destination's first message says, walking past silent nodes. */
function contentAt(start: string, byId: Map<string, FlowNode>, outgoing: Map<string, FlowEdge[]>): string {
  let id: string | undefined = start
  for (let step = 0; id && step < CONTENT_LOOKAHEAD; step++) {
    const d: FlowNode['data'] | undefined = byId.get(id)?.data
    if (!d) return ''
    if (d.kind === 'sendText' || d.kind === 'sendButtons' || d.kind === 'sendList') return plain(d.body)
    if (d.kind === 'sendMedia') return plain(d.caption)
    if (!SILENT_KINDS.has(d.kind)) return ''
    id = (outgoing.get(id) ?? []).find((e) => (e.sourceHandle ?? null) === null)?.target
  }
  return ''
}

/**
 * Whether a message carries enough to route at all.
 *
 * "P", "Q", "ok", "?" and "11" are how people nudge a chat, not questions,
 * yet embeddings score them close to real menus: "P" got 0.61 against the
 * Cimahi menu, a hair under the bar. Routing one costs a call and, with
 * "Maksud Anda" on, shows three random menus whose random tap would then be
 * kept as if the contact meant it. One word of three letters or more, not
 * all the same letter, is enough: "ktp", "skck", "sim".
 */
export function isRoutableQuestion(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .some((w) => [...w].length >= 3 && new Set(w).size >= 2)
}

/** Longest question kept for review. */
export const ROUTE_QUESTION_KEEP_MAX = 1000

/**
 * A contact's question as it may be kept for review. Digit runs long enough
 * to be an NIK, a phone or an account number, and email addresses, are
 * replaced; short numbers stay, since "RT 05" or "SIM C 2026" help an admin
 * read the question.
 */
export function maskRouteQuestion(text: string): string {
  const masked = text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\+?\d(?:[\s.-]?\d){5,}/g, '[angka]')
    .trim()
  return masked.length > ROUTE_QUESTION_KEEP_MAX ? masked.slice(0, ROUTE_QUESTION_KEEP_MAX) : masked
}

/** WhatsApp markup and {{variables}} out, one line break at most. */
function plain(text: string): string {
  const clean = text
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[*_~]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return clean.length > ROUTE_CONTENT_MAX ? `${clean.slice(0, ROUTE_CONTENT_MAX - 1)}…` : clean
}
