import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { runFlow, MAX_STEPS_PER_TICK, type EngineEffects, type RoutePick, type SessionState } from '../src/flow/engine.ts'
import { findFallbackTrigger, matchTrigger } from '../src/flow/match.ts'
import type { FlowGraph, FlowNode } from '../src/flow/schema.ts'
import type { FlowContext } from '../src/flow/runtime.ts'

const at = { x: 0, y: 0 }
const node = (id: string, data: FlowNode['data']): FlowNode => ({ id, type: data.kind, position: at, data })
const edge = (id: string, source: string, target: string, sourceHandle: string | null = null) => ({
  id,
  source,
  target,
  sourceHandle,
})

const ctx: FlowContext = {
  variables: {},
  contact: { name: 'Ahmad', waId: '6283148307731', attributes: { kota: 'Bandung' }, tags: [] },
  channel: { name: 'CS Utama', displayPhone: '+62 851' },
}

type HttpCall = Parameters<EngineEffects['httpRequest']>[0]

/** Records every effect instead of performing it. */
function spy(
  http: (p: HttpCall) => Promise<{ status: number; data: unknown }> = async () => ({ status: 200, data: {} }),
  ai: (p: { endpointId: string; question: string }) => Promise<{ answer: string }> = async () => ({ answer: '' }),
  route: (p: RouteCall) => Promise<RoutePick> = async () => ({ destinationId: null, score: 0, candidates: [] }),
) {
  const calls: string[] = []
  const requests: HttpCall[] = []
  const routes: RouteCall[] = []
  const lists: ListCall[] = []
  const fx: EngineEffects = {
    async httpRequest(p) { requests.push(p); return http(p) },
    async askAi(p) { calls.push(`ai:${p.endpointId}:${p.question}`); return ai(p) },
    async routeAi(p) { routes.push(p); calls.push(`route:${p.endpointId}:${p.question}`); return route(p) },
    async sendText(b) { calls.push(`text:${b}`) },
    async sendMedia(p) { calls.push(`media:${p.media}:${p.source}:${p.value}:${p.caption ?? ''}`) },
    async sendButtons(p) { calls.push(`buttons:${p.headerImage ? p.headerImage + ':' : ''}${p.body}[${p.buttons.map((b) => b.id).join('|')}]`) },
    async sendList(p) { lists.push(p); calls.push(`list:${p.body}`) },
    async sendTemplate(p) { calls.push(`template:${p.name}(${p.bodyParams.join(',')})`) },
    async changeTags(a, t) { calls.push(`tags:${a}:${t.join(',')}`) },
    async assign(u) { calls.push(`assign:${u ?? 'auto'}`) },
    async handover() { calls.push('handover') },
  }
  return { calls, requests, routes, lists, fx }
}

type RouteCall = Parameters<EngineEffects['routeAi']>[0]
type ListCall = Parameters<EngineEffects['sendList']>[0]

let state: SessionState
beforeEach(() => {
  state = { currentNodeId: null, variables: {}, stepCount: 0, retries: 0 }
})

describe('trigger matching', () => {
  const graph: FlowGraph = {
    nodes: [
      node('kw', { kind: 'trigger', match: 'keyword', values: ['menu', 'halo'], caseSensitive: false }),
      node('btn', { kind: 'trigger', match: 'buttonPayload', values: ['btn_promo'], caseSensitive: false }),
    ],
    edges: [],
  }

  test('fires on a keyword anywhere in the message', () => {
    assert.equal(matchTrigger(graph, { text: 'boleh lihat MENU nya?' })?.node.id, 'kw')
  })

  test('does not fire when no keyword appears', () => {
    assert.equal(matchTrigger(graph, { text: 'berapa harganya' }), null)
  })

  test('a button tap matches its payload, not the label text', () => {
    // The tap carries a label too; matching the label would fire the wrong flow.
    const m = matchTrigger(graph, { text: 'Lihat menu', replyId: 'btn_promo' })
    assert.equal(m?.node.id, 'btn')
  })

  test('a fallback trigger never fires through ordinary matching', () => {
    const g: FlowGraph = {
      nodes: [node('fb', { kind: 'trigger', match: 'fallback', values: [], caseSensitive: false })],
      edges: [],
    }
    assert.equal(matchTrigger(g, { text: 'cara bikin skck' }), null)
    assert.equal(findFallbackTrigger(g)?.id, 'fb')
    assert.equal(findFallbackTrigger(graph), null)
  })

  test('an invalid regex is skipped rather than crashing the pipeline', () => {
    const bad: FlowGraph = {
      nodes: [node('r', { kind: 'trigger', match: 'regex', values: ['['], caseSensitive: false })],
      edges: [],
    }
    assert.doesNotThrow(() => matchTrigger(bad, { text: 'apa saja' }))
    assert.equal(matchTrigger(bad, { text: 'apa saja' }), null)
  })
})

