import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildRouteCatalog, maskRouteQuestion, ROUTE_CONTENT_MAX, ROUTE_QUESTION_KEEP_MAX } from '../src/flow/catalog.ts'
import type { FlowGraph, FlowNode } from '../src/flow/schema.ts'

const at = { x: 0, y: 0 }
const node = (id: string, data: FlowNode['data']): FlowNode => ({ id, type: data.kind, position: at, data })
const edge = (source: string, target: string, sourceHandle: string | null = null) => ({
  id: `${source}-${sourceHandle ?? ''}-${target}`,
  source,
  target,
  sourceHandle,
})
const list = (id: string, rows: { id: string; title: string; description?: string; aiHint?: string }[]) =>
  node(id, { kind: 'sendList', body: 'Pilih:', buttonText: 'Menu', sections: [{ title: 'Pilihan', rows }] })
const text = (id: string, body: string) => node(id, { kind: 'sendText', body })

/** A two-level menu with the navigation every real menu carries. */
const menu: FlowGraph = {
  nodes: [
    node('t', { kind: 'trigger', match: 'keyword', values: ['menu'], caseSensitive: false }),
    text('welcome', 'Selamat datang'),
    list('menu', [
      { id: 'm_info', title: 'Informasi', description: 'Info kota' },
      { id: 'm_layanan', title: 'Layanan Publik' },
    ]),
    text('info_txt', 'Info *kota* untuk {{contact.name}}.\n\n\nBuka situs kami.'),
    list('lp', [
      { id: 'lp_skck', title: 'SKCK', description: 'Surat Keterangan Catatan Kepolisian' },
      { id: 'lp_back', title: 'Menu Utama' },
    ]),
    node('tag', { kind: 'tag', action: 'add', tags: ['skck'] }),
    text('skck_txt', 'Bawa KTP ke Polres.'),
    node('nav', {
      kind: 'sendButtons',
      body: 'Ada lagi?',
      buttons: [
        { id: 'nav_back', title: 'Kembali' },
        { id: 'nav_done', title: 'Selesai' },
      ],
    }),
    text('bye', 'Terima kasih'),
  ],
  edges: [
    edge('t', 'welcome'),
    edge('welcome', 'menu'),
    edge('menu', 'info_txt', 'm_info'),
    edge('menu', 'lp', 'm_layanan'),
    edge('info_txt', 'nav'),
    edge('lp', 'tag', 'lp_skck'),
    edge('lp', 'menu', 'lp_back'),
    edge('tag', 'skck_txt'),
    edge('skck_txt', 'nav'),
    edge('nav', 'menu', 'nav_back'),
    edge('nav', 'bye', 'nav_done'),
  ],
}

