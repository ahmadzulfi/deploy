import { z } from 'zod'
import { renderTemplate } from './templates.js'

/**
 * A message template being written in the dashboard, before Meta has seen it.
 *
 * Pure and browser-safe on purpose: the wizard validates and previews with
 * the same functions the server action runs before submitting, so what the
 * author sees is exactly what goes to review.
 */

export const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

/** Languages offered in the wizard. Meta supports more; these cover this deployment. */
export const TEMPLATE_LANGUAGES: { code: string; label: string }[] = [
  { code: 'id', label: 'Indonesia' },
  { code: 'en_US', label: 'Inggris (AS)' },
  { code: 'en_GB', label: 'Inggris (UK)' },
  { code: 'en', label: 'Inggris' },
  { code: 'ms', label: 'Melayu' },
  { code: 'ar', label: 'Arab' },
  { code: 'zh_CN', label: 'Tionghoa (Sederhana)' },
  { code: 'ja', label: 'Jepang' },
  { code: 'ko', label: 'Korea' },
  { code: 'th', label: 'Thai' },
  { code: 'vi', label: 'Vietnam' },
  { code: 'es', label: 'Spanyol' },
  { code: 'pt_BR', label: 'Portugis (Brasil)' },
  { code: 'fr', label: 'Prancis' },
  { code: 'de', label: 'Jerman' },
]

export const HEADER_FORMATS = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as const
export type HeaderFormat = (typeof HEADER_FORMATS)[number]

const buttonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QUICK_REPLY'), text: z.string() }),
  z.object({ type: z.literal('URL'), text: z.string(), url: z.string(), example: z.string().default('') }),
  z.object({ type: z.literal('PHONE_NUMBER'), text: z.string(), phone: z.string() }),
  z.object({ type: z.literal('COPY_CODE'), example: z.string() }),
])

export type DraftButton = z.infer<typeof buttonSchema>

export const templateDraftSchema = z.object({
  category: z.enum(TEMPLATE_CATEGORIES),
  /** `custom` for marketing/utility, `otp` for authentication. */
  kind: z.enum(['custom', 'otp']),
  name: z.string().default(''),
  language: z.string().default('id'),
  header: z
    .object({
      format: z.enum(HEADER_FORMATS).default('NONE'),
      text: z.string().default(''),
      /** Sample for the header's one variable. */
      example: z.string().default(''),
      /** Resumable Upload handle of the sample file, for media headers. */
      handle: z.string().default(''),
      fileName: z.string().default(''),
    })
    .default({}),
  body: z.object({ text: z.string().default(''), examples: z.array(z.string()).default([]) }).default({}),
  footer: z.string().default(''),
  buttons: z.array(buttonSchema).default([]),
  auth: z
    .object({
      securityRecommendation: z.boolean().default(true),
      /** Null = no expiry line under the code. */
      expiryMinutes: z.number().int().nullable().default(10),
      copyText: z.string().default('Salin kode'),
    })
    .default({}),
})

export type TemplateDraft = z.infer<typeof templateDraftSchema>

export function emptyDraft(category: TemplateCategory): TemplateDraft {
  return templateDraftSchema.parse({ category, kind: category === 'AUTHENTICATION' ? 'otp' : 'custom' })
}

export const TEMPLATE_LIMITS = {
  name: 512,
  headerText: 60,
  body: 1024,
  footer: 60,
  buttonText: 25,
  buttons: 10,
  urlButtons: 2,
  phoneButtons: 1,
  couponCode: 15,
} as const

/** Meta only accepts lowercase letters, digits and underscores. */
export function normalizeTemplateName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, TEMPLATE_LIMITS.name)
}

const PLACEHOLDER = /\{\{\s*([\w]+)\s*\}\}/g

/** Variable names in order of first appearance. */
export function variablesIn(text: string): string[] {
  const seen: string[] = []
  for (const m of text.matchAll(PLACEHOLDER)) if (!seen.includes(m[1]!)) seen.push(m[1]!)
  return seen
}

