import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { validateButtons, validateList, WA_LIMITS, WhatsAppValidationError, type OutboundMessage } from '@wa/core'

/**
 * The body of POST /messages: which fields are accepted for each kind of
 * message, and how each becomes the provider's OutboundMessage.
 *
 * No database in here, so every rule can be tested on its own. WhatsApp's
 * limits come from WA_LIMITS and the same validators the flow builder uses -
 * the API cannot accept something the editor would refuse, or the reverse.
 */

/**
 * Accepts +62 812-3456-7890 style input and returns Meta's form: digits
 * only, country code first. A leading 0 is refused rather than guessed at -
 * the platform has no way to know which country a local number belongs to.
 */
export const waIdSchema = z
  .string()
  .transform((s) => s.replace(/[\s\-().+]/g, ''))
  .refine((s) => /^\d{8,15}$/.test(s), 'nomor harus 8-15 digit dengan kode negara, mis. 6281234567890')
  .refine((s) => !s.startsWith('0'), 'pakai kode negara (62…), bukan 0 di depan')

// Meta fetches linked files and pages on its side and refuses plain http.
const httpsUrl = z.string().trim().url().refine((u) => u.startsWith('https://'), 'harus https dan bisa diakses publik oleh Meta')

/**
 * Where Meta gets the file: a link it downloads itself, or the id of a file
 * already uploaded to Meta. Exactly one - Meta refuses a message with both.
 */
const mediaSource = {
  link: httpsUrl.optional(),
  /** Tied to the phone number that uploaded it; fails on any other channel. */
  mediaId: z.string().trim().min(1).optional(),
}
const oneSource = (m: { link?: string; mediaId?: string }) => !!m.link !== !!m.mediaId
const ONE_SOURCE = 'isi salah satu: link atau mediaId'
const caption = z.string().trim().min(1).max(WA_LIMITS.interactive.bodyMax).optional()

const headerText = z.string().trim().min(1).max(WA_LIMITS.interactive.headerTextMax).optional()
const interactiveBody = z.string().trim().min(1).max(WA_LIMITS.interactive.bodyMax)
const footer = z.string().trim().min(1).max(WA_LIMITS.interactive.footerMax).optional()

/**
 * Runs one of the shared WhatsApp validators inside a zod schema, so its
 * complaint comes back as an ordinary 400 with the field that caused it.
 */
function whatsappRule<T>(check: (v: T) => void) {
  return (v: T, ctx: z.RefinementCtx) => {
    try {
      check(v)
    } catch (err) {
      if (!(err instanceof WhatsAppValidationError)) throw err
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: err.message, path: err.field ? [err.field.split(' ')[0]!] : [] })
    }
  }
}

// strict(): WhatsApp silently drops fields a message type does not support -
// a caption on audio, say - so they are refused here rather than accepted and lost.
const imageSchema = z.object({ ...mediaSource, caption }).strict().refine(oneSource, ONE_SOURCE)
const videoSchema = z.object({ ...mediaSource, caption }).strict().refine(oneSource, ONE_SOURCE)
const audioSchema = z.object({ ...mediaSource }).strict().refine(oneSource, ONE_SOURCE)
const stickerSchema = z.object({ ...mediaSource }).strict().refine(oneSource, ONE_SOURCE)
const documentSchema = z
  .object({ ...mediaSource, caption, filename: z.string().trim().min(1).optional() })
  .strict()
  .refine(oneSource, ONE_SOURCE)

const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    name: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).optional(),
  })
  .strict()

const buttonsSchema = z
  .object({
    header: headerText,
    /** An image above the body instead of a text header. */
    headerImage: httpsUrl.optional(),
    body: interactiveBody,
    footer,
    buttons: z.array(z.object({ id: z.string().trim().min(1), title: z.string().trim().min(1) }).strict()),
  })
  .strict()
  .refine((b) => !(b.header && b.headerImage), { message: 'isi salah satu: header atau headerImage', path: ['header'] })
  .superRefine(whatsappRule((b) => validateButtons(b.body, b.buttons)))

