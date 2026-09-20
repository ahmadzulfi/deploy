import type { FlowGraph, FlowNode } from './schema.js'

/**
 * What an inbound WhatsApp message looks like to the trigger matcher.
 * Deliberately narrower than the webhook event: the matcher should not need
 * to know about Meta's payload shape.
 */
export interface InboundSignal {
  /** Text body, or the visible label of a tapped button. */
  text?: string
  /** Reply id of a tapped button or picked list row. */
  replyId?: string
  /** True when this is the contact's first message in a new conversation. */
  isNewConversation?: boolean
}

export interface TriggerMatch {
  node: FlowNode
  /** Which value matched, useful for logging why a flow fired. */
  matched: string
}

/**
 * Finds the first trigger in a graph that this message fires.
 *
 * Button payloads are checked before text, because a tapped button also
 * carries its label as text and matching the label would fire the wrong flow
 * whenever a button title happens to contain a keyword.
 */
export function matchTrigger(graph: FlowGraph, signal: InboundSignal): TriggerMatch | null {
  const triggers = graph.nodes.filter((n) => n.data.kind === 'trigger')

  if (signal.replyId) {
    for (const node of triggers) {
      if (node.data.kind !== 'trigger' || node.data.match !== 'buttonPayload') continue
      const hit = node.data.values.find((v) => v.trim() === signal.replyId)
      if (hit) return { node, matched: hit }
    }
  }

  const text = (signal.text ?? '').trim()

  for (const node of triggers) {
    if (node.data.kind !== 'trigger') continue
    const d = node.data

    if (d.match === 'newConversation') {
      if (signal.isNewConversation) return { node, matched: 'percakapan baru' }
      continue
    }

    // Fired by an explicit API call, never by an incoming message.
    if (d.match === 'api' || d.match === 'buttonPayload') continue
    if (!text) continue

    const haystack = d.caseSensitive ? text : text.toLowerCase()

    for (const raw of d.values) {
      const value = raw.trim()
      if (!value) continue
      const needle = d.caseSensitive ? value : value.toLowerCase()

      if (d.match === 'exact' && haystack === needle) return { node, matched: value }
      if (d.match === 'keyword' && haystack.includes(needle)) return { node, matched: value }
      if (d.match === 'regex') {
        try {
          if (new RegExp(value, d.caseSensitive ? '' : 'i').test(text)) return { node, matched: value }
        } catch {
          // An invalid regex is reported by validateFlow at publish time; at
          // runtime it must not take the whole inbound pipeline down.
        }
      }
    }
  }

  return null
}

/** The node an edge leads to, given the output handle taken. */
export function nextNodeId(
  graph: FlowGraph,
  fromId: string,
  handle: string | null = null,
): string | null {
  const edge = graph.edges.find(
    (e) => e.source === fromId && (e.sourceHandle ?? null) === handle,
  )
  return edge?.target ?? null
}
