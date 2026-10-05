import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validateFlow } from '../src/flow/validate.ts'
import { flowGraphSchema, type FlowGraph, type FlowNode } from '../src/flow/schema.ts'

const at = { x: 0, y: 0 }

function node(id: string, data: FlowNode['data']): FlowNode {
  return { id, type: data.kind, position: at, data }
}

const trigger = node('t', {
  kind: 'trigger',
  match: 'keyword',
  values: ['halo'],
  caseSensitive: false,
})

const end = node('e', { kind: 'end' })

function graph(nodes: FlowNode[], edges: FlowGraph['edges'] = []): FlowGraph {
  return { nodes, edges }
}

const errors = (g: FlowGraph) => validateFlow(g).filter((i) => i.severity === 'error')
const warnings = (g: FlowGraph) => validateFlow(g).filter((i) => i.severity === 'warning')

describe('structure', () => {
  test('a flow with no trigger cannot run', () => {
    const issues = errors(graph([end]))
    assert.ok(issues.some((i) => /minimal satu node Trigger/.test(i.message)))
  })

  test('a node wired to nothing is an error', () => {
    const issues = errors(graph([trigger, end]))
    assert.ok(issues.some((i) => i.nodeId === 't' && /tidak terhubung/.test(i.message)))
  })

  test('a minimal trigger to end flow is valid', () => {
    const g = graph([trigger, end], [{ id: 'e1', source: 't', target: 'e' }])
    assert.deepEqual(errors(g), [])
  })

  test('an edge pointing at a missing node is an error', () => {
    const g = graph([trigger, end], [{ id: 'e1', source: 't', target: 'ghost' }])
    assert.ok(errors(g).some((i) => /node tujuan yang tidak ada/.test(i.message)))
  })

  test('a node the trigger cannot reach is a warning, not a blocker', () => {
    const orphan = node('o', { kind: 'sendText', body: 'nobody sees this' })
    const g = graph(
      [trigger, end, orphan],
      [
        { id: 'e1', source: 't', target: 'e' },
        { id: 'e2', source: 'o', target: 'e' },
      ],
    )
    assert.deepEqual(errors(g), [])
    assert.ok(warnings(g).some((i) => i.nodeId === 'o' && /tidak pernah tercapai/.test(i.message)))
  })
})

describe('WhatsApp limits', () => {
  const withButtons = (buttons: { id: string; title: string }[]) =>
    graph(
      [trigger, node('b', { kind: 'sendButtons', body: 'pilih', buttons }), end],
      [
        { id: 'e1', source: 't', target: 'b' },
        ...buttons.map((btn, i) => ({
          id: `e${i + 2}`,
          source: 'b',
          target: 'e',
          sourceHandle: btn.id,
        })),
      ],
    )

  test('three buttons pass', () => {
    const g = withButtons([
      { id: 'a', title: 'Ya' },
      { id: 'b', title: 'Tidak' },
      { id: 'c', title: 'CS' },
    ])
    assert.deepEqual(errors(g), [])
  })

  test('a fourth button is an error', () => {
    const g = withButtons([
      { id: 'a', title: '1' },
      { id: 'b', title: '2' },
      { id: 'c', title: '3' },
      { id: 'd', title: '4' },
    ])
    assert.ok(errors(g).some((i) => /maksimum 3/.test(i.message)))
  })

  test('duplicate button ids are an error, because the reply becomes ambiguous', () => {
    const g = withButtons([
      { id: 'same', title: 'Ya' },
      { id: 'same', title: 'Tidak' },
    ])
    assert.ok(errors(g).some((i) => /dobel/.test(i.message)))
  })

  test('a button title over 20 chars is an error', () => {
    const g = withButtons([{ id: 'a', title: 'x'.repeat(21) }])
    assert.ok(errors(g).some((i) => /maksimum 20/.test(i.message)))
  })

  test('an unwired button branch warns — tapping it would stall the bot', () => {
    const g = graph(
      [
        trigger,
        node('b', {
          kind: 'sendButtons',
          body: 'pilih',
          buttons: [
            { id: 'yes', title: 'Ya' },
            { id: 'no', title: 'Tidak' },
          ],
        }),
        end,
      ],
      [
        { id: 'e1', source: 't', target: 'b' },
        { id: 'e2', source: 'b', target: 'e', sourceHandle: 'yes' },
      ],
    )
    assert.deepEqual(errors(g), [])
    assert.ok(warnings(g).some((i) => /"Tidak" belum terhubung/.test(i.message)))
  })

  test('eleven list rows across sections is an error', () => {
    const rows = (p: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, title: `${p}${i}` }))
    const g = graph(
      [
        trigger,
        node('l', {
          kind: 'sendList',
          body: 'pilih',
          buttonText: 'Menu',
          sections: [
            { title: 'A', rows: rows('a', 6) },
            { title: 'B', rows: rows('b', 5) },
          ],
        }),
      ],
      [{ id: 'e1', source: 't', target: 'l' }],
    )
    assert.ok(errors(g).some((i) => /11 baris/.test(i.message)))
  })
})

