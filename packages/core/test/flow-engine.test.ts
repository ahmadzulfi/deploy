import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { runFlow, MAX_STEPS_PER_TICK, type EngineEffects, type SessionState } from '../src/flow/engine.ts'
import { matchTrigger } from '../src/flow/match.ts'
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

/** Records every effect instead of performing it. */
function spy() {
  const calls: string[] = []
  const fx: EngineEffects = {
    async sendText(b) { calls.push(`text:${b}`) },
    async sendMedia(p) { calls.push(`media:${p.media}:${p.source}:${p.value}:${p.caption ?? ''}`) },
    async sendButtons(p) { calls.push(`buttons:${p.headerImage ? p.headerImage + ':' : ''}${p.body}[${p.buttons.map((b) => b.id).join('|')}]`) },
    async sendList(p) { calls.push(`list:${p.body}`) },
    async sendTemplate(p) { calls.push(`template:${p.name}(${p.bodyParams.join(',')})`) },
    async changeTags(a, t) { calls.push(`tags:${a}:${t.join(',')}`) },
    async assign(u) { calls.push(`assign:${u ?? 'auto'}`) },
    async handover() { calls.push('handover') },
  }
  return { calls, fx }
}

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
