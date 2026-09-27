import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  draftToComponents,
  emptyDraft,
  nextVariable,
  normalizeTemplateName,
  previewDraft,
  templateDraftSchema,
  templateKind,
  validateTemplateDraft,
  type TemplateDraft,
} from '../src/template-draft.ts'
import { templateSlots } from '../src/templates.ts'

function marketing(over: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    ...emptyDraft('MARKETING'),
    name: 'promo_sayur',
    header: { format: 'TEXT', text: 'Halo {{1}}', example: 'Budi', handle: '', fileName: '' },
    body: { text: 'Pakai kode {{1}} untuk diskon {{2}} hari ini.', examples: ['HEALTH', '10%'] },
    footer: 'Toko Cimahi',
    buttons: [
      { type: 'URL', text: 'Belanja', url: 'https://toko.id/p/{{1}}', example: 'https://toko.id/p/sayur' },
      { type: 'QUICK_REPLY', text: 'Berhenti' },
      { type: 'COPY_CODE', example: 'HEALTH' },
    ],
    ...over,
  }
}

describe('normalizeTemplateName', () => {
  it('lowercases and replaces spaces', () => {
    assert.equal(normalizeTemplateName('Promo Sayur-Segar!'), 'promo_sayur_segar')
  })
})

describe('nextVariable', () => {
  it('counts from the highest number used', () => {
    assert.equal(nextVariable('tanpa variabel'), 1)
    assert.equal(nextVariable('{{1}} dan {{2}}'), 3)
  })
})

describe('validateTemplateDraft', () => {
  it('accepts a complete marketing draft', () => {
    assert.deepEqual(validateTemplateDraft(marketing()), {})
  })

  it('checks the name', () => {
    assert.ok(validateTemplateDraft(marketing({ name: '' })).name)
    assert.ok(validateTemplateDraft(marketing({ name: 'Promo Sayur' })).name)
  })

  it('refuses a variable at the start or end of the body', () => {
    const e1 = validateTemplateDraft(marketing({ body: { text: '{{1}} halo', examples: ['a'] } }))
    const e2 = validateTemplateDraft(marketing({ body: { text: 'halo {{1}}', examples: ['a'] } }))
    assert.match(e1.body!, /awal atau akhir/)
    assert.match(e2.body!, /awal atau akhir/)
  })

  it('wants variables numbered from 1 without gaps', () => {
    const e = validateTemplateDraft(marketing({ body: { text: 'a {{1}} b {{3}} c', examples: ['x', 'y', 'z'] } }))
    assert.match(e.body!, /berurutan/)
    const named = validateTemplateDraft(marketing({ body: { text: 'a {{nama}} b', examples: ['x'] } }))
    assert.match(named.body!, /angka/)
  })

  it('wants a sample for every variable', () => {
    const e = validateTemplateDraft(marketing({ body: { text: 'a {{1}} b {{2}} c', examples: ['x', ''] } }))
    assert.ok(e.bodyExamples)
  })

  it('limits the header to one variable with a sample', () => {
    const two = marketing({ header: { format: 'TEXT', text: '{{1}} {{2}}', example: 'x', handle: '', fileName: '' } })
    assert.ok(validateTemplateDraft(two).header)
    const noSample = marketing({ header: { format: 'TEXT', text: 'Hai {{1}}', example: '', handle: '', fileName: '' } })
    assert.ok(validateTemplateDraft(noSample).headerExample)
  })

  it('needs an uploaded sample for a media header', () => {
    const d = marketing({ header: { format: 'IMAGE', text: '', example: '', handle: '', fileName: '' } })
    assert.ok(validateTemplateDraft(d).header)
    d.header.handle = '4::abc'
    assert.equal(validateTemplateDraft(d).header, undefined)
  })

  it('refuses variables in the footer', () => {
    assert.ok(validateTemplateDraft(marketing({ footer: 'Hai {{1}}' })).footer)
  })

  it('enforces button limits and rules', () => {
    const urls = marketing({
      buttons: Array.from({ length: 3 }, () => ({ type: 'URL' as const, text: 'Buka', url: 'https://a.id', example: '' })),
    })
    assert.match(validateTemplateDraft(urls).buttons!, /situs/)

    const coupon = { ...marketing(), category: 'UTILITY' as const }
    assert.match(validateTemplateDraft(coupon).buttons!, /Marketing/)

    const midUrl = marketing({ buttons: [{ type: 'URL', text: 'Buka', url: 'https://a.id/{{1}}/x', example: 'https://a.id/1/x' }] })
    assert.match(validateTemplateDraft(midUrl)['button.0']!, /akhir/)

    const phone = marketing({ buttons: [{ type: 'PHONE_NUMBER', text: 'Telepon', phone: '0812' }] })
    assert.ok(validateTemplateDraft(phone)['button.0'])
  })

  it('checks the authentication settings only', () => {
    const d = { ...emptyDraft('AUTHENTICATION'), name: 'kode_masuk' }
    assert.deepEqual(validateTemplateDraft(d), {})
    assert.ok(validateTemplateDraft({ ...d, auth: { ...d.auth, expiryMinutes: 120 } }).auth)
  })
})