/** The number "+ Tambah variabel" should insert next. */
export function nextVariable(text: string): number {
  const nums = variablesIn(text)
    .filter((n) => /^\d+$/.test(n))
    .map(Number)
  return nums.length ? Math.max(...nums) + 1 : 1
}

/** How many samples the body needs: the highest `{{n}}` used. */
export function bodyVariableCount(text: string): number {
  return nextVariable(text) - 1
}

function checkVariables(text: string, where: string, max?: number): string | undefined {
  const vars = variablesIn(text)
  if (vars.some((v) => !/^\d+$/.test(v))) return `${where}: pakai variabel angka seperti {{1}}, {{2}}.`
  const nums = vars.map(Number).sort((a, b) => a - b)
  if (nums.some((n, i) => n !== i + 1)) return `${where}: variabel harus berurutan mulai dari {{1}}.`
  if (max !== undefined && nums.length > max) return `${where}: maksimal ${max} variabel.`
  return undefined
}

const HTTP_URL = /^https?:\/\/[^\s/$.?#].[^\s]*$/i

/**
 * Checks a draft against Meta's template rules.
 *
 * @returns field -> message; empty when the draft can be submitted
 */
export function validateTemplateDraft(d: TemplateDraft): Record<string, string> {
  const e: Record<string, string> = {}

  if (!d.name) e.name = 'Nama template wajib diisi.'
  else if (!/^[a-z0-9_]+$/.test(d.name)) e.name = 'Hanya huruf kecil, angka, dan garis bawah.'
  else if (d.name.length > TEMPLATE_LIMITS.name) e.name = `Maksimal ${TEMPLATE_LIMITS.name} karakter.`
  if (!TEMPLATE_LANGUAGES.some((l) => l.code === d.language)) e.language = 'Pilih bahasa.'

  if (d.category === 'AUTHENTICATION') {
    const exp = d.auth.expiryMinutes
    if (exp !== null && (exp < 1 || exp > 90)) e.auth = 'Masa berlaku kode 1–90 menit.'
    if (!d.auth.copyText.trim()) e.copyText = 'Teks tombol wajib diisi.'
    else if (d.auth.copyText.length > TEMPLATE_LIMITS.buttonText) e.copyText = `Maksimal ${TEMPLATE_LIMITS.buttonText} karakter.`
    return e
  }

  // Header
  const h = d.header
  if (h.format === 'TEXT') {
    if (!h.text.trim()) e.header = 'Teks header wajib diisi, atau pilih "Tidak ada".'
    else if (h.text.length > TEMPLATE_LIMITS.headerText) e.header = `Header maksimal ${TEMPLATE_LIMITS.headerText} karakter.`
    else if (/[\r\n]/.test(h.text)) e.header = 'Header tidak boleh berisi baris baru.'
    else {
      const bad = checkVariables(h.text, 'Header', 1)
      if (bad) e.header = bad
      else if (variablesIn(h.text).length && !h.example.trim()) e.headerExample = 'Isi contoh untuk variabel header.'
    }
  } else if (h.format !== 'NONE' && !h.handle) {
    e.header = 'Unggah contoh file untuk header.'
  }

  // Body
  const body = d.body.text
  if (!body.trim()) e.body = 'Isi pesan wajib diisi.'
  else if (body.length > TEMPLATE_LIMITS.body) e.body = `Isi pesan maksimal ${TEMPLATE_LIMITS.body} karakter.`
  else {
    const bad = checkVariables(body, 'Isi pesan')
    if (bad) e.body = bad
    else if (/^\s*\{\{/.test(body) || /\}\}\s*$/.test(body)) {
      e.body = 'Variabel tidak boleh di awal atau akhir isi pesan.'
    } else {
      const n = bodyVariableCount(body)
      if (Array.from({ length: n }, (_, i) => d.body.examples[i] ?? '').some((x) => !x.trim())) {
        e.bodyExamples = 'Isi contoh untuk setiap variabel.'
      }
    }
  }

  // Footer
  if (d.footer.length > TEMPLATE_LIMITS.footer) e.footer = `Footer maksimal ${TEMPLATE_LIMITS.footer} karakter.`
  else if (variablesIn(d.footer).length) e.footer = 'Footer tidak boleh berisi variabel.'

  // Buttons
  const count = (t: DraftButton['type']) => d.buttons.filter((b) => b.type === t).length
  if (d.buttons.length > TEMPLATE_LIMITS.buttons) e.buttons = `Maksimal ${TEMPLATE_LIMITS.buttons} tombol.`
  else if (count('URL') > TEMPLATE_LIMITS.urlButtons) e.buttons = `Maksimal ${TEMPLATE_LIMITS.urlButtons} tombol situs.`
  else if (count('PHONE_NUMBER') > TEMPLATE_LIMITS.phoneButtons) e.buttons = 'Maksimal 1 tombol telepon.'
  else if (count('COPY_CODE') > 1) e.buttons = 'Maksimal 1 tombol salin kode.'
  else if (count('COPY_CODE') && d.category !== 'MARKETING') e.buttons = 'Tombol salin kode hanya untuk Marketing.'

  d.buttons.forEach((b, i) => {
    const key = `button.${i}`
    if (b.type === 'COPY_CODE') {
      if (!b.example.trim()) e[key] = 'Isi contoh kode penawaran.'
      else if (b.example.length > TEMPLATE_LIMITS.couponCode) e[key] = `Kode maksimal ${TEMPLATE_LIMITS.couponCode} karakter.`
      else if (!/^[A-Za-z0-9]+$/.test(b.example)) e[key] = 'Kode hanya huruf dan angka.'
      return
    }
    if (!b.text.trim()) return void (e[key] = 'Teks tombol wajib diisi.')
    if (b.text.length > TEMPLATE_LIMITS.buttonText) return void (e[key] = `Teks tombol maksimal ${TEMPLATE_LIMITS.buttonText} karakter.`)
    if (b.type === 'URL') {
      const vars = variablesIn(b.url)
      if (!HTTP_URL.test(b.url.replace(PLACEHOLDER, 'x'))) e[key] = 'Isi URL lengkap yang diawali https://'
      else if (vars.length > 1 || (vars.length === 1 && vars[0] !== '1')) e[key] = 'URL hanya boleh punya satu variabel {{1}}.'
      else if (vars.length === 1 && !/\{\{\s*1\s*\}\}$/.test(b.url)) e[key] = 'Variabel {{1}} harus di akhir URL.'
      else if (vars.length === 1 && !HTTP_URL.test(b.example)) e[key] = 'Isi contoh URL lengkap untuk variabel.'
    }
    if (b.type === 'PHONE_NUMBER' && !/^\+?\d{8,15}$/.test(b.phone.replace(/[\s-]/g, ''))) {
      e[key] = 'Nomor telepon dengan kode negara, mis. +628123456789.'
    }
  })

  return e
}

/**
 * Quick replies first. Meta rejects a template whose quick-reply buttons are
 * interleaved with call-to-action ones, so the order is fixed here rather
 * than left to however the author happened to add them.
 */
export function orderedButtons(buttons: DraftButton[]): DraftButton[] {
  return [...buttons.filter((b) => b.type === 'QUICK_REPLY'), ...buttons.filter((b) => b.type !== 'QUICK_REPLY')]
}

/** The `components` array of a `POST /{waba}/message_templates`. */
export function draftToComponents(d: TemplateDraft): unknown[] {
  if (d.category === 'AUTHENTICATION') {
    return [
      { type: 'BODY', add_security_recommendation: d.auth.securityRecommendation },
      ...(d.auth.expiryMinutes ? [{ type: 'FOOTER', code_expiration_minutes: d.auth.expiryMinutes }] : []),
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: d.auth.copyText.trim() }] },
    ]
  }

  const out: unknown[] = []
  const h = d.header
  if (h.format === 'TEXT') {
    out.push({
      type: 'HEADER',
      format: 'TEXT',
      text: h.text,
      ...(variablesIn(h.text).length ? { example: { header_text: [h.example] } } : {}),
    })
  } else if (h.format !== 'NONE') {
    out.push({ type: 'HEADER', format: h.format, example: { header_handle: [h.handle] } })
  }

  const n = bodyVariableCount(d.body.text)
  out.push({
    type: 'BODY',
    text: d.body.text,
    ...(n ? { example: { body_text: [d.body.examples.slice(0, n)] } } : {}),
  })

  if (d.footer.trim()) out.push({ type: 'FOOTER', text: d.footer.trim() })

  if (d.buttons.length) {
    out.push({
      type: 'BUTTONS',
      buttons: orderedButtons(d.buttons).map((b) => {
        switch (b.type) {
          case 'QUICK_REPLY':
            return { type: 'QUICK_REPLY', text: b.text.trim() }
          case 'URL':
            return {
              type: 'URL',
              text: b.text.trim(),
              url: b.url.trim(),
              ...(variablesIn(b.url).length ? { example: [b.example.trim()] } : {}),
            }
          case 'PHONE_NUMBER':
            return { type: 'PHONE_NUMBER', text: b.text.trim(), phone_number: b.phone.replace(/[\s-]/g, '') }
          case 'COPY_CODE':
            return { type: 'COPY_CODE', example: b.example.trim() }
        }
      }),
    })
  }
  return out
}

