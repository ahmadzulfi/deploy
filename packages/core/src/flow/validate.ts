import { WA_LIMITS } from '../providers/limits.js'
import {
  handlesOf,
  isSendingNode,
  isWaitingNode,
  type FlowGraph,
  type FlowNode,
} from './schema.js'

export interface FlowIssue {
  severity: 'error' | 'warning'
  nodeId?: string
  message: string
}

/**
 * Pre-publish checks.
 *
 * Errors block publishing; warnings do not. The split is deliberate: a flow
 * that cannot run is an error, while a flow that will probably misbehave at
 * runtime - a send after a long delay, a loop with no pause - is a warning,
 * because sometimes that is genuinely what the author meant.
 */
export function validateFlow(graph: FlowGraph): FlowIssue[] {
  const issues: FlowIssue[] = []
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  const triggers = graph.nodes.filter((n) => n.data.kind === 'trigger')
  if (triggers.length === 0) {
    issues.push({ severity: 'error', message: 'Flow butuh minimal satu node Trigger.' })
  }

  for (const e of graph.edges) {
    if (!byId.has(e.source)) {
      issues.push({ severity: 'error', message: `Koneksi menunjuk node sumber yang tidak ada.` })
    }
    if (!byId.has(e.target)) {
      issues.push({ severity: 'error', message: `Koneksi menunjuk node tujuan yang tidak ada.` })
    }
  }

  const outgoing = new Map<string, Set<string | null>>()
  for (const e of graph.edges) {
    const set = outgoing.get(e.source) ?? new Set()
    set.add(e.sourceHandle ?? null)
    outgoing.set(e.source, set)
  }

  for (const node of graph.nodes) {
    issues.push(...checkNode(node))

    // Handover ends the run as surely as End does - the engine halts and the
    // conversation belongs to an agent from then on - so requiring an outgoing
    // edge would reject a perfectly correct flow.
    if (node.data.kind === 'end' || node.data.kind === 'handover') continue

    const handles = handlesOf(node)
    const wired = outgoing.get(node.id) ?? new Set()

    if (wired.size === 0) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        message: `${label(node)} tidak terhubung ke mana pun.`,
      })
      continue
    }

    // A button with no edge is a dead end for whoever taps it - the flow just
    // stops with no reply, which looks like a broken bot to the contact.
    for (const h of handles) {
      if (h.id !== null && !wired.has(h.id)) {
        issues.push({
          severity: 'warning',
          nodeId: node.id,
          message: `${label(node)}: cabang "${h.label}" belum terhubung.`,
        })
      }
    }
  }

  issues.push(...checkReachability(graph, triggers))
  issues.push(...checkWindowRisk(graph, byId))
  issues.push(...checkLoops(graph, byId))

  return issues
}

function checkNode(node: FlowNode): FlowIssue[] {
  const out: FlowIssue[] = []
  const d = node.data

  switch (d.kind) {
    case 'trigger':
      if (
        ['keyword', 'exact', 'regex', 'buttonPayload'].includes(d.match) &&
        d.values.filter((v) => v.trim()).length === 0
      ) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Trigger belum punya kata kunci.' })
      }
      if (d.match === 'regex') {
        for (const v of d.values) {
          try {
            new RegExp(v)
          } catch {
            out.push({ severity: 'error', nodeId: node.id, message: `Regex tidak valid: ${v}` })
          }
        }
      }
      break

    case 'sendText':
      if (!d.body.trim()) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Pesan teks masih kosong.' })
      }
      break

    case 'sendMedia':
      if (!d.value.trim()) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: d.source === 'link' ? 'URL media masih kosong.' : 'Media ID masih kosong.',
        })
      } else if (d.source === 'link' && !/^https:\/\//.test(d.value.trim())) {
        // Meta fetches the file itself and refuses plain http.
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: 'URL media harus https dan bisa diakses publik oleh Meta.',
        })
      }
      if (d.caption.length > WA_LIMITS.interactive.bodyMax) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: `Caption ${d.caption.length} karakter, maksimum ${WA_LIMITS.interactive.bodyMax}.`,
        })
      }
      if (d.media === 'audio' && d.caption.trim()) {
        out.push({
          severity: 'warning',
          nodeId: node.id,
          message: 'WhatsApp mengabaikan caption pada pesan audio.',
        })
      }
      break

    case 'sendButtons': {
      if (!d.body.trim()) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Isi pesan tombol masih kosong.' })
      }
      // Interactive bodies cap at 1024, a quarter of a plain text message.
      // A long menu with a button attached is the usual way to hit this.
      if (d.body.length > WA_LIMITS.interactive.bodyMax) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: `Isi pesan ${d.body.length} karakter, maksimum ${WA_LIMITS.interactive.bodyMax} untuk pesan bertombol. Pecah jadi node Kirim teks lalu node tombol.`,
        })
      }
      if (d.buttons.length > WA_LIMITS.buttons.max) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: `${d.buttons.length} tombol — WhatsApp maksimum ${WA_LIMITS.buttons.max}.`,
        })
      }
      const seen = new Set<string>()
      for (const b of d.buttons) {
        if (seen.has(b.id)) {
          out.push({
            severity: 'error',
            nodeId: node.id,
            message: `ID tombol "${b.id}" dobel — balasan jadi ambigu.`,
          })
        }
        seen.add(b.id)
        if (b.title.length > WA_LIMITS.buttons.titleMax) {
          out.push({
            severity: 'error',
            nodeId: node.id,
            message: `Judul tombol "${b.title}" ${b.title.length} karakter, maksimum ${WA_LIMITS.buttons.titleMax}.`,
          })
        }
      }
      break
    }

    case 'sendList': {
      if (d.body.length > WA_LIMITS.interactive.bodyMax) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: `Isi pesan ${d.body.length} karakter, maksimum ${WA_LIMITS.interactive.bodyMax} untuk pesan list.`,
        })
      }
      if (!d.buttonText.trim()) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Teks tombol pembuka masih kosong.' })
      }

      const rows = d.sections.reduce((n, s) => n + s.rows.length, 0)
      if (rows === 0) {
        out.push({ severity: 'error', nodeId: node.id, message: 'List belum punya baris.' })
      }
      if (rows > WA_LIMITS.list.totalRowsMax) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: `${rows} baris di semua seksi — WhatsApp maksimum ${WA_LIMITS.list.totalRowsMax}.`,
        })
      }
      break
    }

    case 'sendTemplate':
      if (!d.templateName.trim()) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Template belum dipilih.' })
      }
      break

    case 'waitReply':
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(d.saveAs)) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: `"${d.saveAs}" bukan nama variabel yang valid.`,
        })
      }
      break

    case 'condition':
      if (!d.variable.trim()) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Kondisi belum punya variabel.' })
      }
      break

    case 'delay':
      if (d.seconds < 1) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Jeda harus minimal 1 detik.' })
      }
      break

    case 'tag':
      if (d.tags.filter((t) => t.trim()).length === 0) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Belum ada tag yang diisi.' })
      }
      break
  }

  return out
}