describe('running a flow', () => {
  const greet: FlowGraph = {
    nodes: [
      node('t', { kind: 'trigger', match: 'keyword', values: ['halo'], caseSensitive: false }),
      node('s', { kind: 'sendText', body: 'Halo {{contact.name}} dari {{contact.kota}}!' }),
      node('b', {
        kind: 'sendButtons',
        body: 'Pilih:',
        buttons: [
          { id: 'btn_produk', title: 'Produk' },
          { id: 'btn_cs', title: 'CS' },
        ],
      }),
      node('p', { kind: 'sendText', body: 'Ini produk kami.' }),
      node('h', { kind: 'handover', message: 'Saya sambungkan ke tim.' }),
      node('e', { kind: 'end' }),
    ],
    edges: [
      edge('1', 't', 's'),
      edge('2', 's', 'b'),
      edge('3', 'b', 'p', 'btn_produk'),
      edge('4', 'b', 'h', 'btn_cs'),
      edge('5', 'p', 'e'),
    ],
  }

  test('interpolates contact fields and stops at the buttons', async () => {
    const { calls, fx } = spy()
    const r = await runFlow(greet, state, { kind: 'start', startNodeId: 't' }, ctx, fx)

    assert.deepEqual(calls, ['text:Halo Ahmad dari Bandung!', 'buttons:Pilih:[btn_produk|btn_cs]'])
    assert.deepEqual(r.outcome, { status: 'waiting' })
    assert.equal(r.state.currentNodeId, 'b')
  })

  test('a button tap follows that button own branch', async () => {
    const { calls, fx } = spy()
    let s = (await runFlow(greet, state, { kind: 'start', startNodeId: 't' }, ctx, fx)).state
    calls.length = 0

    const r = await runFlow(greet, s, { kind: 'reply', messageType: 'interactive', replyId: 'btn_cs' }, ctx, fx)

    assert.deepEqual(calls, ['text:Saya sambungkan ke tim.', 'handover'])
    assert.deepEqual(r.outcome, { status: 'handedOver' })
  })

  test('the other button reaches the end instead', async () => {
    const { calls, fx } = spy()
    let s = (await runFlow(greet, state, { kind: 'start', startNodeId: 't' }, ctx, fx)).state
    calls.length = 0

    const r = await runFlow(greet, s, { kind: 'reply', messageType: 'interactive', replyId: 'btn_produk' }, ctx, fx)

    assert.deepEqual(calls, ['text:Ini produk kami.'])
    assert.deepEqual(r.outcome, { status: 'completed' })
  })

  test('typing free text at a buttons node changes nothing and keeps waiting', async () => {
    const { calls, fx } = spy()
    let s = (await runFlow(greet, state, { kind: 'start', startNodeId: 't' }, ctx, fx)).state
    calls.length = 0

    const r = await runFlow(greet, s, { kind: 'reply', messageType: 'text', text: 'apa saja' }, ctx, fx)

    assert.deepEqual(calls, [])
    assert.deepEqual(r.outcome, { status: 'waiting' })
    assert.equal(r.state.currentNodeId, 'b')
  })

  test('a timeout at a buttons node expires the session instead of parking it forever', async () => {
    const { calls, fx } = spy()
    const s = (await runFlow(greet, state, { kind: 'start', startNodeId: 't' }, ctx, fx)).state
    calls.length = 0

    const r = await runFlow(greet, s, { kind: 'timeout' }, ctx, fx)

    // Nothing is sent; the point is only that the session stops being live so
    // the contact's next message can fire a trigger again.
    assert.deepEqual(calls, [])
    assert.deepEqual(r.outcome, { status: 'expired' })
  })

  test('an unwired branch parks the session rather than ending it', async () => {
    const partial: FlowGraph = { ...greet, edges: greet.edges.filter((e) => e.sourceHandle !== 'btn_cs') }
    const { calls, fx } = spy()
    let s = (await runFlow(partial, state, { kind: 'start', startNodeId: 't' }, ctx, fx)).state
    calls.length = 0

    const r = await runFlow(partial, s, { kind: 'reply', messageType: 'interactive', replyId: 'btn_cs' }, ctx, fx)
    assert.deepEqual(r.outcome, { status: 'waiting' })

    // The correct tap still works afterwards.
    const r2 = await runFlow(partial, r.state, { kind: 'reply', messageType: 'interactive', replyId: 'btn_produk' }, ctx, fx)
    assert.deepEqual(r2.outcome, { status: 'completed' })
  })
})

