/**
 * The seam between the platform and whatever is actually moving bytes to
 * WhatsApp. Everything above this line (flow engine, inbox, campaigns) talks in
 * these shapes and never touches a Graph API URL.
 *
 * Adding Baileys later means implementing this interface and reporting a
 * narrower `capabilities()` - no changes to the callers.
 */

export interface ChannelCredentials {
  channelId: string
  phoneNumberId: string
  wabaId: string
  /** Decrypted at the call site; never persisted or logged in this form. */
  accessToken: string
  graphVersion: string
}

// ---------- Outbound ----------

export type OutboundMessage =
  | { kind: 'text'; body: string; previewUrl?: boolean }
  | { kind: 'image'; link?: string; mediaId?: string; caption?: string }
  | { kind: 'video'; link?: string; mediaId?: string; caption?: string }
  | { kind: 'audio'; link?: string; mediaId?: string }
  | { kind: 'document'; link?: string; mediaId?: string; filename?: string; caption?: string }
  | { kind: 'sticker'; link?: string; mediaId?: string }
  | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string }
  | {
      kind: 'buttons'
      header?: { type: 'text'; text: string } | { type: 'image'; link: string }
      body: string
      footer?: string
      buttons: { id: string; title: string }[]
    }
  | {
      kind: 'list'
      header?: string
      body: string
      footer?: string
      buttonText: string
      sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]
    }
  | { kind: 'cta_url'; header?: string; body: string; footer?: string; displayText: string; url: string }
  | {
      kind: 'flow'
      header?: string
      body: string
      footer?: string
      /** Label on the button that opens the form. */
      cta: string
      metaFlowId: string
      /** Screen the form opens on, as named in the Flow JSON. */
      screen: string
      /**
       * Our own correlation id, echoed back with the submitted answers. The
       * webhook carries no node or session reference of its own, so without
       * this a reply cannot be matched to the run that asked for it.
       */
      flowToken: string
      /** Seeded into the screen's `data` before it renders. */
      prefill?: Record<string, unknown>
      /** DRAFT flows only reach people with access to the WABA. */
      mode?: 'draft' | 'published'
    }
  | {
      kind: 'template'
      name: string
      language: string
      components?: unknown[]
    }

export interface SendResult {
  waMessageId: string
  /** Meta may normalize the number it actually delivered to. */
  normalizedWaId?: string
}

// ---------- Inbound ----------

export type NormalizedEvent =
  | {
      kind: 'message'
      channelPhoneNumberId: string
      waMessageId: string
      from: string
      profileName?: string
      timestamp: Date
      /** Set when the user tapped a button or picked a list row. */
      interactiveReplyId?: string
      /** Meta's own reference when the user replies to a specific message. */
      contextMessageId?: string
      message:
        | { type: 'text'; body: string }
        | { type: 'interactive'; replyId: string; title: string }
        | { type: 'button'; payload: string; text: string }
        | { type: 'image' | 'video' | 'audio' | 'document' | 'sticker'; mediaId: string; mimeType?: string; caption?: string; filename?: string }
        | { type: 'location'; latitude: number; longitude: number; name?: string; address?: string }
        /**
         * A submitted WhatsApp Flows form. `flowToken` is the one we sent with
         * the form, which is how an answer finds the request that asked for it.
         */
        | { type: 'form_reply'; flowToken?: string; response: Record<string, unknown> }
        | { type: 'unsupported'; raw: unknown }
    }
  | {
      kind: 'status'
      channelPhoneNumberId: string
      waMessageId: string
      status: 'sent' | 'delivered' | 'read' | 'failed'
      timestamp: Date
      errorCode?: string
      errorMessage?: string
    }
  | {
      kind: 'account_update'
      channelPhoneNumberId?: string
      wabaId?: string
      event: string
      raw: unknown
    }

export interface ProviderCapabilities {
  buttons: boolean
  list: boolean
  ctaUrl: boolean
  templates: boolean
  media: boolean
  /** Whether the 24h customer service window is enforced by the transport. */
  customerServiceWindow: boolean
}

export interface ChannelProvider {
  readonly name: string
  capabilities(): ProviderCapabilities
  send(creds: ChannelCredentials, to: string, message: OutboundMessage): Promise<SendResult>
  markRead(creds: ChannelCredentials, waMessageId: string): Promise<void>
  /** Resolves a Meta media id into a short-lived download URL. */
  getMediaUrl(creds: ChannelCredentials, mediaId: string): Promise<{ url: string; mimeType: string; sha256: string }>
  /**
   * Downloads media behind a URL from getMediaUrl. Those URLs demand the
   * channel's token, so a browser cannot load them directly.
   */
  downloadMedia(creds: ChannelCredentials, url: string): Promise<Response>
  /**
   * Uploads a file to Meta and returns its media id. The id only works for
   * sends from this same phone number.
   */
  uploadMedia(creds: ChannelCredentials, file: { data: Uint8Array; mimeType: string; filename: string }): Promise<{ mediaId: string }>
  listTemplates(creds: ChannelCredentials): Promise<RemoteTemplate[]>
  /** Every phone number registered under the WABA. */
  listPhoneNumbers(creds: ChannelCredentials): Promise<
    {
      phoneNumberId: string
      displayPhone: string
      verifiedName: string | null
      qualityRating: string
      messagingTier: string
    }[]
  >
  /** Subscribes this Meta App to the WABA's webhooks. Idempotent. */
  subscribeApp(creds: ChannelCredentials): Promise<void>
  getPhoneNumberHealth(creds: ChannelCredentials): Promise<{
    displayPhone: string
    qualityRating: string
    messagingTier: string
    verifiedName?: string
  }>
}

export interface RemoteTemplate {
  metaTemplateId: string
  name: string
  language: string
  category: string
  status: string
  components: unknown[]
  rejectionReason?: string
}

// ---------- WhatsApp Flows (native in-chat forms) ----------

/** Meta's fixed list; a value outside it is rejected at create time. */
export const FLOW_CATEGORIES = [
  'SIGN_UP',
  'SIGN_IN',
  'APPOINTMENT_BOOKING',
  'LEAD_GENERATION',
  'SHOPPING',
  'CONTACT_US',
  'CUSTOMER_SUPPORT',
  'SURVEY',
  'OTHER',
] as const

export type FlowCategory = (typeof FLOW_CATEGORIES)[number]

/**
 * DRAFT can be edited and deleted; PUBLISHED can be neither, only deprecated.
 * BLOCKED and THROTTLED only happen to flows with a data endpoint.
 */
export type RemoteFlowStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED' | 'BLOCKED' | 'THROTTLED'

/**
 * Meta accepts a Flow JSON with problems and reports them here rather than
 * failing the upload, so a create that "succeeded" can still be unsendable.
 */
export interface FlowValidationError {
  error: string
  errorType?: string
  message: string
  lineStart?: number
  lineEnd?: number
  columnStart?: number
  columnEnd?: number
}

export interface RemoteFlow {
  metaFlowId: string
  name: string
  status: RemoteFlowStatus
  categories: string[]
  validationErrors: FlowValidationError[]
}

export class ProviderError extends Error {
  readonly code?: string
  readonly httpStatus?: number
  readonly retryable: boolean
  readonly details?: unknown

  constructor(message: string, code?: string, httpStatus?: number, retryable = false, details?: unknown) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.httpStatus = httpStatus
    this.retryable = retryable
    this.details = details
  }
}
