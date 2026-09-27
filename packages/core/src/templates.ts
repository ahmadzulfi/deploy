/**
 * Reading Meta's template definitions and turning filled-in values back into
 * the `components` array a template send needs.
 *
 * Pure on purpose: the inbox composer and the flow inspector run this in the
 * browser to show which blanks a template has, and the send path runs the same
 * code, so what the agent previews is exactly what goes out.
 */

/** A blank the sender has to fill before the template can go out. */
export interface TemplateSlot {
  /** Stable key into the values map: `header.1`, `body.nama`, `button.0.1`. */
  key: string
  component: 'header' | 'body' | 'button'
  /** `1`, `2`… for positional templates, the parameter name for named ones. */
  name: string
  /** Media headers take a URL instead of text; coupon buttons take a code. */
  format: 'text' | 'image' | 'video' | 'document' | 'coupon'
  /** Button position, which Meta addresses by index rather than by name. */
  buttonIndex?: number
  /** Meta's sample value from template review - a useful placeholder hint. */
  example?: string
}

export interface TemplatePreview {
  header?: string
  /** Set instead of `header` for media headers. */
  headerMedia?: 'image' | 'video' | 'document'
  body: string
  footer?: string
  buttons: string[]
}

interface RawComponent {
  type?: string
  format?: string
  text?: string
  example?: {
    header_text?: string[]
    header_text_named_params?: { param_name: string; example: string }[]
    body_text?: string[][]
    body_text_named_params?: { param_name: string; example: string }[]
  }
  buttons?: RawButton[]
}

interface RawButton {
  type?: string
  text?: string
  url?: string
  example?: string[] | string
}

const PLACEHOLDER = /\{\{\s*([\w]+)\s*\}\}/g

/** Placeholder names in the order a sender should fill them. */
function placeholders(text: string | undefined): string[] {
  if (!text) return []
  const seen: string[] = []
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (!seen.includes(m[1]!)) seen.push(m[1]!)
  }
  // Positional parameters are sent in numeric order no matter where they
  // appear in the text - `{{2}} … {{1}}` still sends parameter 1 first.
  return seen.every((n) => /^\d+$/.test(n)) ? seen.sort((a, b) => Number(a) - Number(b)) : seen
}

const isNamed = (name: string) => !/^\d+$/.test(name)

function components(raw: unknown): RawComponent[] {
  return Array.isArray(raw) ? (raw as RawComponent[]) : []
}

function find(raw: unknown, type: string) {
  return components(raw).find((c) => c.type?.toUpperCase() === type)
}

export function templateSlots(raw: unknown): TemplateSlot[] {
  const out: TemplateSlot[] = []

  const header = find(raw, 'HEADER')
  const headerFormat = header?.format?.toUpperCase()
  if (headerFormat === 'TEXT') {
    const names = placeholders(header?.text)
    names.forEach((name, i) =>
      out.push({
        key: `header.${name}`,
        component: 'header',
        name,
        format: 'text',
        example: isNamed(name)
          ? header?.example?.header_text_named_params?.find((p) => p.param_name === name)?.example
          : header?.example?.header_text?.[i],
      }),
    )
  } else if (headerFormat === 'IMAGE' || headerFormat === 'VIDEO' || headerFormat === 'DOCUMENT') {
    out.push({
      key: 'header.media',
      component: 'header',
      name: 'media',
      format: headerFormat.toLowerCase() as 'image' | 'video' | 'document',
    })
  }

  const body = find(raw, 'BODY')
  placeholders(body?.text).forEach((name, i) =>
    out.push({
      key: `body.${name}`,
      component: 'body',
      name,
      format: 'text',
      example: isNamed(name)
        ? body?.example?.body_text_named_params?.find((p) => p.param_name === name)?.example
        : body?.example?.body_text?.[0]?.[i],
    }),
  )

  find(raw, 'BUTTONS')?.buttons?.forEach((b, index) => {
    const type = b.type?.toUpperCase()
    if (type === 'URL') {
      // Only the dynamic suffix of a URL button is a parameter, and Meta
      // allows exactly one.
      for (const name of placeholders(b.url)) {
        out.push({
          key: `button.${index}.${name}`,
          component: 'button',
          name,
          format: 'text',
          buttonIndex: index,
          example: Array.isArray(b.example) ? b.example[0] : b.example,
        })
      }
    } else if (type === 'COPY_CODE') {
      out.push({
        key: `button.${index}.code`,
        component: 'button',
        name: 'code',
        format: 'coupon',
        buttonIndex: index,
        example: Array.isArray(b.example) ? b.example[0] : b.example,
      })
    }
  })

  return out
}