describe('waitReply', () => {
  const ask: FlowGraph = {
    nodes: [
      node('t', { kind: 'trigger', match: 'keyword', values: ['daftar'], caseSensitive: false }),
      node('q', { kind: 'sendText', body: 'Berapa umur kamu?' }),
      node('w', {
        kind: 'waitReply',
        saveAs: 'umur',
        expect: 'number',
        invalidMessage: 'Tolong isi angka saja.',
        maxRetries: 2,
        timeoutMinutes: 60,
      }),
      node('ok', { kind: 'sendText', body: 'Terima kasih, umur {{umur}}.' }),
      node('no', { kind: 'sendText', body: 'Kita lanjutkan lain kali.' }),
      node('e', { kind: 'end' }),
    ],
    edges: [
      edge('1', 't', 'q'),
      edge('2', 'q', 'w'),
      edge('3', 'w', 'ok', 'reply'),
      edge('4', 'w', 'no', 'timeout'),
      edge('5', 'ok', 'e'),
      edge('6', 'no', 'e'),
    ],
  }

  test('a valid answer is saved and usable in later messages', async () => {
    const { calls, fx } = spy()
    let s = (await runFlow(ask, state, { kind: 'start', startNodeId: 't' }, ctx, fx)).state
    calls.length = 0

    const r = await runFlow(ask, s, { kind: 'reply', messageType: 'text', text: '27' }, ctx, fx)

    assert.equal(r.state.variables.umur, '27')
    assert.deepEqual(calls, ['text:Terima kasih, umur 27.'])
    assert.deepEqual(r.outcome, { status: 'completed' })
  })

  test('an invalid answer re-prompts and keeps waiting', async () => {
    const { calls, fx } = spy()
    let s = (await runFlow(ask, state, { kind: 'start', startNodeId: 't' }, ctx, fx)).state
    calls.length = 0

    const r = await runFlow(ask, s, { kind: 'reply', messageType: 'text', text: 'dua puluh' }, ctx, fx)

    assert.deepEqual(calls, ['text:Tolong isi angka saja.'])
    assert.deepEqual(r.outcome, { status: 'waiting' })
    assert.equal(r.state.retries, 1)
  })

  test('running out of retries takes the no-answer branch instead of looping forever', async () => {
    const { calls, fx } = spy()
    let s = (await runFlow(ask, state, { kind: 'start', startNodeId: 't' }, ctx, fx)).state

    for (let i = 0; i < 2; i++) {
      s = (await runFlow(ask, s, { kind: 'reply', messageType: 'text', text: 'bukan angka' }, ctx, fx)).state
    }
    calls.length = 0

    const r = await runFlow(ask, s, { kind: 'reply', messageType: 'text', text: 'masih bukan' }, ctx, fx)

    assert.deepEqual(calls, ['text:Kita lanjutkan lain kali.'])
    assert.deepEqual(r.outcome, { status: 'completed' })
  })

  test('a timeout takes the no-answer branch', async () => {
    const { calls, fx } = spy()
    let s = (await runFlow(ask, state, { kind: 'start', startNodeId: 't' }, ctx, fx)).state
    calls.length = 0

    const r = await runFlow(ask, s, { kind: 'timeout' }, ctx, fx)

    assert.deepEqual(calls, ['text:Kita lanjutkan lain kali.'])
    assert.deepEqual(r.outcome, { status: 'completed' })
  })
})

describe('logic and guards', () => {
  test('a condition routes on a saved variable', async () => {
    const g: FlowGraph = {
      nodes: [
        node('t', { kind: 'trigger', match: 'api', values: [], caseSensitive: false }),
        node('v', { kind: 'setVariable', name: 'total', value: '150000' }),
        node('c', { kind: 'condition', variable: 'total', operator: 'gt', value: '100000', caseSensitive: false }),
        node('y', { kind: 'sendText', body: 'Gratis ongkir!' }),
        node('n', { kind: 'sendText', body: 'Belum dapat gratis ongkir.' }),
      ],
      edges: [edge('1', 't', 'v'), edge('2', 'v', 'c'), edge('3', 'c', 'y', 'true'), edge('4', 'c', 'n', 'false')],
    }

    const { calls, fx } = spy()
    await runFlow(g, state, { kind: 'start', startNodeId: 't' }, ctx, fx)
    assert.deepEqual(calls, ['text:Gratis ongkir!'])
  })

  test('numbers compare as numbers, so 9 is less than 10', async () => {
    const g: FlowGraph = {
      nodes: [
        node('t', { kind: 'trigger', match: 'api', values: [], caseSensitive: false }),
        node('v', { kind: 'setVariable', name: 'n', value: '9' }),
        node('c', { kind: 'condition', variable: 'n', operator: 'lt', value: '10', caseSensitive: false }),
        node('y', { kind: 'sendText', body: 'kurang' }),
      ],
      edges: [edge('1', 't', 'v'), edge('2', 'v', 'c'), edge('3', 'c', 'y', 'true')],
    }
    const { calls, fx } = spy()
    await runFlow(g, state, { kind: 'start', startNodeId: 't' }, ctx, fx)
    assert.deepEqual(calls, ['text:kurang'])
  })

  test('a delay suspends the run instead of blocking it', async () => {
    const g: FlowGraph = {
      nodes: [
        node('t', { kind: 'trigger', match: 'api', values: [], caseSensitive: false }),
        node('d', { kind: 'delay', seconds: 3600 }),
        node('s', { kind: 'sendText', body: 'nanti' }),
      ],
      edges: [edge('1', 't', 'd'), edge('2', 'd', 's')],
    }

    const { calls, fx } = spy()
    const r = await runFlow(g, state, { kind: 'start', startNodeId: 't' }, ctx, fx)

    assert.deepEqual(r.outcome, { status: 'sleeping', seconds: 3600 })
    assert.deepEqual(calls, [])

    const resumed = await runFlow(g, r.state, { kind: 'resume' }, ctx, fx)
    assert.deepEqual(calls, ['text:nanti'])
    assert.deepEqual(resumed.outcome, { status: 'completed' })
  })

  test('a runaway loop is stopped by the step budget, not by the contact', async () => {
    const g: FlowGraph = {
      nodes: [
        node('t', { kind: 'trigger', match: 'api', values: [], caseSensitive: false }),
        node('a', { kind: 'setVariable', name: 'n', value: '1' }),
      ],
      edges: [edge('1', 't', 'a'), edge('2', 'a', 'a')],
    }

    const { calls, fx } = spy()
    const r = await runFlow(g, state, { kind: 'start', startNodeId: 't' }, ctx, fx)

    assert.equal(r.outcome.status, 'failed')
    assert.match((r.outcome as { error: string }).error, /batas langkah/)
    assert.ok(r.state.stepCount <= MAX_STEPS_PER_TICK + 1)
    assert.deepEqual(calls, [], 'nothing should have been sent to the contact')
  })

  test('tags and assignment run as effects', async () => {
    const g: FlowGraph = {
      nodes: [
        node('t', { kind: 'trigger', match: 'api', values: [], caseSensitive: false }),
        node('tg', { kind: 'tag', action: 'add', tags: ['tertarik', ' '] }),
        node('as', { kind: 'assign', userId: null, note: 'follow up' }),
        node('e', { kind: 'end' }),
      ],
      edges: [edge('1', 't', 'tg'), edge('2', 'tg', 'as'), edge('3', 'as', 'e')],
    }

    const { calls, fx } = spy()
    await runFlow(g, state, { kind: 'start', startNodeId: 't' }, ctx, fx)
    assert.deepEqual(calls, ['tags:add:tertarik', 'assign:auto'])
  })
})