/** Nodes the trigger can never reach are dead weight and usually a mistake. */
function checkReachability(graph: FlowGraph, triggers: FlowNode[]): FlowIssue[] {
  if (triggers.length === 0) return []

  const adjacency = new Map<string, string[]>()
  for (const e of graph.edges) {
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target])
  }

  const seen = new Set(triggers.map((t) => t.id))
  const queue = [...seen]
  while (queue.length) {
    for (const next of adjacency.get(queue.shift()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }

  return graph.nodes
    .filter((n) => !seen.has(n.id))
    .map((n) => ({
      severity: 'warning' as const,
      nodeId: n.id,
      message: `${label(n)} tidak pernah tercapai dari Trigger.`,
    }))
}

/**
 * A free-form send placed after a long pause will hit a closed 24h window.
 * The author usually wants an approved template there instead.
 */
function checkWindowRisk(graph: FlowGraph, byId: Map<string, FlowNode>): FlowIssue[] {
  const out: FlowIssue[] = []
  const windowMs = WA_LIMITS.customerServiceWindowHours * 3_600_000

  for (const edge of graph.edges) {
    const from = byId.get(edge.source)
    const to = byId.get(edge.target)
    if (!from || !to || !isSendingNode(to.data.kind) || to.data.kind === 'sendTemplate') continue

    let pauseMs = 0
    if (from.data.kind === 'delay') pauseMs = from.data.seconds * 1000
    if (from.data.kind === 'waitReply' && edge.sourceHandle === 'timeout') {
      pauseMs = from.data.timeoutMinutes * 60_000
    }

    if (pauseMs >= windowMs) {
      out.push({
        severity: 'warning',
        nodeId: to.id,
        message: `${label(to)} dikirim setelah jeda ≥ 24 jam — window kemungkinan sudah tertutup. Pakai node Template.`,
      })
    }
  }

  return out
}

/**
 * A cycle with no waiting node spins as fast as the engine can run it. The
 * step budget stops it, but the contact still gets a burst of messages first.
 */
function checkLoops(graph: FlowGraph, byId: Map<string, FlowNode>): FlowIssue[] {
  const adjacency = new Map<string, string[]>()
  for (const e of graph.edges) {
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target])
  }

  const out: FlowIssue[] = []
  const reported = new Set<string>()
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const colour = new Map<string, number>()

  function visit(id: string, path: string[]) {
    colour.set(id, GRAY)
    for (const next of adjacency.get(id) ?? []) {
      const c = colour.get(next) ?? WHITE
      if (c === GRAY) {
        const cycle = path.slice(path.indexOf(next))
        const pauses = cycle.some((n) => {
          const node = byId.get(n)
          return node ? isWaitingNode(node.data.kind) || node.data.kind === 'delay' : false
        })
        const key = [...cycle].sort().join('|')
        if (!pauses && !reported.has(key)) {
          reported.add(key)
          out.push({
            severity: 'warning',
            nodeId: next,
            message: 'Ada perulangan tanpa jeda atau menunggu balasan — bisa mengirim pesan beruntun.',
          })
        }
      } else if (c === WHITE) {
        visit(next, [...path, next])
      }
    }
    colour.set(id, BLACK)
  }

  for (const n of graph.nodes) {
    if ((colour.get(n.id) ?? WHITE) === WHITE) visit(n.id, [n.id])
  }

  return out
}

export function label(node: FlowNode) {
  return NODE_LABELS[node.data.kind] ?? node.data.kind
}

export const NODE_LABELS: Record<string, string> = {
  trigger: 'Trigger',
  sendText: 'Kirim teks',
  sendMedia: 'Kirim media',
  sendButtons: 'Kirim tombol',
  sendList: 'Kirim list',
  sendTemplate: 'Kirim template',
  waitReply: 'Tunggu balasan',
  condition: 'Kondisi',
  setVariable: 'Set variabel',
  delay: 'Jeda',
  assign: 'Tugaskan agen',
  tag: 'Tag kontak',
  handover: 'Alihkan ke manusia',
  end: 'Selesai',
}
