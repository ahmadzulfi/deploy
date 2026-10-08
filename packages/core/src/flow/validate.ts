import { WA_LIMITS } from '../providers/limits.js'
import { buildRouteCatalog, ROUTE_HINT_MAX } from './catalog.js'
import {
  handlesOf,
  isSendingNode,
  isWaitingNode,
  ROUTE_QUESTION_VARIABLE,
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
export interface ValidateOptions {
  /**
   * Ids of the org's saved AI endpoints. When given, a "Tanya AI" node naming
   * one that no longer exists is an error; left out, that check is skipped.
   */
  aiEndpointIds?: ReadonlySet<string>
  /**
   * What each of those endpoints is for. When given, a Tanya AI node on a
   * router endpoint, or an Arahkan AI node on an answering one, is an error.
   */
  aiEndpointKinds?: ReadonlyMap<string, 'ANSWER' | 'ROUTE'>
}

export function validateFlow(graph: FlowGraph, opts: ValidateOptions = {}): FlowIssue[] {
  const issues: FlowIssue[] = []
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const assigned = assignedVariables(graph)

  const triggers = graph.nodes.filter((n) => n.data.kind === 'trigger')
  if (triggers.length === 0) {
    issues.push({ severity: 'error', message: 'Flow butuh minimal satu node Trigger.' })
  }

  const fallbacks = triggers.filter((n) => n.data.kind === 'trigger' && n.data.match === 'fallback')
  if (fallbacks.length > 1) {
    issues.push({
      severity: 'warning',
      nodeId: fallbacks[1]!.id,
      message: 'Ada lebih dari satu Trigger "tidak cocok kata kunci" — hanya yang pertama yang dipakai.',
    })
  }

  if (graph.nodes.some((n) => n.data.kind === 'aiRoute') && buildRouteCatalog(graph).length === 0) {
    issues.push({
      severity: 'error',
      nodeId: graph.nodes.find((n) => n.data.kind === 'aiRoute')!.id,
      message: 'Arahkan AI butuh menu: flow ini belum punya node Kirim list dengan baris yang tersambung.',
    })
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
    issues.push(...checkNode(node, opts, assigned))

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

/** Variable names some node in the graph writes to. */
export function assignedVariables(graph: FlowGraph): Set<string> {
  // Filled by the worker for every session an inbound message starts.
  const names = new Set<string>([ROUTE_QUESTION_VARIABLE])
  for (const n of graph.nodes) {
    const d = n.data
    if (d.kind === 'waitReply' || d.kind === 'httpRequest' || d.kind === 'askAi' || d.kind === 'aiRoute') {
      names.add(d.saveAs)
    }
    if (d.kind === 'setVariable') names.add(d.name)
  }
  return names
}

const VARIABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function checkNode(node: FlowNode, opts: ValidateOptions, assigned: Set<string>): FlowIssue[] {
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
      for (const r of d.sections.flatMap((s) => s.rows)) {
        if ((r.description?.length ?? 0) > WA_LIMITS.list.rowDescriptionMax) {
          out.push({
            severity: 'error',
            nodeId: node.id,
            message: `Keterangan baris "${r.title}" lebih dari ${WA_LIMITS.list.rowDescriptionMax} karakter.`,
          })
        }
        if ((r.aiHint?.length ?? 0) > ROUTE_HINT_MAX) {
          out.push({
            severity: 'error',
            nodeId: node.id,
            message: `Petunjuk AI baris "${r.title}" lebih dari ${ROUTE_HINT_MAX} karakter.`,
          })
        }
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
      // 0 reads as "wait forever" but schedules a timeout due immediately,
      // so the node gives up before the contact can type a word.
      if (d.timeoutMinutes < 1) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: 'Batas tunggu harus minimal 1 menit.',
        })
      }
      break

    case 'httpRequest':
      if (!/^https?:\/\/\S+$/.test(d.url.trim())) {
        out.push({ severity: 'error', nodeId: node.id, message: 'URL harus diawali http:// atau https://.' })
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(d.saveAs)) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: `"${d.saveAs}" bukan nama variabel yang valid.`,
        })
      } else if (['contact', 'channel', 'system'].includes(d.saveAs)) {
        // These prefixes resolve to built-in values first, so the saved
        // response could never be read back.
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: `"${d.saveAs}" dipakai sistem, pilih nama lain.`,
        })
      }
      if (d.method === 'POST' && d.body.trim()) {
        // Parse with every {{variable}} blanked out: the author's JSON must
        // be valid on its own, since values are escaped into it at runtime.
        try {
          JSON.parse(d.body.replace(/\{\{\s*[\w.]+\s*\}\}/g, ''))
        } catch {
          out.push({ severity: 'error', nodeId: node.id, message: 'Body bukan JSON yang valid.' })
        }
      }
      break

    case 'askAi':
      if (!d.endpointId) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Tanya AI: pilih AI yang dipakai.' })
      } else if (opts.aiEndpointIds && !opts.aiEndpointIds.has(d.endpointId)) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: 'Tanya AI: AI yang dipilih sudah dihapus. Pilih lagi.',
        })
      } else if (opts.aiEndpointKinds?.get(d.endpointId) === 'ROUTE') {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: 'Tanya AI: AI yang dipilih jenisnya "Arahkan ke menu". Pilih AI jenis "Jawab pertanyaan".',
        })
      }
      if (!d.question.trim()) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Tanya AI: pilih variabel pertanyaannya.' })
      } else if (!assigned.has(d.question)) {
        // A warning, not an error: a flow started through the API may pass
        // the variable in from outside.
        out.push({
          severity: 'warning',
          nodeId: node.id,
          message: `Tanya AI: variabel {{${d.question}}} tidak pernah diisi di flow ini. Tambahkan node Tunggu balasan yang menyimpan ke "${d.question}".`,
        })
      }
      if (!VARIABLE_NAME.test(d.saveAs)) {
        out.push({ severity: 'error', nodeId: node.id, message: `"${d.saveAs}" bukan nama variabel yang valid.` })
      } else if (['contact', 'channel', 'system'].includes(d.saveAs)) {
        out.push({ severity: 'error', nodeId: node.id, message: `"${d.saveAs}" dipakai sistem, pilih nama lain.` })
      }
      if (d.sendAnswer && d.endButton.trim().length > WA_LIMITS.buttons.titleMax) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: `Tanya AI: label tombol maksimal ${WA_LIMITS.buttons.titleMax} karakter.`,
        })
      }
      break

    case 'aiRoute':
      if (!d.endpointId) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Arahkan AI: pilih AI yang dipakai.' })
      } else if (opts.aiEndpointIds && !opts.aiEndpointIds.has(d.endpointId)) {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: 'Arahkan AI: AI yang dipilih sudah dihapus. Pilih lagi.',
        })
      } else if (opts.aiEndpointKinds?.get(d.endpointId) === 'ANSWER') {
        out.push({
          severity: 'error',
          nodeId: node.id,
          message: 'Arahkan AI: AI yang dipilih jenisnya "Jawab pertanyaan". Pilih AI jenis "Arahkan ke menu".',
        })
      }
      if (!d.question.trim()) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Arahkan AI: pilih variabel pertanyaannya.' })
      } else if (!assigned.has(d.question)) {
        out.push({
          severity: 'warning',
          nodeId: node.id,
          message: `Arahkan AI: variabel {{${d.question}}} tidak pernah diisi di flow ini.`,
        })
      }
      if (!(d.minScore >= 0 && d.minScore <= 1)) {
        out.push({ severity: 'error', nodeId: node.id, message: 'Arahkan AI: batas skor harus antara 0 dan 1.' })
      }
      if (d.clarify) {
        if (!(d.clarifyMinScore >= 0 && d.clarifyMinScore <= 1)) {
          out.push({ severity: 'error', nodeId: node.id, message: 'Arahkan AI: skor minimal pilihan harus antara 0 dan 1.' })
        }
        if (d.clarifyBody.length > WA_LIMITS.interactive.bodyMax) {
          out.push({
            severity: 'error',
            nodeId: node.id,
            message: `Arahkan AI: teks "Maksud Anda" lebih dari ${WA_LIMITS.interactive.bodyMax} karakter.`,
          })
        }
      }
      if (!VARIABLE_NAME.test(d.saveAs)) {
        out.push({ severity: 'error', nodeId: node.id, message: `"${d.saveAs}" bukan nama variabel yang valid.` })
      } else if (['contact', 'channel', 'system'].includes(d.saveAs)) {
        out.push({ severity: 'error', nodeId: node.id, message: `"${d.saveAs}" dipakai sistem, pilih nama lain.` })
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
  httpRequest: 'Panggil API',
  askAi: 'Tanya AI',
  aiRoute: 'Arahkan AI',
  delay: 'Jeda',
  assign: 'Tugaskan agen',
  tag: 'Tag kontak',
  handover: 'Alihkan ke manusia',
  end: 'Selesai',
}
