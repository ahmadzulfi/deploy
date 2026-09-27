import { prisma, OptInStatus } from '@wa/db'
import {
  credentialsFor,
  env,
  providerFor,
  ProviderError,
  RE_ENGAGEMENT_CODE,
  type OutboundMessage,
} from '@wa/core'

/**
 * Sends one message directly, bypassing the queue. This is the fase 1
 * milestone check: prove a round trip on each registered number.
 *
 *   pnpm send:test --channel <channelId> --to 628123456789 --text "halo"
 *   pnpm send:test --channel <channelId> --to 628123456789 --buttons
 *   pnpm send:test --channel <channelId> --to 628123456789 --flow <metaFlowId> --draft
 *
 * The --buttons variant is the one worth running, because it exercises the
 * interactive payload the whole flow builder is built on.
 */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function has(flag: string) {
  return process.argv.includes(`--${flag}`)
}

async function main() {
  env()

  const channelId = arg('channel')
  const to = arg('to')
  if (!channelId || !to) {
    console.error('Usage: pnpm send:test --channel <channelId> --to <62...> [--text "halo" | --buttons]')
    process.exit(1)
  }

  // Catch the placeholder before spending a Graph API call on it. Meta answers
  // a malformed number with "(#131009) Parameter value is not valid", which
  // says nothing about which parameter.
  if (!/^\d{8,15}$/.test(to)) {
    throw new Error(
      `"${to}" is not a phone number. Use E.164 digits with no '+' or spaces, e.g. 6285111213481`,
    )
  }

  const channel = await prisma.channel.findUnique({ where: { id: channelId } })
  if (!channel) throw new Error(`channel ${channelId} not found - run "pnpm channel:list"`)

  const metaFlowId = arg('flow')

  const message: OutboundMessage = metaFlowId
    ? {
        kind: 'flow',
        body: 'Ini tes form dari platform internal. Ketuk tombol di bawah untuk membukanya.',
        footer: 'Pesan otomatis',
        cta: arg('cta') ?? 'Buka Form',
        metaFlowId,
        screen: arg('screen') ?? 'PENDAFTARAN',
        // Correlates the submitted answers back to this send. A real flow run
        // will put its session id here; a throwaway test only needs it unique.
        flowToken: `test-${Date.now()}`,
        // A DRAFT flow only opens for people with access to the WABA, which is
        // exactly what makes it safe to try before publishing.
        mode: has('draft') ? 'draft' : 'published',
      }
    : has('buttons')
      ? {
          kind: 'buttons',
          body: 'Ini tes tombol dari platform internal. Pilih salah satu:',
          footer: 'Pesan otomatis',
          buttons: [
            { id: 'btn_yes', title: 'Ya, lanjut' },
            { id: 'btn_no', title: 'Tidak' },
            { id: 'btn_agent', title: 'Bicara dengan CS' },
          ],
        }
      : { kind: 'text', body: arg('text') ?? 'Tes dari platform internal.' }

  const provider = providerFor(channel)

  // This script talks to the provider directly, so it skips the send worker's
  // 24h window guard. Buttons and plain text are free-form: if the recipient
  // has never messaged this number, Meta rejects them and only an approved
  // template will get through.
  let result
  try {
    result = await provider.send(credentialsFor(channel), to, message)
  } catch (err) {
    if (err instanceof ProviderError && err.code === String(RE_ENGAGEMENT_CODE)) {
      throw new Error(
        `24h window is closed for ${to}. Message ${channel.displayPhone} from that phone first, ` +
          `then re-run within 24h - or send an approved template instead.`,
      )
    }
    throw err
  }

  console.log(`Sent via ${channel.name} (${channel.displayPhone})`)
  console.log(`  waMessageId: ${result.waMessageId}`)

  // Persist it so the inbound status callbacks have a row to attach to -
  // otherwise the delivered/read webhooks arrive and get logged as orphans.
  const contact = await prisma.contact.upsert({
    where: { orgId_waId: { orgId: channel.orgId, waId: result.normalizedWaId ?? to } },
    create: {
      orgId: channel.orgId,
      waId: result.normalizedWaId ?? to,
      optInStatus: OptInStatus.UNKNOWN,
    },
    update: {},
  })

  const conversation = await prisma.conversation.upsert({
    where: { channelId_contactId: { channelId: channel.id, contactId: contact.id } },
    create: { channelId: channel.id, contactId: contact.id, lastMessageAt: new Date() },
    update: { lastMessageAt: new Date() },
  })

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUT',
      waMessageId: result.waMessageId,
      type: message.kind,
      payload: message as never,
      status: 'SENT',
      sentBy: 'system',
      sentAt: new Date(),
    },
  })

  console.log(`  conversation: ${conversation.id}`)
  console.log('\nNow reply from WhatsApp and watch the worker log for "inbound message stored".')
}

// Disconnect BEFORE exiting. process.exit() inside .catch() runs while
// Prisma is still tearing down its connection pool, and libuv aborts the
// process with a handle assertion instead of reporting the real error.
try {
  await main()
} catch (err) {
  console.error()
  console.error('Failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
