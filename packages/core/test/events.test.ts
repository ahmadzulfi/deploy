import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { messageEventData, signWebhook, webhookEnvelope } from '../src/lib/events.ts'

describe('signWebhook', () => {
  it('signs timestamp.body with HMAC-SHA256, the way the docs (api/webhook-keluar) tell receivers to verify', () => {
    const body = '{"a":1}'
    const expected = createHmac('sha256', 'whsec_x').update(`1700000000.${body}`).digest('hex')
    assert.equal(signWebhook('whsec_x', 1700000000, body), `sha256=${expected}`)
  })

  it('changes when the timestamp changes, so an old request cannot be re-dated', () => {
    assert.notEqual(signWebhook('s', 1, 'b'), signWebhook('s', 2, 'b'))
  })
})

describe('webhookEnvelope', () => {
  it('wraps data with id, event and ISO time', () => {
    const json = JSON.parse(
      webhookEnvelope({ id: 'd1', event: 'ping', data: { x: 1 }, createdAt: new Date('2026-09-23T00:00:00Z') }),
    )
    assert.deepEqual(json, { id: 'd1', event: 'ping', createdAt: '2026-09-23T00:00:00.000Z', data: { x: 1 } })
  })
})

describe('messageEventData', () => {
  const conv = {
    id: 'c1',
    channel: { id: 'ch1', name: 'CS', displayPhone: '+62 811' },
    contact: { waId: '62811', name: 'Sari' },
  }
  const base = {
    id: 'm1',
    waMessageId: 'wamid.1',
    type: 'text',
    payload: { body: 'halo' },
    sentBy: 'contact',
    createdAt: new Date('2026-09-23T01:02:03Z'),
  }

  it('describes an inbound message', () => {
    assert.deepEqual(messageEventData({ ...base, direction: 'IN', status: 'DELIVERED' }, conv), {
      messageId: 'm1',
      waMessageId: 'wamid.1',
      conversationId: 'c1',
      direction: 'inbound',
      type: 'text',
      content: { body: 'halo' },
      status: 'delivered',
      sentBy: 'contact',
      channel: { id: 'ch1', name: 'CS', phone: '+62 811' },
      contact: { waId: '62811', name: 'Sari' },
      timestamp: '2026-09-23T01:02:03.000Z',
    })
  })

  it('carries the error and extra fields for a failed send', () => {
    const d = messageEventData(
      { ...base, direction: 'OUT', status: 'FAILED', errorCode: '131047', errorMessage: 'window' },
      conv,
      { requestId: '42' },
    )
    assert.equal(d.direction, 'outbound')
    assert.deepEqual(d.error, { code: '131047', message: 'window' })
    assert.equal(d.requestId, '42')
  })
})
