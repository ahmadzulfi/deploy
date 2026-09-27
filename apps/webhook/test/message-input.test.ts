import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { freeFormMessage, sendSchema } from '../src/message-input.ts'

const to = '6281234567890'
const ok = (body: object) => {
  const r = sendSchema.safeParse({ to, ...body })
  if (!r.success) assert.fail(`ditolak: ${r.error.issues[0]?.path.join('.')}: ${r.error.issues[0]?.message}`)
  return r.data
}
const bad = (body: object, pattern: RegExp) => {
  const r = sendSchema.safeParse({ to, ...body })
  assert.equal(r.success, false, 'seharusnya ditolak')
  if (!r.success) {
    const i = r.error.issues[0]!
    assert.match(`${i.path.join('.')}: ${i.message}`, pattern)
  }
}

describe('POST /messages body', () => {
  it('takes exactly one kind of message', () => {
    bad({}, /tepat satu/)
    bad({ text: 'a', location: { latitude: 0, longitude: 0 } }, /tepat satu/)
  })

  it('buttons: enforces WhatsApp limits with the shared validator', () => {
    const b = ok({ buttons: { body: 'Pilih', buttons: [{ id: 'ya', title: 'Ya' }, { id: 'tidak', title: 'Tidak' }] } })
    assert.deepEqual(freeFormMessage(b), { kind: 'buttons', body: 'Pilih', buttons: [{ id: 'ya', title: 'Ya' }, { id: 'tidak', title: 'Tidak' }] })

    const four = [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: `B${n}` }))
    bad({ buttons: { body: 'x', buttons: four } }, /maksimum|allows 3/)
    bad({ buttons: { body: 'x', buttons: [{ id: 'a', title: 'x'.repeat(21) }] } }, /20/)
    bad({ buttons: { body: 'x', buttons: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] } }, /duplicate/)
    bad({ buttons: { body: 'x', header: 'H', headerImage: 'https://c.com/a.jpg', buttons: [{ id: 'a', title: 'A' }] } }, /header atau headerImage/)
  })

  it('buttons: an image header becomes the provider header shape', () => {
    const m = freeFormMessage(ok({ buttons: { body: 'x', headerImage: 'https://c.com/a.jpg', buttons: [{ id: 'a', title: 'A' }] } }))
    assert.deepEqual(m.kind === 'buttons' && m.header, { type: 'image', link: 'https://c.com/a.jpg' })
  })

  it('list: counts rows across every section', () => {
    const rows = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, title: `R${i}` }))
    ok({ list: { body: 'x', buttonText: 'Menu', sections: [{ title: 'A', rows: rows(5, 'a') }, { title: 'B', rows: rows(5, 'b') }] } })
    bad({ list: { body: 'x', buttonText: 'Menu', sections: [{ title: 'A', rows: rows(6, 'a') }, { title: 'B', rows: rows(5, 'b') }] } }, /10/)
  })

  it('ctaUrl: needs an https link', () => {
    const m = freeFormMessage(ok({ ctaUrl: { body: 'Cek status', displayText: 'Buka', url: 'https://contoh.com/s' } }))
    assert.equal(m.kind, 'cta_url')
    bad({ ctaUrl: { body: 'x', displayText: 'Buka', url: 'http://contoh.com' } }, /https/)
  })

  it('location: rejects coordinates off the globe', () => {
    const m = freeFormMessage(ok({ location: { latitude: -6.87, longitude: 107.54, name: 'Kantor' } }))
    assert.deepEqual(m, { kind: 'location', latitude: -6.87, longitude: 107.54, name: 'Kantor' })
    bad({ location: { latitude: 91, longitude: 0 } }, /latitude/)
  })

  it('sticker: link or mediaId, never a caption', () => {
    assert.deepEqual(freeFormMessage(ok({ sticker: { mediaId: '123' } })), { kind: 'sticker', mediaId: '123' })
    bad({ sticker: { mediaId: '123', caption: 'x' } }, /Unrecognized/)
  })

  it('flow: generates a token when none is given, keeps the caller\'s otherwise', () => {
    const base = { body: 'Isi formulir', cta: 'Buka', flowId: '1848826199609180', screen: 'PENDAFTARAN' }
    const gen = freeFormMessage(ok({ flow: base }))
    assert.equal(gen.kind === 'flow' && gen.flowToken.startsWith('api_'), true)
    assert.equal(gen.kind === 'flow' && gen.mode, 'published')

    const own = freeFormMessage(ok({ flow: { ...base, flowToken: 'lap-42', data: { nama: 'Budi' }, mode: 'draft' } }))
    assert.equal(own.kind === 'flow' && own.flowToken, 'lap-42')
    assert.deepEqual(own.kind === 'flow' && own.prefill, { nama: 'Budi' })
    assert.equal(own.kind === 'flow' && own.metaFlowId, '1848826199609180')
  })

  it('media kinds keep their earlier rules', () => {
    bad({ image: { link: 'http://c.com/a.jpg' } }, /https/)
    bad({ audio: { link: 'https://c.com/a.ogg', caption: 'x' } }, /Unrecognized/)
    bad({ document: { link: 'https://c.com/a.pdf', mediaId: '1' } }, /salah satu/)
  })
})