// ---------- Preview ----------

export type PreviewButtonKind = 'reply' | 'url' | 'phone' | 'copy' | 'flow' | 'other'

export interface WaPreview {
  header?: string
  headerMedia?: 'image' | 'video' | 'document'
  body: string
  footer?: string
  buttons: { kind: PreviewButtonKind; text: string }[]
}

const BUTTON_KIND: Record<string, PreviewButtonKind> = {
  QUICK_REPLY: 'reply',
  URL: 'url',
  PHONE_NUMBER: 'phone',
  COPY_CODE: 'copy',
  OTP: 'copy',
  FLOW: 'flow',
}

/** What the contact will see, for a template in Meta's component format. */
export function previewComponents(raw: unknown, values: Record<string, string> = {}): WaPreview {
  const base = renderTemplate(raw, values)
  const comps = Array.isArray(raw) ? (raw as { type?: string; buttons?: { type?: string; text?: string }[] }[]) : []
  const buttons = comps.find((c) => c.type?.toUpperCase() === 'BUTTONS')?.buttons ?? []
  return {
    ...base,
    buttons: buttons.map((b) => {
      const type = b.type?.toUpperCase() ?? ''
      // Meta labels the coupon button itself; the definition has no text for it.
      return { kind: BUTTON_KIND[type] ?? 'other', text: b.text || (type === 'COPY_CODE' ? 'Salin kode penawaran' : '') }
    }),
  }
}