describe('runtime hazards', () => {
  test('a free-form send after a 24h delay warns to use a template', () => {
    const g = graph(
      [
        trigger,
        node('d', { kind: 'delay', seconds: 25 * 3600 }),
        node('s', { kind: 'sendText', body: 'masih di sana?' }),
        end,
      ],
      [
        { id: 'e1', source: 't', target: 'd' },
        { id: 'e2', source: 'd', target: 's' },
        { id: 'e3', source: 's', target: 'e' },
      ],
    )
    assert.deepEqual(errors(g), [])
    assert.ok(warnings(g).some((i) => i.nodeId === 's' && /window kemungkinan sudah tertutup/.test(i.message)))
  })

  test('a template after the same delay does not warn', () => {
    const g = graph(
      [
        trigger,
        node('d', { kind: 'delay', seconds: 25 * 3600 }),
        node('s', { kind: 'sendTemplate', templateName: 'followup', language: 'id', bodyParams: [] }),
        end,
      ],
      [
        { id: 'e1', source: 't', target: 'd' },
        { id: 'e2', source: 'd', target: 's' },
        { id: 'e3', source: 's', target: 'e' },
      ],
    )
    assert.equal(
      warnings(g).filter((i) => /window/.test(i.message)).length,
      0,
    )
  })

  test('a loop with no pause warns about burst sending', () => {
    const g = graph(
      [trigger, node('a', { kind: 'sendText', body: 'hai' }), node('b', { kind: 'setVariable', name: 'n', value: '1' })],
      [
        { id: 'e1', source: 't', target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
        { id: 'e3', source: 'b', target: 'a' },
      ],
    )
    assert.ok(warnings(g).some((i) => /perulangan tanpa jeda/.test(i.message)))
  })

  test('a loop that waits for a reply is fine', () => {
    const g = graph(
      [
        trigger,
        node('w', { kind: 'waitReply', saveAs: 'jawab', expect: 'any', maxRetries: 2, timeoutMinutes: 60 }),
        node('a', { kind: 'sendText', body: 'coba lagi' }),
      ],
      [
        { id: 'e1', source: 't', target: 'w' },
        { id: 'e2', source: 'w', target: 'a', sourceHandle: 'reply' },
        { id: 'e3', source: 'w', target: 'a', sourceHandle: 'timeout' },
        { id: 'e4', source: 'a', target: 'w' },
      ],
    )
    assert.equal(warnings(g).filter((i) => /perulangan/.test(i.message)).length, 0)
  })
})

describe('node fields', () => {
  test('a trigger with no keywords is an error', () => {
    const g = graph(
      [node('t', { kind: 'trigger', match: 'keyword', values: [], caseSensitive: false }), end],
      [{ id: 'e1', source: 't', target: 'e' }],
    )
    assert.ok(errors(g).some((i) => /belum punya kata kunci/.test(i.message)))
  })

  test('an invalid regex is an error', () => {
    const g = graph(
      [node('t', { kind: 'trigger', match: 'regex', values: ['['], caseSensitive: false }), end],
      [{ id: 'e1', source: 't', target: 'e' }],
    )
    assert.ok(errors(g).some((i) => /Regex tidak valid/.test(i.message)))
  })

  test('a zero wait is an error, since it would give up before the contact can type', () => {
    const g = graph(
      [
        trigger,
        node('w', { kind: 'waitReply', saveAs: 'jawab', expect: 'any', maxRetries: 0, timeoutMinutes: 0 }),
      ],
      [{ id: 'e1', source: 't', target: 'w' }],
    )
    assert.ok(errors(g).some((i) => /minimal 1 menit/.test(i.message)))
  })

  test('an httpRequest needs an http(s) URL, a free variable name and valid JSON', () => {
    const g = graph(
      [
        trigger,
        node('h', {
          kind: 'httpRequest',
          method: 'POST',
          url: 'ai.contoh.id/search',
          headers: '',
          body: '{"query": {{pertanyaan}}',
          saveAs: 'contact',
          timeoutSeconds: 15,
        }),
      ],
      [{ id: 'e1', source: 't', target: 'h' }],
    )
    const messages = errors(g).map((i) => i.message)
    assert.ok(messages.some((m) => /http:\/\/ atau https:\/\//.test(m)))
    assert.ok(messages.some((m) => /dipakai sistem/.test(m)))
    assert.ok(messages.some((m) => /bukan JSON/.test(m)))
  })

  test('a JSON body with variables inside quotes is valid', () => {
    const g = graph(
      [
        trigger,
        node('h', {
          kind: 'httpRequest',
          method: 'POST',
          url: 'https://ai.contoh.id/search',
          headers: '',
          body: '{"query": "{{pertanyaan}}"}',
          saveAs: 'ai',
          timeoutSeconds: 15,
        }),
        end,
      ],
      [
        { id: 'e1', source: 't', target: 'h' },
        { id: 'e2', source: 'h', target: 'e', sourceHandle: 'success' },
      ],
    )
    assert.deepEqual(errors(g), [])
  })

  describe('askAi', () => {
    const wait = node('w', { kind: 'waitReply', saveAs: 'pertanyaan', expect: 'text', maxRetries: 1, timeoutMinutes: 5 })
    const ask = (data: Partial<Extract<FlowNode['data'], { kind: 'askAi' }>> = {}) =>
      node('a', { kind: 'askAi', endpointId: 'ai1', question: 'pertanyaan', sendAnswer: true, endButton: '', saveAs: 'jawaban_ai', ...data })
    const wired = (a: FlowNode, withWait = true) =>
      graph(withWait ? [trigger, wait, a, end] : [trigger, a, end], [
        ...(withWait
          ? [
              { id: 'e1', source: 't', target: 'w' },
              { id: 'e2', source: 'w', target: 'a', sourceHandle: 'reply' },
              { id: 'e3', source: 'w', target: 'e', sourceHandle: 'timeout' },
            ]
          : [{ id: 'e1', source: 't', target: 'a' }]),
        { id: 'e4', source: 'a', target: 'e', sourceHandle: 'success' },
        { id: 'e5', source: 'a', target: 'e', sourceHandle: 'error' },
      ])

    test('a complete node is clean', () => {
      assert.deepEqual(validateFlow(wired(ask()), { aiEndpointIds: new Set(['ai1']) }), [])
    })

    test('no AI chosen is an error', () => {
      assert.ok(errors(wired(ask({ endpointId: '' }))).some((i) => /pilih AI/.test(i.message)))
    })

    test('an AI deleted since is an error, but only when the saved list is known', () => {
      const g = wired(ask({ endpointId: 'terhapus' }))
      assert.ok(
        validateFlow(g, { aiEndpointIds: new Set(['ai1']) }).some(
          (i) => i.severity === 'error' && /sudah dihapus/.test(i.message),
        ),
      )
      assert.deepEqual(errors(g), [])
    })

    test('a question variable no node fills is flagged', () => {
      // The mistake that sent every question to the AI empty: saved to one
      // name, read from another.
      const g = wired(ask({ question: 'jawaban' }))
      assert.ok(warnings(g).some((i) => /\{\{jawaban\}\} tidak pernah diisi/.test(i.message)))
    })

    test('a button label longer than WhatsApp allows is an error', () => {
      assert.ok(errors(wired(ask({ endButton: 'Selesai, terima kasih banyak' }))).some((i) => /label tombol/.test(i.message)))
      // Not sent at all, so not checked.
      assert.deepEqual(errors(wired(ask({ sendAnswer: false, endButton: 'Selesai, terima kasih banyak' }))), [])
    })

    test('a question-answer loop back into the AI is not a spinning cycle', () => {
      const g = graph(
        [
          trigger,
          wait,
          ask({ endButton: 'Selesai' }),
          node('w2', { kind: 'waitReply', saveAs: 'pertanyaan', expect: 'any', maxRetries: 0, timeoutMinutes: 20 }),
          node('c', { kind: 'condition', variable: 'pertanyaan', operator: 'eq', value: 'selesai', caseSensitive: false }),
          end,
        ],
        [
          { id: 'e1', source: 't', target: 'w' },
          { id: 'e2', source: 'w', target: 'a', sourceHandle: 'reply' },
          { id: 'e3', source: 'w', target: 'e', sourceHandle: 'timeout' },
          { id: 'e4', source: 'a', target: 'w2', sourceHandle: 'success' },
          { id: 'e5', source: 'a', target: 'e', sourceHandle: 'error' },
          { id: 'e6', source: 'w2', target: 'c', sourceHandle: 'reply' },
          { id: 'e7', source: 'w2', target: 'e', sourceHandle: 'timeout' },
          { id: 'e8', source: 'c', target: 'e', sourceHandle: 'true' },
          { id: 'e9', source: 'c', target: 'a', sourceHandle: 'false' },
        ],
      )
      assert.deepEqual(validateFlow(g, { aiEndpointIds: new Set(['ai1']) }), [])
    })
  })

  test('an invalid variable name on waitReply is an error', () => {
    const g = graph(
      [
        trigger,
        node('w', { kind: 'waitReply', saveAs: '2 nama', expect: 'any', maxRetries: 0, timeoutMinutes: 5 }),
      ],
      [{ id: 'e1', source: 't', target: 'w' }],
    )
    assert.ok(errors(g).some((i) => /bukan nama variabel yang valid/.test(i.message)))
  })
})

describe('draft storage', () => {
  test('a half-written node still parses, so autosave never silently drops work', () => {
    // Exactly what the editor holds a second after dropping a buttons node:
    // empty body, placeholder ids. If the storage schema rejected this, every
    // keystroke before the node was complete would be lost.
    const draft = {
      nodes: [
        {
          id: 'a',
          type: 'sendButtons',
          position: at,
          data: { kind: 'sendButtons', body: '', buttons: [{ id: 'btn_1', title: '' }] },
        },
        { id: 'b', type: 'sendTemplate', position: at, data: { kind: 'sendTemplate', templateName: '' } },
        { id: 'c', type: 'delay', position: at, data: { kind: 'delay', seconds: 0 } },
        { id: 'd', type: 'tag', position: at, data: { kind: 'tag', action: 'add', tags: [] } },
        {
          id: 'e2',
          type: 'sendList',
          position: at,
          data: { kind: 'sendList', body: '', buttonText: '', sections: [] },
        },
      ],
      edges: [],
    }

    const parsed = flowGraphSchema.safeParse(draft)
    assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues))
  })

  test('but publishing that draft is still blocked', () => {
    const g = graph([
      trigger,
      node('x', { kind: 'sendButtons', body: '', buttons: [] }),
      node('y', { kind: 'delay', seconds: 0 }),
    ])
    const msgs = errors(g).map((i) => i.message)
    assert.ok(msgs.some((m) => /Isi pesan tombol masih kosong/.test(m)))
    assert.ok(msgs.some((m) => /Jeda harus minimal 1 detik/.test(m)))
  })
})

describe('interactive body length', () => {
  test('a long menu with a button attached is blocked, with the fix named', () => {
    const g = graph(
      [trigger, node('b', { kind: 'sendButtons', body: 'x'.repeat(1025), buttons: [{ id: 'a', title: 'Menu' }] })],
      [{ id: 'e1', source: 't', target: 'b' }],
    )
    const msg = errors(g).find((i) => /1025 karakter/.test(i.message))
    assert.ok(msg, 'should flag the over-length body')
    assert.match(msg!.message, /Pecah jadi node Kirim teks/)
  })

  test('the same text is fine in a plain text node, which allows 4096', () => {
    const g = graph(
      [trigger, node('s', { kind: 'sendText', body: 'x'.repeat(1025) }), end],
      [
        { id: 'e1', source: 't', target: 's' },
        { id: 'e2', source: 's', target: 'e' },
      ],
    )
    assert.deepEqual(errors(g), [])
  })

  test('a list needs its opening button text', () => {
    const g = graph(
      [
        trigger,
        node('l', {
          kind: 'sendList',
          body: 'pilih',
          buttonText: '',
          sections: [{ title: 'A', rows: [{ id: 'r', title: 'R' }] }],
        }),
      ],
      [{ id: 'e1', source: 't', target: 'l' }],
    )
    assert.ok(errors(g).some((i) => /Teks tombol pembuka masih kosong/.test(i.message)))
  })
})

describe('terminal nodes', () => {
  test('handover may end a branch, like End — the engine halts there', () => {
    const g = graph(
      [trigger, node('h', { kind: 'handover', message: 'Saya sambungkan ke tim.' })],
      [{ id: 'e1', source: 't', target: 'h' }],
    )
    assert.deepEqual(errors(g), [])
  })

  test('other nodes still must lead somewhere', () => {
    const g = graph(
      [trigger, node('s', { kind: 'sendText', body: 'halo' })],
      [{ id: 'e1', source: 't', target: 's' }],
    )
    assert.ok(errors(g).some((i) => i.nodeId === 's' && /tidak terhubung/.test(i.message)))
  })
})

describe('aiRoute and the fallback trigger', () => {
  const fallback = node('fb', { kind: 'trigger', match: 'fallback', values: [], caseSensitive: false })
  const route = (data: Partial<Extract<FlowNode['data'], { kind: 'aiRoute' }>> = {}) =>
    node('r', { kind: 'aiRoute', endpointId: 'rt1', question: 'pesan_awal', minScore: 0.7, saveAs: 'arah_ai', ...data })
  const menu = node('m', {
    kind: 'sendList',
    body: 'Pilih:',
    buttonText: 'Menu',
    sections: [{ title: 'Layanan', rows: [{ id: 'skck', title: 'SKCK' }] }],
  })
  const info = node('i', { kind: 'sendText', body: 'Info SKCK' })
  const routed = (r = route(), extra: FlowNode[] = []) =>
    graph(
      [fallback, r, menu, info, end, ...extra],
      [
        { id: '1', source: 'fb', target: 'r' },
        { id: '2', source: 'r', target: 'm', sourceHandle: 'unsure' },
        { id: '3', source: 'r', target: 'm', sourceHandle: 'error' },
        { id: '4', source: 'm', target: 'i', sourceHandle: 'skck' },
        { id: '5', source: 'i', target: 'e' },
      ],
    )
  const kinds = new Map<string, 'ANSWER' | 'ROUTE'>([
    ['rt1', 'ROUTE'],
    ['ans1', 'ANSWER'],
  ])

  test('a wired router over a menu is valid, and pesan_awal needs no Tunggu balasan', () => {
    assert.deepEqual(validateFlow(routed(), { aiEndpointIds: new Set(kinds.keys()), aiEndpointKinds: kinds }), [])
  })

  test('the fallback trigger needs no keywords', () => {
    assert.ok(!errors(routed()).some((i) => i.nodeId === 'fb'))
  })

  test('a router with no endpoint chosen cannot publish', () => {
    assert.ok(errors(routed(route({ endpointId: '' }))).some((i) => /pilih AI/.test(i.message)))
  })

  test('a router on an answering endpoint is an error, and so is the reverse', () => {
    const opts = { aiEndpointIds: new Set(kinds.keys()), aiEndpointKinds: kinds }
    const wrongRouter = validateFlow(routed(route({ endpointId: 'ans1' })), opts)
    assert.ok(wrongRouter.some((i) => i.severity === 'error' && /Arahkan ke menu/.test(i.message)))

    const ask = node('a', { kind: 'askAi', endpointId: 'rt1', question: 'pesan_awal', sendAnswer: true, endButton: '', saveAs: 'jawaban_ai' })
    const g = graph([trigger, ask, end], [
      { id: '1', source: 't', target: 'a' },
      { id: '2', source: 'a', target: 'e', sourceHandle: 'success' },
      { id: '3', source: 'a', target: 'e', sourceHandle: 'error' },
    ])
    assert.ok(validateFlow(g, opts).some((i) => i.severity === 'error' && /Jawab pertanyaan/.test(i.message)))
  })

  test('a minimum score outside 0 to 1 is an error', () => {
    assert.ok(errors(routed(route({ minScore: 1.5 }))).some((i) => /antara 0 dan 1/.test(i.message)))
  })

  test('a router in a flow without any menu list is an error', () => {
    const g = graph(
      [fallback, route(), end],
      [
        { id: '1', source: 'fb', target: 'r' },
        { id: '2', source: 'r', target: 'e', sourceHandle: 'unsure' },
        { id: '3', source: 'r', target: 'e', sourceHandle: 'error' },
      ],
    )
    assert.ok(errors(g).some((i) => /butuh menu/.test(i.message)))
  })

  test('a second fallback trigger is flagged', () => {
    const second = node('fb2', { kind: 'trigger', match: 'fallback', values: [], caseSensitive: false })
    const g = routed(route(), [second])
    g.edges.push({ id: '6', source: 'fb2', target: 'r' })
    assert.ok(warnings(g).some((i) => i.nodeId === 'fb2' && /lebih dari satu/.test(i.message)))
  })

  test('an unwired unsure branch is flagged', () => {
    const g = routed()
    g.edges = g.edges.filter((e) => e.sourceHandle !== 'unsure')
    assert.ok(warnings(g).some((i) => i.nodeId === 'r' && /tidak cocok/.test(i.message)))
  })
})