describe('draftToComponents', () => {
  it('builds Meta components with samples and grouped buttons', () => {
    const c = draftToComponents(marketing())
    assert.deepEqual(c, [
      { type: 'HEADER', format: 'TEXT', text: 'Halo {{1}}', example: { header_text: ['Budi'] } },
      {
        type: 'BODY',
        text: 'Pakai kode {{1}} untuk diskon {{2}} hari ini.',
        example: { body_text: [['HEALTH', '10%']] },
      },
      { type: 'FOOTER', text: 'Toko Cimahi' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Berhenti' },
          { type: 'URL', text: 'Belanja', url: 'https://toko.id/p/{{1}}', example: ['https://toko.id/p/sayur'] },
          { type: 'COPY_CODE', example: 'HEALTH' },
        ],
      },
    ])
  })

  it('leaves out examples when there is nothing to fill', () => {
    const c = draftToComponents(
      marketing({
        header: { format: 'IMAGE', text: '', example: '', handle: '4::h', fileName: 'a.jpg' },
        body: { text: 'Tanpa isian.', examples: [] },
        footer: '',
        buttons: [],
      }),
    )
    assert.deepEqual(c, [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::h'] } },
      { type: 'BODY', text: 'Tanpa isian.' },
    ])
  })

  it('builds an authentication template', () => {
    const d = { ...emptyDraft('AUTHENTICATION'), name: 'kode_masuk' }
    assert.deepEqual(draftToComponents(d), [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 10 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Salin kode' }] },
    ])
  })

  it('round-trips into the slots a sender fills', () => {
    const keys = templateSlots(draftToComponents(marketing())).map((s) => s.key)
    assert.deepEqual(keys, ['header.1', 'body.1', 'body.2', 'button.1.1', 'button.2.code'])
  })
})

describe('previews', () => {
  it('fills samples into the preview', () => {
    const p = previewDraft(marketing())
    assert.equal(p.header, 'Halo Budi')
    assert.equal(p.body, 'Pakai kode HEALTH untuk diskon 10% hari ini.')
    assert.deepEqual(
      p.buttons.map((b) => b.kind),
      ['reply', 'url', 'copy'],
    )
    assert.equal(p.buttons[2]?.text, 'Salin kode penawaran')
  })

  it('names the template type', () => {
    assert.equal(templateKind('AUTHENTICATION', []), 'OTP')
    assert.equal(templateKind('MARKETING', [{ type: 'BUTTONS', buttons: [{ type: 'FLOW' }] }]), 'FLOWS')
    assert.equal(templateKind('UTILITY', draftToComponents(marketing())), 'KUSTOM')
  })

  it('parses a partial draft with defaults', () => {
    const d = templateDraftSchema.parse({ category: 'UTILITY', kind: 'custom' })
    assert.equal(d.header.format, 'NONE')
    assert.deepEqual(d.buttons, [])
  })
})