/** The wizard's live preview: blanks show their samples where filled in. */
export function previewDraft(d: TemplateDraft): WaPreview {
  if (d.category === 'AUTHENTICATION') {
    return {
      body:
        '*123456* adalah kode verifikasi Anda.' +
        (d.auth.securityRecommendation ? ' Demi keamanan, jangan bagikan kode ini.' : ''),
      footer: d.auth.expiryMinutes ? `Kode ini kedaluwarsa dalam ${d.auth.expiryMinutes} menit.` : undefined,
      buttons: [{ kind: 'copy', text: d.auth.copyText || 'Salin kode' }],
    }
  }
  const values: Record<string, string> = {}
  if (d.header.example) values['header.1'] = d.header.example
  d.body.examples.forEach((x, i) => {
    if (x) values[`body.${i + 1}`] = x
  })
  return previewComponents(draftToComponents(d), values)
}

/** The "Tipe" column: how the template was built, from its components. */
export function templateKind(category: string, raw: unknown): 'OTP' | 'FLOWS' | 'KATALOG' | 'KUSTOM' {
  if (category.toUpperCase() === 'AUTHENTICATION') return 'OTP'
  const comps = Array.isArray(raw) ? (raw as { type?: string; buttons?: { type?: string }[] }[]) : []
  const types = comps.flatMap((c) => (c.buttons ?? []).map((b) => b.type?.toUpperCase()))
  if (types.includes('FLOW')) return 'FLOWS'
  if (types.includes('CATALOG') || types.includes('MPM')) return 'KATALOG'
  return 'KUSTOM'
}
