import { logger } from '../lib/logger.js'
import { validateButtons, validateList } from './limits.js'
import {
  ProviderError,
  type ChannelCredentials,
  type ChannelProvider,
  type OutboundMessage,
  type ProviderCapabilities,
  type RemoteTemplate,
  type SendResult,
} from './types.js'

/**
 * Meta error codes worth another attempt. Everything else is a permanent
 * rejection - retrying a 131047 (window closed) just burns quota five times
 * and still fails, so the send worker needs this split to be accurate.
 */
const RETRYABLE_CODES = new Set([
  1, // unknown/transient API error
  2, // service temporarily unavailable
  4, // app-level rate limit
  80007, // WABA rate limit
  130429, // cloud API message throughput reached
  131000, // generic internal error
  131056, // pair rate limit (same sender/recipient pair)
  133016, // temporary account restriction
])

/** Window closed - the caller must fall back to an approved template. */
export const RE_ENGAGEMENT_CODE = 131047

interface MetaErrorBody {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    error_data?: { details?: string }
    fbtrace_id?: string
  }
}

export class CloudApiProvider implements ChannelProvider {
  readonly name = 'cloud_api'

  capabilities(): ProviderCapabilities {
    return {
      buttons: true,
      list: true,
      ctaUrl: true,
      templates: true,
      media: true,
      customerServiceWindow: true,
    }
  }

  private base(creds: ChannelCredentials) {
    return `https://graph.facebook.com/${creds.graphVersion}`
  }