describe('buildRouteCatalog', () => {
  test('every forward menu row is a destination, named by the rows tapped to reach it', () => {
    const got = buildRouteCatalog(menu).map(({ id, path, target }) => ({ id, path, target }))
    assert.deepEqual(got, [
      { id: 'm_info', path: 'Informasi', target: 'info_txt' },
      { id: 'm_layanan', path: 'Layanan Publik', target: 'lp' },
      { id: 'lp_skck', path: 'Layanan Publik › SKCK', target: 'tag' },
    ])
  })

  test('a row leading back up the menu is navigation, not a destination', () => {
    assert.ok(!buildRouteCatalog(menu).some((d) => d.id === 'lp_back'))
  })

  test('content is the message behind the row, as plain text', () => {
    const info = buildRouteCatalog(menu).find((d) => d.id === 'm_info')!
    assert.equal(info.content, 'Info kota untuk .\nBuka situs kami.')
    assert.equal(info.description, 'Info kota')
  })

  test('content looks past silent nodes such as a tag', () => {
    const skck = buildRouteCatalog(menu).find((d) => d.id === 'lp_skck')!
    assert.equal(skck.content, 'Bawa KTP ke Polres.')
  })

  test('a submenu destination carries the submenu text', () => {
    const lp = buildRouteCatalog(menu).find((d) => d.id === 'm_layanan')!
    assert.equal(lp.content, 'Pilih:')
  })

  test('a Petunjuk AI joins the description and replaces the message', () => {
    const hinted: FlowGraph = {
      ...menu,
      nodes: menu.nodes.map((n) =>
        n.id === 'lp'
          ? list('lp', [
              {
                id: 'lp_skck',
                title: 'SKCK',
                description: 'Surat Keterangan Catatan Kepolisian',
                aiHint: '  surat kelakuan baik, syarat melamar kerja  ',
              },
              { id: 'lp_back', title: 'Menu Utama' },
            ])
          : n,
      ),
    }
    const skck = buildRouteCatalog(hinted).find((d) => d.id === 'lp_skck')!
    assert.equal(skck.description, 'Surat Keterangan Catatan Kepolisian — surat kelakuan baik, syarat melamar kerja')
    assert.equal(skck.content, '')
  })

  test('a blank Petunjuk AI changes nothing', () => {
    const blank: FlowGraph = {
      ...menu,
      nodes: menu.nodes.map((n) => (n.id === 'menu' ? list('menu', [{ id: 'm_info', title: 'Informasi', aiHint: ' ' }]) : n)),
    }
    const info = buildRouteCatalog(blank).find((d) => d.id === 'm_info')!
    assert.equal(info.description, '')
    assert.equal(info.content, 'Info kota untuk .\nBuka situs kami.')
  })

  test('long content is cut to the limit', () => {
    const long: FlowGraph = {
      nodes: [
        node('t', { kind: 'trigger', match: 'keyword', values: ['x'], caseSensitive: false }),
        list('l', [{ id: 'r', title: 'R' }]),
        text('x', 'a'.repeat(2000)),
      ],
      edges: [edge('t', 'l'), edge('l', 'x', 'r')],
    }
    const [d] = buildRouteCatalog(long)
    assert.equal(d!.content.length, ROUTE_CONTENT_MAX)
    assert.ok(d!.content.endsWith('…'))
  })

  test('row ids the editor repeats across lists are made unique with the list id', () => {
    const repeated: FlowGraph = {
      nodes: [
        node('t', { kind: 'trigger', match: 'keyword', values: ['x'], caseSensitive: false }),
        list('l1', [
          { id: 'row_1', title: 'Satu' },
          { id: 'row_2', title: 'Dua' },
        ]),
        list('l2', [{ id: 'row_1', title: 'Tiga' }]),
        text('a', 'A'),
        text('b', 'B'),
      ],
      edges: [edge('t', 'l1'), edge('l1', 'a', 'row_1'), edge('l1', 'l2', 'row_2'), edge('l2', 'b', 'row_1')],
    }
    assert.deepEqual(
      buildRouteCatalog(repeated).map((d) => d.id),
      ['row_1@l1', 'row_2', 'row_1@l2'],
    )
  })

  test('a flow without lists has nothing to route to', () => {
    const plain: FlowGraph = {
      nodes: [node('t', { kind: 'trigger', match: 'keyword', values: ['x'], caseSensitive: false }), text('a', 'A')],
      edges: [edge('t', 'a')],
    }
    assert.deepEqual(buildRouteCatalog(plain), [])
  })
})

describe('maskRouteQuestion', () => {
  for (const [why, input, expected] of [
    ['an NIK', 'NIK saya 3277012345670001 tidak terdaftar', 'NIK saya [angka] tidak terdaftar'],
    ['a spaced NIK', 'nik 3277 0123 4567 0001', 'nik [angka]'],
    ['a phone number', 'hubungi 0812-3456-7890 ya', 'hubungi [angka] ya'],
    ['an international number', 'wa +62 812 3456 7890', 'wa [angka]'],
    ['an email', 'kirim ke budi.s@mail.co.id dong', 'kirim ke [email] dong'],
    ['several at once', 'ktp 3277012345670001, hp 081234567890', 'ktp [angka], hp [angka]'],
  ] as const) {
    test(`hides ${why}`, () => {
      assert.equal(maskRouteQuestion(input), expected)
    })
  }

  test('keeps the short numbers that help read a question', () => {
    assert.equal(maskRouteQuestion('bikin SIM C 2026 di RT 05 RW 07'), 'bikin SIM C 2026 di RT 05 RW 07')
  })

  test('caps what is kept', () => {
    assert.equal(maskRouteQuestion('a'.repeat(ROUTE_QUESTION_KEEP_MAX + 50)).length, ROUTE_QUESTION_KEEP_MAX)
  })
})
