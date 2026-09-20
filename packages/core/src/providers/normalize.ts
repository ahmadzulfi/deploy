import type { NormalizedEvent } from './types.js'

/**
 * Flattens Meta's nested webhook envelope into a list of events we can process
 * one at a time.
 *
 * The shape is entry[] -> changes[] -> value{ messages[] | statuses[] }, and a
 * single POST can legitimately carry several numbers' traffic - which is why
 * every emitted event carries its own channelPhoneNumberId rather than the
 * caller assuming one payload means one channel.
 */
export function normalizeCloudApiWebhook(raw: unknown): NormalizedEvent[] {
  const out: NormalizedEvent[] = []

  // The input is whatever JSON arrived over the wire. A malformed body must
  // produce zero events, never an exception that fails the whole webhook job.
  if (!raw || typeof raw !== 'object') return out

  const body = raw as {
    object?: string
    entry?: {
      id?: string
      changes?: {
        field?: string
        value?: {
          metadata?: { phone_number_id?: string; display_phone_number?: string }
          contacts?: { wa_id?: string; profile?: { name?: string } }[]
          messages?: MetaMessage[]
          statuses?: MetaStatus[]
        }
      }[]
    }[]
  }

  if (body.object !== 'whatsapp_business_account') return out

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id

      if (change.field !== 'messages' || !phoneNumberId) {
        out.push({
          kind: 'account_update',
          channelPhoneNumberId: phoneNumberId,
          wabaId: entry.id,
          event: change.field ?? 'unknown',
          raw: change,
        })
        continue
      }

      const profileName = value?.contacts?.[0]?.profile?.name

      for (const m of value?.messages ?? []) {
        if (!m.id || !m.from) continue
        out.push({
          kind: 'message',
          channelPhoneNumberId: phoneNumberId,
          waMessageId: m.id,
          from: m.from,
          profileName,
          timestamp: toDate(m.timestamp),
          contextMessageId: m.context?.id,
          interactiveReplyId: replyIdOf(m),
          message: toInboundMessage(m),
        })
      }

      for (const s of value?.statuses ?? []) {
        if (!s.id || !s.status) continue
        const err = s.errors?.[0]
        out.push({
          kind: 'status',
          channelPhoneNumberId: phoneNumberId,
          waMessageId: s.id,
          status: s.status as 'sent' | 'delivered' | 'read' | 'failed',
          timestamp: toDate(s.timestamp),
          errorCode: err?.code !== undefined ? String(err.code) : undefined,
          errorMessage: err?.title ?? err?.message,
        })
      }
    }
  }

  return out
}

interface MetaMessage {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  context?: { id?: string }
  text?: { body?: string }
  interactive?: {
    type?: string
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string; description?: string }
  }
  button?: { payload?: string; text?: string }
  image?: MetaMedia
  video?: MetaMedia
  audio?: MetaMedia
  document?: MetaMedia & { filename?: string }
  sticker?: MetaMedia
  location?: { latitude?: number; longitude?: number; name?: string; address?: string }
}

interface MetaMedia {
  id?: string
  mime_type?: string
  caption?: string
}

interface MetaStatus {
  id?: string
  status?: string
  timestamp?: string
  errors?: { code?: number; title?: string; message?: string }[]
}

/** Meta sends unix seconds as a string. */
function toDate(ts?: string): Date {
  const n = Number(ts)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date()
}

/**
 * The id a button tap or list pick carries. Flow triggers match on this rather
 * than on the visible label, so renaming a button never breaks a live flow.
 */
function replyIdOf(m: MetaMessage): string | undefined {
  if (m.type === 'interactive') {
    return m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id
  }
  // Quick-reply buttons on template messages arrive as type "button".
  if (m.type === 'button') return m.button?.payload
  return undefined
}

function toInboundMessage(m: MetaMessage): Extract<NormalizedEvent, { kind: 'message' }>['message'] {
  switch (m.type) {
    case 'text':
      return { type: 'text', body: m.text?.body ?? '' }

    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply
      return { type: 'interactive', replyId: r?.id ?? '', title: r?.title ?? '' }
    }

    case 'button':
      return { type: 'button', payload: m.button?.payload ?? '', text: m.button?.text ?? '' }

    case 'image':
    case 'video':
    case 'audio':
    case 'sticker':
    case 'document': {
      const media = m[m.type] as (MetaMedia & { filename?: string }) | undefined
      return {
        type: m.type,
        mediaId: media?.id ?? '',
        mimeType: media?.mime_type,
        caption: media?.caption,
        filename: media?.filename,
      }
    }

    case 'location':
      return {
        type: 'location',
        latitude: m.location?.latitude ?? 0,
        longitude: m.location?.longitude ?? 0,
        name: m.location?.name,
        address: m.location?.address,
      }

    default:
      // Reactions, orders, system messages, and anything Meta ships next.
      // Stored verbatim so an unhandled type is visible instead of dropped.
      return { type: 'unsupported', raw: m }
  }
}
