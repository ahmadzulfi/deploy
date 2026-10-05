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
  description: string
  /** The start of what the contact receives there, as plain text. */
  content: string
  /** Node the engine continues at. Internal; never sent to the router. */
  target: string
}

export const ROUTE_PATH_SEPARATOR = ' › '
export const ROUTE_CONTENT_MAX = 500

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
          out.push({
            id: (rowUses.get(row.id) ?? 0) > 1 ? `${row.id}@${node.id}` : row.id,
            path: rowPath.join(ROUTE_PATH_SEPARATOR),
            description: row.description ?? '',
            content: contentAt(edge.target, byId, outgoing),
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
