#!/usr/bin/env node
/**
 * Posts a correctly-signed Meta webhook at the local receiver.
 *
 * Lets you exercise the whole inbound path - signature check, persistence,
 * queue, worker, contact/conversation/message rows - without ngrok, without
 * Meta, and without spending a real conversation.
 *
 *   node tools/fake-webhook.mjs --phone-id 123 --from 628123456789 --text "halo"
 *   node tools/fake-webhook.mjs --phone-id 123 --from 628123456789 --button btn_yes
 *   node tools/fake-webhook.mjs --phone-id 123 --status delivered --wamid wamid.XXX
 */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const arg = (f, d) => {
  const i = process.argv.indexOf(`--${f}`)
  return i >= 0 ? process.argv[i + 1] : d
}

function envValue(key) {
  const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`))
  if (!line) throw new Error(`${key} not found in .env`)
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '')
}

const phoneNumberId = arg('phone-id')
if (!phoneNumberId) {
  console.error('Missing --phone-id. Run "pnpm channel:list" to find it.')
  process.exit(1)
}

const from = arg('from', '628999000111')
const wamid = arg('wamid', `wamid.FAKE_${Date.now()}`)
const timestamp = String(Math.floor(Date.now() / 1000))
const statusKind = arg('status')
const button = arg('button')

const value = {
  metadata: { phone_number_id: phoneNumberId, display_phone_number: 'local' },
  ...(statusKind
    ? {
        statuses: [
          {
            id: wamid,
            status: statusKind,
            timestamp,
            ...(statusKind === 'failed'
              ? { errors: [{ code: 131047, title: 'Re-engagement message' }] }
              : {}),
          },
        ],
      }
    : {
        contacts: [{ wa_id: from, profile: { name: arg('name', 'Uji Coba') } }],
        messages: [
          button
            ? {
                id: wamid,
                from,
                timestamp,
                type: 'interactive',
                interactive: { type: 'button_reply', button_reply: { id: button, title: button } },
              }
            : { id: wamid, from, timestamp, type: 'text', text: { body: arg('text', 'halo') } },
        ],
      }),
}

const body = Buffer.from(
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: arg('waba', 'LOCAL_WABA'), changes: [{ field: 'messages', value }] }],
  }),
)

const signature = 'sha256=' + createHmac('sha256', envValue('META_APP_SECRET')).update(body).digest('hex')
const port = arg('port', envValue('WEBHOOK_PORT') || '3001')

const res = await fetch(`http://localhost:${port}/webhooks/whatsapp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
  body,
})

console.log(`HTTP ${res.status}  ${statusKind ? `status=${statusKind}` : `wamid=${wamid}`}`)
if (res.status !== 200) process.exit(1)