describe('media messages', () => {
  const withMedia = (data: FlowNode['data']): FlowGraph => ({
    nodes: [
      node('t', { kind: 'trigger', match: 'api', values: [], caseSensitive: false }),
      node('m', data),
      node('e', { kind: 'end' }),
    ],
    edges: [edge('1', 't', 'm'), edge('2', 'm', 'e')],
  })

  test('an image carries its caption, with variables filled in', async () => {
    const { calls, fx } = spy()
    const g = withMedia({
      kind: 'sendMedia',
      media: 'image',
      source: 'link',
      value: 'https://cdn.contoh.id/banner.jpg',
      caption: 'Selamat datang {{contact.name}}!',
    })

    await runFlow(g, state, { kind: 'start', startNodeId: 't' }, ctx, fx)
    assert.deepEqual(calls, ['media:image:link:https://cdn.contoh.id/banner.jpg:Selamat datang Ahmad!'])
  })

  test('a media id is passed through instead of a link', async () => {
    const { calls, fx } = spy()
    const g = withMedia({ kind: 'sendMedia', media: 'image', source: 'id', value: '998877', caption: '' })

    await runFlow(g, state, { kind: 'start', startNodeId: 't' }, ctx, fx)
    assert.deepEqual(calls, ['media:image:id:998877:'])
  })

  test('the flow continues after sending media', async () => {
    const { fx } = spy()
    const g = withMedia({ kind: 'sendMedia', media: 'image', source: 'link', value: 'https://x/y.jpg', caption: '' })

    const r = await runFlow(g, state, { kind: 'start', startNodeId: 't' }, ctx, fx)
    assert.deepEqual(r.outcome, { status: 'completed' })
  })

  test('a buttons node can carry an image header', async () => {
    const { calls, fx } = spy()
    const g: FlowGraph = {
      nodes: [
        node('t', { kind: 'trigger', match: 'api', values: [], caseSensitive: false }),
        node('b', {
          kind: 'sendButtons',
          headerImage: 'https://cdn.contoh.id/head.jpg',
          body: 'Pilih layanan:',
          buttons: [{ id: 'a', title: 'Info' }],
        }),
      ],
      edges: [edge('1', 't', 'b')],
    }

    await runFlow(g, state, { kind: 'start', startNodeId: 't' }, ctx, fx)
    assert.deepEqual(calls, ['buttons:https://cdn.contoh.id/head.jpg:Pilih layanan:[a]'])
  })
})

