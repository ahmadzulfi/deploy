import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildTemplateComponents, flowTemplateValues, renderTemplate, templateSlots } from '../src/templates.ts'

// Shapes as Meta's /message_templates returns them.
const positional = [
  { type: 'HEADER', format: 'TEXT', text: 'Pesanan {{1}}', example: { header_text: ['#123'] } },
  {
    type: 'BODY',
    text: 'Halo {{1}}, pesanan kamu dikirim {{2}}. Terima kasih {{1}}!',
    example: { body_text: [['Budi', 'besok']] },
  },
  { type: 'FOOTER', text: 'Toko Cimahi' },
  {
    type: 'BUTTONS',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Oke' },
      { type: 'URL', text: 'Lacak', url: 'https://toko.id/lacak/{{1}}', example: ['https://toko.id/lacak/abc'] },
    ],
  },
]

const named = [
  {
    type: 'BODY',
    text: 'Halo {{nama}}, kode kamu {{kode}}.',
    example: { body_text_named_params: [{ param_name: 'nama', example: 'Budi' }, { param_name: 'kode', example: 'X1' }] },
  },
]

describe('templateSlots', () => {
  it('lists header, body (deduped, numeric order) and URL button blanks', () => {
    assert.deepEqual(
      templateSlots(positional).map((s) => `${s.key}:${s.example ?? ''}`),
      ['header.1:#123', 'body.1:Budi', 'body.2:besok', 'button.1.1:https://toko.id/lacak/abc'],
    )
  })

  it('sorts positional parameters numerically, not by appearance', () => {
    const slots = templateSlots([{ type: 'BODY', text: '{{2}} lalu {{1}} lalu {{10}}' }])
    assert.deepEqual(slots.map((s) => s.name), ['1', '2', '10'])
  })

  it('treats a media header as one URL slot', () => {
    const slots = templateSlots([{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Promo' }])
    assert.deepEqual(slots, [{ key: 'header.media', component: 'header', name: 'media', format: 'image' }])
  })

  it('returns nothing for a template without blanks or garbage input', () => {
    assert.deepEqual(templateSlots([{ type: 'BODY', text: 'Terima kasih' }]), [])
    assert.deepEqual(templateSlots(null), [])
  })
})

describe('buildTemplateComponents', () => {
  it('omits components entirely when there are no blanks', () => {
    assert.equal(buildTemplateComponents([{ type: 'BODY', text: 'Hai' }], {}), undefined)
  })

  it('builds positional header, body and button parameters', () => {
    const out = buildTemplateComponents(positional, {
      'header.1': '#9',
      'body.1': 'Sari',
      'body.2': 'hari ini',
      'button.1.1': 'xyz',
    })
    assert.deepEqual(out, [
      { type: 'header', parameters: [{ type: 'text', text: '#9' }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Sari' },
          { type: 'text', text: 'hari ini' },
        ],
      },
      { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'xyz' }] },
    ])
  })

  it('names parameters for named templates', () => {
    assert.deepEqual(buildTemplateComponents(named, { 'body.nama': 'Sari', 'body.kode': 'Z9' }), [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Sari', parameter_name: 'nama' },
          { type: 'text', text: 'Z9', parameter_name: 'kode' },
        ],
      },
    ])
  })

  it('sends a media header as a link', () => {
    const out = buildTemplateComponents([{ type: 'HEADER', format: 'DOCUMENT' }], {
      'header.media': 'https://x.id/a.pdf',
    })
    assert.deepEqual(out, [
      { type: 'header', parameters: [{ type: 'document', document: { link: 'https://x.id/a.pdf' } }] },
    ])
  })

  it('sends a coupon code button', () => {
    const out = buildTemplateComponents(
      [{ type: 'BODY', text: 'Diskon' }, { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', example: 'HEMAT' }] }],
      { 'button.0.code': 'HEMAT10' },
    )
    assert.deepEqual(out, [
      { type: 'button', sub_type: 'copy_code', index: '0', parameters: [{ type: 'coupon_code', coupon_code: 'HEMAT10' }] },
    ])
  })
})

describe('renderTemplate', () => {
  it('fills known values and leaves unknown blanks visible', () => {
    const p = renderTemplate(positional, { 'body.1': 'Sari' })
    assert.equal(p.header, 'Pesanan {{1}}')
    assert.equal(p.body, 'Halo Sari, pesanan kamu dikirim {{2}}. Terima kasih Sari!')
    assert.equal(p.footer, 'Toko Cimahi')
    assert.deepEqual(p.buttons, ['Oke', 'Lacak'])
  })
})

describe('flowTemplateValues', () => {
  it('maps the ordered body list and header value onto slot keys', () => {
    assert.deepEqual(flowTemplateValues(positional, { bodyParams: ['Sari', 'besok'], headerParam: '#1' }), {
      'header.1': '#1',
      'body.1': 'Sari',
      'body.2': 'besok',
    })
    assert.deepEqual(flowTemplateValues(named, { bodyParams: ['Sari'] }), { 'body.nama': 'Sari', 'body.kode': '' })
  })
})