/**
 * Builds the `components` of a template send. Returns undefined for a
 * template with no blanks, which Meta wants sent without the field at all.
 */
export function buildTemplateComponents(raw: unknown, values: Record<string, string>): unknown[] | undefined {
  const slots = templateSlots(raw)
  if (slots.length === 0) return undefined

  const val = (s: TemplateSlot) => values[s.key] ?? ''
  const textParam = (s: TemplateSlot) => ({
    type: 'text',
    text: val(s),
    ...(isNamed(s.name) ? { parameter_name: s.name } : {}),
  })

  const out: unknown[] = []

  const header = slots.filter((s) => s.component === 'header')
  if (header.length) {
    const media = header.find((s) => s.name === 'media')
    out.push({
      type: 'header',
      parameters: media
        ? [{ type: media.format, [media.format]: { link: val(media) } }]
        : header.map(textParam),
    })
  }

  const body = slots.filter((s) => s.component === 'body')
  if (body.length) out.push({ type: 'body', parameters: body.map(textParam) })

  for (const s of slots.filter((s) => s.component === 'button')) {
    out.push(
      s.format === 'coupon'
        ? {
            type: 'button',
            sub_type: 'copy_code',
            index: String(s.buttonIndex),
            parameters: [{ type: 'coupon_code', coupon_code: val(s) }],
          }
        : {
            type: 'button',
            sub_type: 'url',
            index: String(s.buttonIndex),
            parameters: [{ type: 'text', text: val(s) }],
          },
    )
  }

  return out
}

/** The template as the contact will read it, blanks filled where known. */
export function renderTemplate(raw: unknown, values: Record<string, string> = {}): TemplatePreview {
  const fill = (component: string, text: string | undefined) =>
    (text ?? '').replace(PLACEHOLDER, (whole, name: string) => values[`${component}.${name}`] || whole)

  const header = find(raw, 'HEADER')
  const format = header?.format?.toUpperCase()
  const buttons = find(raw, 'BUTTONS')?.buttons ?? []

  return {
    header: format === 'TEXT' ? fill('header', header?.text) : undefined,
    headerMedia:
      format === 'IMAGE' || format === 'VIDEO' || format === 'DOCUMENT'
        ? (format.toLowerCase() as 'image' | 'video' | 'document')
        : undefined,
    body: fill('body', find(raw, 'BODY')?.text),
    footer: find(raw, 'FOOTER')?.text,
    buttons: buttons.map((b) => b.text ?? '').filter(Boolean),
  }
}

/**
 * Maps a flow node's fields onto slot keys. The node stores body parameters
 * as an ordered list and one header value, because a flow author works from
 * the template's text, not from its internal keys.
 */
export function flowTemplateValues(
  raw: unknown,
  p: { bodyParams: string[]; headerParam?: string },
): Record<string, string> {
  const values: Record<string, string> = {}
  const slots = templateSlots(raw)
  slots
    .filter((s) => s.component === 'body')
    .forEach((s, i) => {
      values[s.key] = p.bodyParams[i] ?? ''
    })
  const header = slots.find((s) => s.component === 'header')
  if (header && p.headerParam) values[header.key] = p.headerParam
  return values
}