describe('httpRequest', () => {
  const ask = (data: Partial<Extract<FlowNode['data'], { kind: 'httpRequest' }>> = {}): FlowGraph => ({
    nodes: [
      node('t', { kind: 'trigger', match: 'api', values: [], caseSensitive: false }),
      node('h', {
        kind: 'httpRequest',
        method: 'GET',
        url: 'https://ai.contoh.id/search?q={{pertanyaan}}',
        headers: '',
        body: '',
        saveAs: 'ai',
        timeoutSeconds: 15,
        ...data,
      }),
      node('ok', { kind: 'sendText', body: '{{ai.feedback.short_description}} ({{ai.matched_sources.0.title}})' }),
      node('err', { kind: 'sendText', body: 'Maaf, layanan sedang gangguan.' }),
    ],
    edges: [edge('1', 't', 'h'), edge('2', 'h', 'ok', 'success'), edge('3', 'h', 'err', 'error')],
  })
  const asking = (q: string): SessionState => ({ ...state, variables: { pertanyaan: q } })

  test('encodes values into the URL and reads nested fields of the response', async () => {
    const { calls, requests, fx } = spy(async () => ({
      status: 200,
      data: { feedback: { short_description: 'Bawa KK ke Disdukcapil.' }, matched_sources: [{ title: 'e-KTP rusak' }] },
    }))

    const r = await runFlow(ask(), asking('ktp saya hilang & rusak'), { kind: 'start', startNodeId: 't' }, ctx, fx)

    assert.equal(requests[0]!.url, 'https://ai.contoh.id/search?q=ktp%20saya%20hilang%20%26%20rusak')
    assert.deepEqual(calls, ['text:Bawa KK ke Disdukcapil. (e-KTP rusak)'])
    assert.deepEqual(r.outcome, { status: 'completed' })
  })

  test('escapes values into a POST body so quotes cannot break the JSON', async () => {
    const { requests, fx } = spy()
    const g = ask({ method: 'POST', url: 'https://ai.contoh.id/search', body: '{"query": "{{pertanyaan}}"}' })

    await runFlow(g, asking('kata "rusak"\nbaris dua'), { kind: 'start', startNodeId: 't' }, ctx, fx)

    assert.deepEqual(JSON.parse(requests[0]!.body!), { query: 'kata "rusak"\nbaris dua' })
    assert.equal(requests[0]!.headers['Content-Type'], 'application/json')
  })

  test('a non-2xx status takes the error branch', async () => {
    const { calls, fx } = spy(async () => ({ status: 400, data: { message: 'kosong' } }))

    const r = await runFlow(ask(), asking(''), { kind: 'start', startNodeId: 't' }, ctx, fx)

    assert.deepEqual(calls, ['text:Maaf, layanan sedang gangguan.'])
    assert.deepEqual(r.state.variables.ai, { message: 'kosong' })
  })

  test('a timeout takes the error branch instead of failing the run', async () => {
    const { calls, fx } = spy(async () => {
      throw new Error('The operation was aborted due to timeout')
    })

    const r = await runFlow(ask(), asking('ktp'), { kind: 'start', startNodeId: 't' }, ctx, fx)

    assert.deepEqual(calls, ['text:Maaf, layanan sedang gangguan.'])
    assert.deepEqual(r.outcome, { status: 'completed' })
  })

  test('a condition can test a field inside the saved response', async () => {
    const { calls, fx } = spy(async () => ({ status: 200, data: { feedback: { best_similarity: 0.42 } } }))
    const g = ask()
    g.nodes.push(
      node('c', { kind: 'condition', variable: 'ai.feedback.best_similarity', operator: 'gt', value: '0.6', caseSensitive: false }),
      node('low', { kind: 'sendText', body: 'Kurang yakin.' }),
    )
    g.edges = [edge('1', 't', 'h'), edge('2', 'h', 'c', 'success'), edge('3', 'c', 'ok', 'true'), edge('4', 'c', 'low', 'false')]

    await runFlow(g, asking('ktp'), { kind: 'start', startNodeId: 't' }, ctx, fx)
    assert.deepEqual(calls, ['text:Kurang yakin.'])
  })
})

