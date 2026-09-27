import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { campaignAudienceSchema, renderCampaignValues } from '../src/campaign.ts'

const channel = { name: 'CS Utama', displayPhone: '+62 811' }

describe('renderCampaignValues', () => {
  it('personalises each blank from the contact', () => {
    const { values, empty } = renderCampaignValues(
      { 'body.1': 'Halo {{contact.name}}', 'body.2': '{{contact.kelurahan}}', 'header.1': '{{channel.name}}' },
      { name: 'Budi', waId: '62811', attributes: { kelurahan: 'Cibabat' } },
      channel,
    )
    assert.deepEqual(values, { 'body.1': 'Halo Budi', 'body.2': 'Cibabat', 'header.1': 'CS Utama' })
    assert.deepEqual(empty, [])
  })

  it('reports blanks that came out empty instead of sending them', () => {
    const { empty } = renderCampaignValues({ 'body.1': '{{contact.name}}' }, { name: null, waId: '62811' }, channel)
    assert.deepEqual(empty, ['body.1'])
  })

  it('flattens characters Meta refuses inside a parameter', () => {
    const { values } = renderCampaignValues(
      { 'body.1': '{{contact.alamat}}' },
      { waId: '62811', attributes: { alamat: 'Jl. Merdeka\nNo. 5\t     RT 02' } },
      channel,
    )
    assert.equal(values['body.1'], 'Jl. Merdeka No. 5     RT 02'.replace(/ {5,}/g, '    '))
    assert.doesNotMatch(values['body.1']!, /[\n\t]| {5,}/)
  })

  it('leaves a media header link exactly as written', () => {
    const { values } = renderCampaignValues({ 'header.media': ' https://contoh.com/a.jpg ' }, { waId: '62811' }, channel)
    assert.equal(values['header.media'], 'https://contoh.com/a.jpg')
  })
})

describe('campaignAudienceSchema', () => {
  it('defaults to everyone who opted in', () => {
    assert.deepEqual(campaignAudienceSchema.parse({}), { tags: [], match: 'any', optInOnly: true })
  })
})