  private async call<T>(
    creds: ChannelCredentials,
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
  ): Promise<T> {
    const url = `${this.base(creds)}${path}`
    let res: Response
    try {
      res = await fetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      })
    } catch (cause) {
      // Network failure or timeout: always worth a retry.
      throw new ProviderError(`network error calling ${path}`, 'NETWORK', undefined, true, cause)
    }

    const text = await res.text()
    const json = text ? (JSON.parse(text) as T & MetaErrorBody) : ({} as T & MetaErrorBody)

    if (!res.ok) {
      const err = json.error ?? {}
      const code = err.code
      const retryable = res.status >= 500 || res.status === 429 || (code !== undefined && RETRYABLE_CODES.has(code))
      logger.warn(
        { path, status: res.status, code, subcode: err.error_subcode, fbtrace: err.fbtrace_id, channelId: creds.channelId },
        'cloud api error',
      )
      throw new ProviderError(
        err.message ?? `Graph API ${res.status}`,
        code !== undefined ? String(code) : undefined,
        res.status,
        retryable,
        err.error_data?.details,
      )
    }

    return json
  }

  async send(creds: ChannelCredentials, to: string, message: OutboundMessage): Promise<SendResult> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      ...toGraphPayload(message),
    }

    const res = await this.call<{
      messages?: { id: string }[]
      contacts?: { wa_id: string }[]
    }>(creds, `/${creds.phoneNumberId}/messages`, { method: 'POST', body: payload })

    const id = res.messages?.[0]?.id
    if (!id) throw new ProviderError('Graph API accepted the send but returned no message id', 'NO_MESSAGE_ID')

    return { waMessageId: id, normalizedWaId: res.contacts?.[0]?.wa_id }
  }

  async markRead(creds: ChannelCredentials, waMessageId: string): Promise<void> {
    await this.call(creds, `/${creds.phoneNumberId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', status: 'read', message_id: waMessageId },
    })
  }

  async getMediaUrl(creds: ChannelCredentials, mediaId: string) {
    const res = await this.call<{ url: string; mime_type: string; sha256: string }>(creds, `/${mediaId}`)
    return { url: res.url, mimeType: res.mime_type, sha256: res.sha256 }
  }

  async listTemplates(creds: ChannelCredentials): Promise<RemoteTemplate[]> {
    const out: RemoteTemplate[] = []
    let path: string | null = `/${creds.wabaId}/message_templates?limit=100`

    while (path) {
      const res: {
        data?: {
          id: string
          name: string
          language: string
          category: string
          status: string
          components?: unknown[]
          rejected_reason?: string
        }[]
        paging?: { next?: string; cursors?: { after?: string } }
      } = await this.call(creds, path)

      for (const t of res.data ?? []) {
        out.push({
          metaTemplateId: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          components: t.components ?? [],
          rejectionReason: t.rejected_reason,
        })
      }

      const after = res.paging?.cursors?.after
      path = res.paging?.next && after ? `/${creds.wabaId}/message_templates?limit=100&after=${after}` : null
    }

    return out
  }

  async subscribeApp(creds: ChannelCredentials): Promise<void> {
    await this.call(creds, `/${creds.wabaId}/subscribed_apps`, { method: 'POST' })
  }

  async getPhoneNumberHealth(creds: ChannelCredentials) {
    const res = await this.call<{
      display_phone_number: string
      quality_rating?: string
      verified_name?: string
      messaging_limit_tier?: string
    }>(creds, `/${creds.phoneNumberId}?fields=display_phone_number,quality_rating,verified_name,messaging_limit_tier`)

    return {
      displayPhone: res.display_phone_number,
      qualityRating: res.quality_rating ?? 'UNKNOWN',
      messagingTier: res.messaging_limit_tier ?? 'TIER_250',
      verifiedName: res.verified_name,
    }
  }
}

/** Maps our provider-neutral message onto Meta's wire format. */
function toGraphPayload(m: OutboundMessage): Record<string, unknown> {
  switch (m.kind) {
    case 'text':
      return { type: 'text', text: { body: m.body, preview_url: m.previewUrl ?? false } }

    case 'image':
    case 'video':
    case 'audio':
    case 'sticker':
      return { type: m.kind, [m.kind]: mediaRef(m) }

    case 'document':
      return { type: 'document', document: { ...mediaRef(m), filename: m.filename, caption: m.caption } }

    case 'location':
      return {
        type: 'location',
        location: { latitude: m.latitude, longitude: m.longitude, name: m.name, address: m.address },
      }

    case 'buttons': {
      validateButtons(m.body, m.buttons)
      return {
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(m.header
            ? {
                header:
                  m.header.type === 'text'
                    ? { type: 'text', text: m.header.text }
                    : { type: 'image', image: { link: m.header.link } },
              }
            : {}),
          body: { text: m.body },
          ...(m.footer ? { footer: { text: m.footer } } : {}),
          action: {
            buttons: m.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
          },
        },
      }
    }

    case 'list': {
      validateList(m.body, m.buttonText, m.sections)
      return {
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(m.header ? { header: { type: 'text', text: m.header } } : {}),
          body: { text: m.body },
          ...(m.footer ? { footer: { text: m.footer } } : {}),
          action: {
            button: m.buttonText,
            sections: m.sections.map((s) => ({
              title: s.title,
              rows: s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
            })),
          },
        },
      }
    }

    case 'cta_url':
      return {
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          ...(m.header ? { header: { type: 'text', text: m.header } } : {}),
          body: { text: m.body },
          ...(m.footer ? { footer: { text: m.footer } } : {}),
          action: { name: 'cta_url', parameters: { display_text: m.displayText, url: m.url } },
        },
      }

    case 'template':
      return {
        type: 'template',
        template: {
          name: m.name,
          language: { code: m.language },
          ...(m.components ? { components: m.components } : {}),
        },
      }
  }
}

function mediaRef(m: { link?: string; mediaId?: string; caption?: string }) {
  if (!m.link && !m.mediaId) throw new ProviderError('media requires either a link or a mediaId', 'BAD_MEDIA')
  return m.mediaId ? { id: m.mediaId, caption: m.caption } : { link: m.link, caption: m.caption }
}

export const cloudApiProvider = new CloudApiProvider()