describe('askAi', () => {
  const graph = (data: Partial<Extract<FlowNode['data'], { kind: 'askAi' }>> = {}): FlowGraph => ({
    nodes: [
      node('t', { kind: 'trigger', match: 'api', values: [], caseSensitive: false }),
      node('a', { kind: 'askAi', endpointId: 'ai1', question: 'pertanyaan', sendAnswer: true, endButton: '', saveAs: 'jawaban_ai', ...data }),
      node('ok', { kind: 'sendText', body: 'Ada lagi?' }),
      node('err', { kind: 'sendText', body: 'Maaf, AI sedang gangguan.' }),
    ],
    edges: [edge('1', 't', 'a'), edge('2', 'a', 'ok', 'success'), edge('3', 'a', 'err', 'error')],
  })
  const asking = (q: string): SessionState => ({ ...state, variables: { pertanyaan: q } })
  const start = { kind: 'start', startNodeId: 't' } as const

  test('asks the chosen endpoint and sends the answer straight to the contact', async () => {
    const { calls, fx } = spy(undefined, async () => ({ answer: 'Bawa KK ke Disdukcapil.' }))

    const r = await runFlow(graph(), asking('ktp hilang'), start, ctx, fx)

    assert.deepEqual(calls, ['ai:ai1:ktp hilang', 'text:Bawa KK ke Disdukcapil.', 'text:Ada lagi?'])
    assert.equal(r.state.variables.jawaban_ai, 'Bawa KK ke Disdukcapil.')
  })

  test('with sending off, the answer is only saved for a later node', async () => {
    const { calls, fx } = spy(undefined, async () => ({ answer: 'Jawaban' }))

    const r = await runFlow(graph({ sendAnswer: false }), asking('ktp'), start, ctx, fx)

    assert.deepEqual(calls, ['ai:ai1:ktp', 'text:Ada lagi?'])
    assert.equal(r.state.variables.jawaban_ai, 'Jawaban')
  })

  test('a failing AI takes the error branch and sends nothing of its own', async () => {
    const { calls, fx } = spy(undefined, async () => {
      throw new Error('HTTP 500')
    })

    const r = await runFlow(graph(), asking('ktp'), start, ctx, fx)

    assert.deepEqual(calls, ['ai:ai1:ktp', 'text:Maaf, AI sedang gangguan.'])
    assert.deepEqual(r.outcome, { status: 'completed' })
  })

  test('an empty question skips the call entirely', async () => {
    const { calls, fx } = spy()

    await runFlow(graph(), asking('   '), start, ctx, fx)

    assert.deepEqual(calls, ['text:Maaf, AI sedang gangguan.'])
  })

  test('an answer longer than WhatsApp allows is cut to fit', async () => {
    const { calls, fx } = spy(undefined, async () => ({ answer: 'x'.repeat(5000) }))

    await runFlow(graph(), asking('ktp'), start, ctx, fx)

    const sent = calls.find((c) => c.startsWith('text:x'))!.slice('text:'.length)
    assert.equal(sent.length, 4096)
    assert.ok(sent.endsWith('…'))
  })

  test('with a button label, the answer goes out with that button under it', async () => {
    const { calls, fx } = spy(undefined, async () => ({ answer: 'Bawa KK.' }))

    await runFlow(graph({ endButton: 'Selesai' }), asking('ktp'), start, ctx, fx)

    assert.deepEqual(calls, ['ai:ai1:ktp', 'buttons:Bawa KK.[selesai]', 'text:Ada lagi?'])
  })

  test('an answer too long for a button message is sent whole, the button after it', async () => {
    const { calls, fx } = spy(undefined, async () => ({ answer: 'x'.repeat(2000) }))

    await runFlow(graph({ endButton: 'Selesai' }), asking('ktp'), start, ctx, fx)

    assert.equal(calls[1], `text:${'x'.repeat(2000)}`)
    assert.match(calls[2]!, /^buttons:Ada pertanyaan lain\?.*\[selesai\]$/)
  })

  describe('question-answer loop', () => {
    // Tunggu balasan -> Tanya AI (+Selesai) -> Tunggu balasan 20m -> Kondisi
    // "selesai"? -> tutup, else back to Tanya AI.
    const loop: FlowGraph = {
      nodes: [
        node('t', { kind: 'trigger', match: 'api', values: [], caseSensitive: false }),
        node('a', { kind: 'askAi', endpointId: 'ai1', question: 'pertanyaan', sendAnswer: true, endButton: 'Selesai', saveAs: 'jawaban_ai' }),
        node('w', { kind: 'waitReply', saveAs: 'pertanyaan', expect: 'text', maxRetries: 0, timeoutMinutes: 20 }),
        node('c', { kind: 'condition', variable: 'pertanyaan', operator: 'eq', value: 'selesai', caseSensitive: false }),
        node('bye', { kind: 'sendText', body: 'Terima kasih!' }),
        node('idle', { kind: 'sendText', body: 'Sesi ditutup.' }),
        node('e', { kind: 'end' }),
      ],
      edges: [
        edge('1', 't', 'a'),
        edge('2', 'a', 'w', 'success'),
        edge('3', 'w', 'c', 'reply'),
        edge('4', 'w', 'idle', 'timeout'),
        edge('5', 'c', 'bye', 'true'),
        edge('6', 'c', 'a', 'false'),
        edge('7', 'bye', 'e'),
        edge('8', 'idle', 'e'),
      ],
    }

    test('keeps answering until the contact taps Selesai', async () => {
      const { calls, fx } = spy(undefined, async (p) => ({ answer: `jawab ${p.question}` }))

      let r = await runFlow(loop, asking('satu'), start, ctx, fx)
      assert.deepEqual(r.outcome, { status: 'waiting' })

      r = await runFlow(loop, r.state, { kind: 'reply', messageType: 'text', text: 'dua' }, ctx, fx)
      assert.deepEqual(r.outcome, { status: 'waiting' })

      r = await runFlow(loop, r.state, { kind: 'reply', messageType: 'interactive', replyId: 'selesai' }, ctx, fx)
      assert.deepEqual(r.outcome, { status: 'completed' })
      assert.deepEqual(calls, [
        'ai:ai1:satu',
        'buttons:jawab satu[selesai]',
        'ai:ai1:dua',
        'buttons:jawab dua[selesai]',
        'text:Terima kasih!',
      ])
    })

    test('silence past the wait closes the session', async () => {
      const { calls, fx } = spy(undefined, async () => ({ answer: 'ok' }))

      const r1 = await runFlow(loop, asking('satu'), start, ctx, fx)
      const r2 = await runFlow(loop, r1.state, { kind: 'timeout' }, ctx, fx)

      assert.deepEqual(r2.outcome, { status: 'completed' })
      assert.equal(calls.at(-1), 'text:Sesi ditutup.')
    })
  })
})

