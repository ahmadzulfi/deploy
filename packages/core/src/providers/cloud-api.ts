import { logger } from '../lib/logger.js'
import { validateButtons, validateList } from './limits.js'
import {
  ProviderError,
  type ChannelCredentials,
  type ChannelProvider,
  type FlowCategory,
  type FlowValidationError,
  type OutboundMessage,
  type ProviderCapabilities,
  type RemoteFlow,
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
    /** Human-readable, set on validation failures such as a template rejected at submit. */
    error_user_title?: string
    error_user_msg?: string
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
    init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown } = { method: 'GET' },
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
        err.error_data?.details ?? err.error_user_msg,
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

  async downloadMedia(creds: ChannelCredentials, url: string): Promise<Response> {
    // Only Meta's own CDN: this sends the channel token, and a URL from
    // anywhere else would carry it off to whoever controls that host.
    const host = new URL(url).hostname
    if (!/(^|\.)(fbsbx|facebook|fbcdn|whatsapp)\.(com|net)$/.test(host)) {
      throw new ProviderError(`refusing to send the channel token to ${host}`, 'BAD_MEDIA_HOST')
    }
    let res: Response
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        signal: AbortSignal.timeout(60_000),
      })
    } catch (cause) {
      throw new ProviderError('network error downloading media', 'NETWORK', undefined, true, cause)
    }
    if (!res.ok) throw new ProviderError(`media download ${res.status}`, 'MEDIA_DOWNLOAD', res.status, res.status >= 500)
    return res
  }

  async uploadMedia(
    creds: ChannelCredentials,
    file: { data: Uint8Array; mimeType: string; filename: string },
  ): Promise<{ mediaId: string }> {
    const form = new FormData()
    form.set('messaging_product', 'whatsapp')
    form.set('type', file.mimeType)
    // Copied into a plain ArrayBuffer: Blob refuses a view that may sit on shared memory.
    form.set('file', new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.filename)

    let res: Response
    try {
      // Multipart, so not through call(): that one always sends JSON.
      res = await fetch(`${this.base(creds)}/${creds.phoneNumberId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      })
    } catch (cause) {
      throw new ProviderError('network error uploading media', 'NETWORK', undefined, true, cause)
    }

    const json = (await res.json().catch(() => ({}))) as { id?: string } & MetaErrorBody
    if (!res.ok || !json.id) {
      const err = json.error ?? {}
      logger.warn({ status: res.status, code: err.code, fbtrace: err.fbtrace_id, channelId: creds.channelId }, 'media upload failed')
      throw new ProviderError(
        err.message ?? `media upload ${res.status}`,
        err.code !== undefined ? String(err.code) : 'MEDIA_UPLOAD',
        res.status,
        res.status >= 500 || res.status === 429,
      )
    }
    return { mediaId: json.id }
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

  // ---------- Template authoring ----------
  //
  // Off the ChannelProvider interface like the Flows calls below: only Cloud
  // API has a template registry to write to.

  /** Submits a template for review. Meta answers with its first status, usually PENDING. */
  async createTemplate(
    creds: ChannelCredentials,
    p: { name: string; language: string; category: string; components: unknown[] },
  ): Promise<{ metaTemplateId: string; status: string; category: string }> {
    const res = await this.call<{ id: string; status?: string; category?: string }>(
      creds,
      `/${creds.wabaId}/message_templates`,
      { method: 'POST', body: p },
    )
    return { metaTemplateId: res.id, status: res.status ?? 'PENDING', category: res.category ?? p.category }
  }

  /** Deletes one language of a template; `hsm_id` keeps its siblings alive. */
  async deleteTemplate(creds: ChannelCredentials, p: { name: string; metaTemplateId: string }): Promise<void> {
    const q = new URLSearchParams({ name: p.name, hsm_id: p.metaTemplateId })
    await this.call(creds, `/${creds.wabaId}/message_templates?${q}`, { method: 'DELETE' })
  }

  /** The Meta App a token was issued for - what the Resumable Upload API is addressed to. */
  async appIdForToken(creds: ChannelCredentials): Promise<string> {
    const res = await this.call<{ id?: string }>(creds, '/app')
    if (!res.id) throw new ProviderError('token tidak terhubung ke Meta App mana pun', 'NO_APP')
    return res.id
  }

  /**
   * Uploads a media header's sample through the Resumable Upload API and
   * returns the handle a template's `example.header_handle` wants. Unlike a
   * send's media id, the handle is tied to the app, not to a phone number.
   */
  async uploadTemplateSample(
    creds: ChannelCredentials,
    appId: string,
    file: { data: Uint8Array; mimeType: string; filename: string },
  ): Promise<{ handle: string }> {
    const session = await this.call<{ id?: string }>(
      creds,
      `/${appId}/uploads?${new URLSearchParams({
        file_name: file.filename,
        file_length: String(file.data.byteLength),
        file_type: file.mimeType,
      })}`,
      { method: 'POST' },
    )
    if (!session.id) throw new ProviderError('Meta tidak membuka sesi upload', 'UPLOAD_SESSION')

    let res: Response
    try {
      // Raw bytes, and this endpoint wants "OAuth", not "Bearer".
      res = await fetch(`${this.base(creds)}/${session.id}`, {
        method: 'POST',
        headers: { Authorization: `OAuth ${creds.accessToken}`, file_offset: '0' },
        body: new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
        signal: AbortSignal.timeout(120_000),
      })
    } catch (cause) {
      throw new ProviderError('network error uploading template sample', 'NETWORK', undefined, true, cause)
    }

    const json = (await res.json().catch(() => ({}))) as { h?: string } & MetaErrorBody
    if (!res.ok || !json.h) {
      const err = json.error ?? {}
      logger.warn({ status: res.status, code: err.code, fbtrace: err.fbtrace_id, channelId: creds.channelId }, 'template sample upload failed')
      throw new ProviderError(
        err.message ?? `template sample upload ${res.status}`,
        err.code !== undefined ? String(err.code) : 'UPLOAD',
        res.status,
        res.status >= 500 || res.status === 429,
      )
    }
    return { handle: json.h }
  }

  /**
   * Every phone number registered under a WABA.
   *
   * This is what makes connecting an account self-service: the user supplies
   * the WABA id and a token, and the platform discovers the numbers rather
   * than making them copy a phone number id per line.
   */
  async listPhoneNumbers(creds: ChannelCredentials) {
    const res = await this.call<{
      data?: {
        id: string
        display_phone_number: string
        verified_name?: string
        quality_rating?: string
        messaging_limit_tier?: string
        code_verification_status?: string
      }[]
    }>(
      creds,
      `/${creds.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status&limit=100`,
    )

    return (res.data ?? []).map((n) => ({
      phoneNumberId: n.id,
      displayPhone: n.display_phone_number,
      verifiedName: n.verified_name ?? null,
      qualityRating: n.quality_rating ?? 'UNKNOWN',
      messagingTier: n.messaging_limit_tier ?? 'TIER_250',
    }))
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

  // ---------- WhatsApp Flows ----------
  //
  // Not on the ChannelProvider interface yet: only Cloud API can do any of
  // this, and the flow node that will need it does not exist. Promote them
  // when a second caller appears.

  /**
   * Creates a Flow, always as a DRAFT.
   *
   * Publishing is deliberately a separate call. A published Flow can never be
   * edited or deleted - only deprecated - so a create that publishes in one
   * step would turn a typo into permanent clutter on the WABA.
   */
  async createFlow(
    creds: ChannelCredentials,
    p: { name: string; categories: FlowCategory[]; flowJson: unknown },
  ): Promise<{ metaFlowId: string; validationErrors: FlowValidationError[] }> {
    const res = await this.call<{ id: string; validation_errors?: RawValidationError[] }>(
      creds,
      `/${creds.wabaId}/flows`,
      {
        method: 'POST',
        // Meta wants the Flow JSON as a *string* field, not a nested object.
        body: { name: p.name, categories: p.categories, flow_json: JSON.stringify(p.flowJson) },
      },
    )
    return { metaFlowId: res.id, validationErrors: (res.validation_errors ?? []).map(toValidationError) }
  }

  async listFlows(creds: ChannelCredentials): Promise<RemoteFlow[]> {
    const out: RemoteFlow[] = []
    let path: string | null = `/${creds.wabaId}/flows?limit=100`

    while (path) {
      const res: { data?: RawFlow[]; paging?: { next?: string } } = await this.call(creds, path)
      for (const f of res.data ?? []) out.push(toRemoteFlow(f))
      path = res.paging?.next ? res.paging.next.replace(this.base(creds), '') : null
    }
    return out
  }

  async getFlow(creds: ChannelCredentials, metaFlowId: string): Promise<RemoteFlow> {
    const res = await this.call<RawFlow>(
      creds,
      `/${metaFlowId}?fields=id,name,status,categories,validation_errors`,
    )
    return toRemoteFlow(res)
  }

  /** Point of no return: after this the Flow can only be deprecated. */
  async publishFlow(creds: ChannelCredentials, metaFlowId: string): Promise<void> {
    await this.call(creds, `/${metaFlowId}/publish`, { method: 'POST' })
  }

  /** Only works while the Flow is still DRAFT. */
  async deleteFlow(creds: ChannelCredentials, metaFlowId: string): Promise<void> {
    await this.call(creds, `/${metaFlowId}`, { method: 'DELETE' })
  }

  async deprecateFlow(creds: ChannelCredentials, metaFlowId: string): Promise<void> {
    await this.call(creds, `/${metaFlowId}/deprecate`, { method: 'POST' })
  }
}

interface RawValidationError {
  error: string
  error_type?: string
  message: string
  line_start?: number
  line_end?: number
  column_start?: number
  column_end?: number
}

interface RawFlow {
  id: string
  name: string
  status: string
  categories?: string[]
  validation_errors?: RawValidationError[]
}

function toValidationError(e: RawValidationError): FlowValidationError {
  return {
    error: e.error,
    errorType: e.error_type,
    message: e.message,
    lineStart: e.line_start,
    lineEnd: e.line_end,
    columnStart: e.column_start,
    columnEnd: e.column_end,
  }
}

function toRemoteFlow(f: RawFlow): RemoteFlow {
  return {
    metaFlowId: f.id,
    name: f.name,
    status: f.status as RemoteFlow['status'],
    categories: f.categories ?? [],
    validationErrors: (f.validation_errors ?? []).map(toValidationError),
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

    case 'flow':
      return {
        type: 'interactive',
        interactive: {
          type: 'flow',
          ...(m.header ? { header: { type: 'text', text: m.header } } : {}),
          body: { text: m.body },
          ...(m.footer ? { footer: { text: m.footer } } : {}),
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_id: m.metaFlowId,
              flow_token: m.flowToken,
              flow_cta: m.cta,
              mode: m.mode ?? 'published',
              // "navigate" opens a screen we already know; "data_exchange"
              // would ask a business endpoint which screen comes next, and we
              // deliberately run no such endpoint.
              flow_action: 'navigate',
              flow_action_payload: {
                screen: m.screen,
                ...(m.prefill ? { data: m.prefill } : {}),
              },
            },
          },
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
