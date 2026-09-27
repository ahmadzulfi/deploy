import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCloudApiWebhook } from '../src/providers/normalize.ts'

/** Builds Meta's envelope around a single `changes[].value` payload. */
function envelope(value: unknown, wabaId = 'WABA_1') {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: wabaId, changes: [{ field: 'messages', value }] }],
  }
}

const TS = '1758369600' // 2025-09-20T12:00:00Z

describe('inbound messages', () => {
  test('normalizes a text message with the sender profile', () => {
    const [e] = normalizeCloudApiWebhook(
      envelope({
        metadata: { phone_number_id: 'PN_1', display_phone_number: '628111' },
        contacts: [{ wa_id: '628123', profile: { name: 'Budi' } }],
        messages: [{ id: 'wamid.AAA', from: '628123', timestamp: TS, type: 'text', text: { body: 'halo' } }],
      }),
    )

    assert.equal(e?.kind, 'message')
    if (e?.kind !== 'message') return
    assert.equal(e.channelPhoneNumberId, 'PN_1')
    assert.equal(e.waMessageId, 'wamid.AAA')
    assert.equal(e.from, '628123')
    assert.equal(e.profileName, 'Budi')
    assert.deepEqual(e.message, { type: 'text', body: 'halo' })
    assert.equal(e.timestamp.toISOString(), '2025-09-20T12:00:00.000Z')
  })

  test('exposes the button id, not the label, so renaming a button cannot break a flow', () => {
    const [e] = normalizeCloudApiWebhook(
      envelope({
        metadata: { phone_number_id: 'PN_1' },
        messages: [
          {
            id: 'wamid.B',
            from: '628123',
            timestamp: TS,
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'btn_yes', title: 'Ya, lanjut' } },
          },
        ],
      }),
    )

    if (e?.kind !== 'message') throw new Error('expected a message event')
    assert.equal(e.interactiveReplyId, 'btn_yes')
    assert.equal(e.message.type, 'interactive')
  })

  test('treats a template quick reply payload as a reply id too', () => {
    // Template quick replies arrive as type "button", not "interactive".
    const [e] = normalizeCloudApiWebhook(
      envelope({
        metadata: { phone_number_id: 'PN_1' },
        messages: [
          { id: 'wamid.C', from: '628123', timestamp: TS, type: 'button', button: { payload: 'PROMO_YES', text: 'Mau' } },
        ],
      }),
    )

    if (e?.kind !== 'message') throw new Error('expected a message event')
    assert.equal(e.interactiveReplyId, 'PROMO_YES')
  })

  test('keeps an unrecognized type instead of dropping it', () => {
    const [e] = normalizeCloudApiWebhook(
      envelope({
        metadata: { phone_number_id: 'PN_1' },
        messages: [{ id: 'm', from: '6281', timestamp: TS, type: 'reaction' }],
      }),
    )

    if (e?.kind !== 'message') throw new Error('expected a message event')
    assert.equal(e.message.type, 'unsupported')
  })
})

describe('multi-channel routing', () => {
  test('tags each event with its own phone_number_id when one payload spans two numbers', () => {
    // This is the whole multi-WABA premise: one webhook URL, many numbers.
    const events = normalizeCloudApiWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'W1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'PN_1' },
                messages: [{ id: 'm1', from: '6281', timestamp: TS, type: 'text', text: { body: 'a' } }],
              },
            },
          ],
        },
        {
          id: 'W2',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'PN_2' },
                messages: [{ id: 'm2', from: '6282', timestamp: TS, type: 'text', text: { body: 'b' } }],
              },
            },
          ],
        },
      ],
    })

    assert.equal(events.length, 2)
    assert.deepEqual(
      events.map((e) => e.channelPhoneNumberId),
      ['PN_1', 'PN_2'],
    )
  })
})

describe('status callbacks', () => {
  test('carries the error code so the sender can tell retryable from terminal', () => {
    const [e] = normalizeCloudApiWebhook(
      envelope({
        metadata: { phone_number_id: 'PN_1' },
        statuses: [
          { id: 'wamid.X', status: 'failed', timestamp: TS, errors: [{ code: 131047, title: 'Re-engagement message' }] },
        ],
      }),
    )

    if (e?.kind !== 'status') throw new Error('expected a status event')
    assert.equal(e.status, 'failed')
    assert.equal(e.errorCode, '131047')
    assert.equal(e.errorMessage, 'Re-engagement message')
  })
})

describe('guards', () => {
  test('ignores payloads that are not WhatsApp', () => {
    assert.equal(normalizeCloudApiWebhook({ object: 'page', entry: [] }).length, 0)
  })

  test('survives a malformed payload without throwing', () => {
    assert.equal(normalizeCloudApiWebhook(null).length, 0)
    assert.equal(normalizeCloudApiWebhook({}).length, 0)
  })
})

describe('WhatsApp Flows submissions', () => {
  const submitted = (responseJson: string) =>
    normalizeCloudApiWebhook(
      envelope({
        metadata: { phone_number_id: 'PN_1' },
        messages: [
          {
            id: 'wamid.FORM',
            from: '628123',
            timestamp: TS,
            type: 'interactive',
            interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: responseJson } },
          },
        ],
      }),
    )[0]

  test('keeps the answers and lifts the flow token out of them', () => {
    const e = submitted('{"flow_token":"api_abc","nama":"Budi","rw":"05"}')
    assert.equal(e?.kind, 'message')
    if (e?.kind !== 'message') return
    assert.deepEqual(e.message, { type: 'form_reply', flowToken: 'api_abc', response: { nama: 'Budi', rw: '05' } })
    // Not a button tap: no reply id for a flow trigger to misread.
    assert.equal(e.interactiveReplyId, undefined)
  })

  test('keeps an unparseable submission as raw text instead of dropping it', () => {
    const e = submitted('{not json')
    if (e?.kind !== 'message') return assert.fail('expected a message')
    assert.deepEqual(e.message, { type: 'form_reply', response: { _raw: '{not json' } })
  })
})