describe('aiRoute', () => {
  const graph = (minScore = 0.7, clarify = false): FlowGraph => ({
    nodes: [
      node('kw', { kind: 'trigger', match: 'keyword', values: ['menu'], caseSensitive: false }),
      node('fb', { kind: 'trigger', match: 'fallback', values: [], caseSensitive: false }),
      node('r', {
        kind: 'aiRoute',
        endpointId: 'rt1',
        question: 'pesan_awal',
        minScore,
        clarify,
        clarifyMinScore: 0.5,
        clarifyBody: 'Maksud Anda?',
        saveAs: 'arah_ai',
      }),
      node('menu', {
        kind: 'sendList',
        body: 'Pilih layanan:',
        buttonText: 'Menu',
        sections: [{ title: 'Layanan', rows: [{ id: 'skck', title: 'SKCK' }, { id: 'paspor', title: 'Paspor' }] }],
      }),
      node('skck_txt', { kind: 'sendText', body: 'Info SKCK' }),
      node('paspor_txt', { kind: 'sendText', body: 'Info paspor' }),
      node('nav', { kind: 'sendButtons', body: 'Ada lagi?', buttons: [{ id: 'nav_menu', title: 'Menu Utama' }] }),
      node('err', { kind: 'sendText', body: 'Maaf, coba pilih dari menu.' }),
    ],
    edges: [
      edge('1', 'kw', 'menu'),
      edge('2', 'fb', 'r'),
      edge('3', 'r', 'menu', 'unsure'),
      edge('4', 'r', 'err', 'error'),
      edge('5', 'menu', 'skck_txt', 'skck'),
      edge('6', 'menu', 'paspor_txt', 'paspor'),
      edge('7', 'skck_txt', 'nav'),
      edge('8', 'paspor_txt', 'nav'),
      edge('9', 'nav', 'menu', 'nav_menu'),
      edge('10', 'err', 'menu'),
    ],
  })
  const asked = (q: string): SessionState => ({ ...state, variables: { pesan_awal: q } })
  const start = { kind: 'start', startNodeId: 'r' } as const
  const pick = (destinationId: string | null, score: number) => async (): Promise<RoutePick> => ({
    destinationId,
    score,
    candidates: destinationId ? [{ id: destinationId, score }] : [],
  })

  test('jumps straight to the picked destination, skipping the menu', async () => {
    const { calls, routes, fx } = spy(undefined, undefined, pick('skck', 0.82))

    const r = await runFlow(graph(), asked('cara bikin skck'), start, ctx, fx)

    assert.deepEqual(calls, ['route:rt1:cara bikin skck', 'text:Info SKCK', 'buttons:Ada lagi?[nav_menu]'])
    assert.deepEqual(r.outcome, { status: 'waiting' })
    assert.equal(r.state.currentNodeId, 'nav')
    assert.deepEqual(r.state.variables.arah_ai, {
      id: 'skck',
      score: 0.82,
      path: 'SKCK',
      candidates: [{ id: 'skck', score: 0.82 }],
    })
    assert.deepEqual(routes[0]!.destinations.map((d) => d.id), ['skck', 'paspor'])
  })

  test('a pick below the minimum score shows the menu instead', async () => {
    const { calls, fx } = spy(undefined, undefined, pick('skck', 0.5))

    const r = await runFlow(graph(), asked('skck?'), start, ctx, fx)

    assert.deepEqual(calls, ['route:rt1:skck?', 'list:Pilih layanan:'])
    assert.equal((r.state.variables.arah_ai as { id: unknown }).id, null)
  })

  test('the minimum score is the node setting, inclusive', async () => {
    const { calls, fx } = spy(undefined, undefined, pick('paspor', 0.5))

    await runFlow(graph(0.5), asked('paspor'), start, ctx, fx)

    assert.equal(calls[1], 'text:Info paspor')
  })

  test('no pick shows the menu', async () => {
    const { calls, fx } = spy(undefined, undefined, pick(null, 0.3))

    await runFlow(graph(), asked('terima kasih'), start, ctx, fx)

    assert.deepEqual(calls, ['route:rt1:terima kasih', 'list:Pilih layanan:'])
  })

  test('an id that was never sent is not trusted', async () => {
    const { calls, fx } = spy(undefined, undefined, pick('ktp', 0.99))

    await runFlow(graph(), asked('ktp hilang'), start, ctx, fx)

    assert.deepEqual(calls, ['route:rt1:ktp hilang', 'list:Pilih layanan:'])
  })

  test('a failing router takes the error branch', async () => {
    const { calls, fx } = spy(undefined, undefined, async () => {
      throw new Error('tidak ada jawaban dalam 8 detik')
    })

    await runFlow(graph(), asked('skck'), start, ctx, fx)

    assert.deepEqual(calls, ['route:rt1:skck', 'text:Maaf, coba pilih dari menu.', 'list:Pilih layanan:'])
  })

  test('an empty question skips the call', async () => {
    const { calls, fx } = spy()

    await runFlow(graph(), asked('  '), start, ctx, fx)

    assert.deepEqual(calls, ['text:Maaf, coba pilih dari menu.', 'list:Pilih layanan:'])
  })

  describe('asking back when unsure', () => {
    const unsure = (candidates: { id: string; score: number }[], destinationId: string | null = null) =>
      async (): Promise<RoutePick> => ({ destinationId, score: candidates[0]?.score ?? 0, candidates })

    test('offers the close candidates plus Lainnya, and waits', async () => {
      const { calls, lists, fx } = spy(undefined, undefined, unsure([
        { id: 'skck', score: 0.61 },
        { id: 'paspor', score: 0.42 },
      ]))

      const r = await runFlow(graph(0.7, true), asked('surat polisi'), start, ctx, fx)

      assert.deepEqual(calls, ['route:rt1:surat polisi', 'list:Maksud Anda?'])
      assert.deepEqual(r.outcome, { status: 'waiting' })
      assert.equal(r.state.currentNodeId, 'r')
      assert.deepEqual(lists[0]!.sections[0]!.rows.map((x) => x.id), ['skck', '__lainnya'])
      assert.deepEqual((r.state.variables.arah_ai as { asked: string[] }).asked, ['skck'])
    })

    test('a pick under the jump bar comes first, without repeating it', async () => {
      const { lists, fx } = spy(undefined, undefined, unsure([
        { id: 'paspor', score: 0.66 },
        { id: 'skck', score: 0.55 },
      ], 'skck'))

      await runFlow(graph(0.7, true), asked('surat'), start, ctx, fx)

      assert.deepEqual(lists[0]!.sections[0]!.rows.map((x) => x.id), ['skck', 'paspor', '__lainnya'])
    })

    test('tapping a candidate continues at that destination', async () => {
      const first = spy(undefined, undefined, unsure([{ id: 'skck', score: 0.61 }]))
      const parked = await runFlow(graph(0.7, true), asked('surat polisi'), start, ctx, first.fx)

      const { calls, fx } = spy()
      const r = await runFlow(graph(0.7, true), parked.state, { kind: 'reply', messageType: 'interactive', replyId: 'skck' }, ctx, fx)

      assert.deepEqual(calls, ['text:Info SKCK', 'buttons:Ada lagi?[nav_menu]'])
      assert.deepEqual(r.state.variables.arah_ai, {
        id: 'skck',
        score: 0.61,
        path: 'SKCK',
        candidates: [{ id: 'skck', score: 0.61 }],
        asked: ['skck'],
        chosenBy: 'contact',
      })
    })

    for (const [why, reply] of [
      ['Lainnya', { kind: 'reply', messageType: 'interactive', replyId: '__lainnya' }],
      ['a typed reply', { kind: 'reply', messageType: 'text', text: 'bukan' }],
      ['a row it did not offer', { kind: 'reply', messageType: 'interactive', replyId: 'paspor' }],
    ] as const) {
      test(`${why} takes the unsure branch`, async () => {
        const first = spy(undefined, undefined, unsure([{ id: 'skck', score: 0.61 }]))
        const parked = await runFlow(graph(0.7, true), asked('surat polisi'), start, ctx, first.fx)

        const { calls, fx } = spy()
        const r = await runFlow(graph(0.7, true), parked.state, reply, ctx, fx)

        assert.deepEqual(calls, ['list:Pilih layanan:'])
        assert.equal((r.state.variables.arah_ai as { id: unknown }).id, null)
      })
    }

    test('nothing close enough goes straight to the unsure branch', async () => {
      const { calls, fx } = spy(undefined, undefined, unsure([{ id: 'skck', score: 0.45 }]))

      await runFlow(graph(0.7, true), asked('cuaca hari ini'), start, ctx, fx)

      assert.deepEqual(calls, ['route:rt1:cuaca hari ini', 'list:Pilih layanan:'])
    })

    test('rows are named by their menu row and described by the menus above', async () => {
      const nested: FlowGraph = {
        nodes: [
          node('fb', { kind: 'trigger', match: 'fallback', values: [], caseSensitive: false }),
          { ...graph(0.7, true).nodes.find((n) => n.id === 'r')! },
          node('menu', {
            kind: 'sendList',
            body: 'Menu',
            buttonText: 'Menu',
            sections: [{ title: 'Instansi', rows: [{ id: 'polres', title: 'Polres Cimahi', description: 'Layanan polisi' }] }],
          }),
          node('polres_menu', {
            kind: 'sendList',
            body: 'Polres',
            buttonText: 'Pilih',
            sections: [{ title: 'Layanan', rows: [{ id: 'skck', title: 'SKCK' }] }],
          }),
          node('skck_txt', { kind: 'sendText', body: 'Info SKCK' }),
        ],
        edges: [
          edge('1', 'fb', 'r'),
          edge('2', 'r', 'menu', 'unsure'),
          edge('3', 'menu', 'polres_menu', 'polres'),
          edge('4', 'polres_menu', 'skck_txt', 'skck'),
        ],
      }
      const { lists, fx } = spy(undefined, undefined, unsure([
        { id: 'skck', score: 0.6 },
        { id: 'polres', score: 0.58 },
      ]))

      await runFlow(nested, asked('surat kelakuan baik'), start, ctx, fx)

      assert.deepEqual(lists[0]!.sections[0]!.rows, [
        { id: 'skck', title: 'SKCK', description: 'Polres Cimahi' },
        { id: 'polres', title: 'Polres Cimahi', description: 'Layanan polisi' },
        { id: '__lainnya', title: 'Lainnya', description: 'Bukan yang di atas, lihat menu utama' },
      ])
    })
  })
})