const listSchema = z
  .object({
    header: headerText,
    body: interactiveBody,
    footer,
    buttonText: z.string().trim().min(1),
    sections: z
      .array(
        z
          .object({
            title: z.string().trim().min(1),
            rows: z
              .array(
                z
                  .object({ id: z.string().trim().min(1), title: z.string().trim().min(1), description: z.string().trim().min(1).optional() })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine(whatsappRule((l) => validateList(l.body, l.buttonText, l.sections)))

const ctaUrlSchema = z
  .object({
    header: headerText,
    body: interactiveBody,
    footer,
    /** Label on the button. */
    displayText: z.string().trim().min(1),
    url: httpsUrl,
  })
  .strict()

const flowSchema = z
  .object({
    header: headerText,
    body: interactiveBody,
    footer,
    /** Label on the button that opens the form. */
    cta: z.string().trim().min(1),
    /** The form's id on Meta. */
    flowId: z.string().trim().min(1),
    /** Screen the form opens on, as named in its Flow JSON. */
    screen: z.string().trim().min(1),
    /**
     * Comes back with the submitted answers (in message.received) so they can
     * be matched to this send. Generated when omitted.
     */
    flowToken: z.string().trim().min(1).max(200).optional(),
    /** Prefilled into the first screen's `data`. */
    data: z.record(z.unknown()).optional(),
    /** `draft` only reaches people with access to the WABA - for testing a form before publishing it. */
    mode: z.enum(['published', 'draft']).default('published'),
  })
  .strict()

const templateSchema = z
  .object({
    name: z.string().min(1),
    language: z.string().min(1).default('id'),
    /** Keyed like the dashboard's slots: body.1, body.nama, header.1, header.media, button.0.1. */
    params: z.record(z.string()).default({}),
  })
  .strict()

/** One of these, exactly, per request. */
export const MESSAGE_FIELDS = [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'location',
  'buttons',
  'list',
  'ctaUrl',
  'flow',
  'template',
] as const

export const sendSchema = z
  .object({
    channelId: z.string().optional(),
    to: waIdSchema,
    /** Only used when the contact does not exist yet or has no name. */
    name: z.string().trim().min(1).max(200).optional(),
    text: z.string().trim().min(1).max(WA_LIMITS.text.bodyMax).optional(),
    image: imageSchema.optional(),
    video: videoSchema.optional(),
    audio: audioSchema.optional(),
    document: documentSchema.optional(),
    sticker: stickerSchema.optional(),
    location: locationSchema.optional(),
    buttons: buttonsSchema.optional(),
    list: listSchema.optional(),
    ctaUrl: ctaUrlSchema.optional(),
    flow: flowSchema.optional(),
    template: templateSchema.optional(),
  })
  .refine(
    (b) => MESSAGE_FIELDS.filter((k) => b[k] !== undefined).length === 1,
    `isi tepat satu dari: ${MESSAGE_FIELDS.join(', ')}`,
  )

export type SendInput = z.output<typeof sendSchema>

const source = (m: { link?: string; mediaId?: string }) => (m.mediaId ? { mediaId: m.mediaId } : { link: m.link })

/**
 * The provider message for everything except templates, which need the
 * database to look up the template's definition. Same shapes the flow engine
 * produces, so the send worker treats an API message like any other.
 */
export function freeFormMessage(b: SendInput): OutboundMessage {
  if (b.image) return { kind: 'image', ...source(b.image), caption: b.image.caption }
  if (b.video) return { kind: 'video', ...source(b.video), caption: b.video.caption }
  if (b.audio) return { kind: 'audio', ...source(b.audio) }
  if (b.sticker) return { kind: 'sticker', ...source(b.sticker) }
  if (b.document) {
    return { kind: 'document', ...source(b.document), caption: b.document.caption, filename: b.document.filename }
  }
  if (b.location) return { kind: 'location', ...b.location }
  if (b.buttons) {
    const { header, headerImage, ...rest } = b.buttons
    return {
      kind: 'buttons',
      ...rest,
      ...(headerImage ? { header: { type: 'image', link: headerImage } } : header ? { header: { type: 'text', text: header } } : {}),
    }
  }
  if (b.list) return { kind: 'list', ...b.list }
  if (b.ctaUrl) return { kind: 'cta_url', ...b.ctaUrl }
  if (b.flow) {
    const { flowId, data, flowToken, ...rest } = b.flow
    return {
      kind: 'flow',
      ...rest,
      metaFlowId: flowId,
      flowToken: flowToken ?? `api_${randomBytes(12).toString('base64url')}`,
      ...(data ? { prefill: data } : {}),
    }
  }
  if (b.text !== undefined) return { kind: 'text', body: b.text }
  throw new Error('freeFormMessage: template sends are built by the caller')
}
