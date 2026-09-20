/**
 * WhatsApp's own constraints, in one place.
 *
 * The flow builder reads these to disable the 4th button and turn the body
 * counter red, and the provider reads them to reject a payload before it burns
 * an API call. Two enforcement points, one source of truth - so a limit change
 * never leaves the editor and the sender disagreeing about what is valid.
 *
 * Verify against Meta's docs when bumping META_GRAPH_VERSION; these move.
 */
export const WA_LIMITS = {
  text: {
    bodyMax: 4096,
  },
  interactive: {
    headerTextMax: 60,
    bodyMax: 1024,
    footerMax: 60,
  },
  buttons: {
    /** Reply buttons per interactive message. */
    max: 3,
    titleMax: 20,
    idMax: 256,
  },
  list: {
    /** Rows summed across every section, not per section. */
    totalRowsMax: 10,
    sectionsMax: 10,
    sectionTitleMax: 24,
    rowTitleMax: 24,
    rowDescriptionMax: 72,
    buttonTextMax: 20,
  },
  /** Free-form sends are only allowed inside this window after the last inbound. */
  customerServiceWindowHours: 24,
} as const

export class WhatsAppValidationError extends Error {
  readonly field?: string

  constructor(message: string, field?: string) {
    super(message)
    this.name = 'WhatsAppValidationError'
    this.field = field
  }
}

function assertMax(value: string, max: number, field: string) {
  if (value.length > max) {
    throw new WhatsAppValidationError(`${field} is ${value.length} chars, max ${max}`, field)
  }
}

export function validateButtons(body: string, buttons: { id: string; title: string }[]) {
  assertMax(body, WA_LIMITS.interactive.bodyMax, 'body')
  if (buttons.length === 0) throw new WhatsAppValidationError('at least one button is required', 'buttons')
  if (buttons.length > WA_LIMITS.buttons.max) {
    throw new WhatsAppValidationError(
      `${buttons.length} buttons, WhatsApp allows ${WA_LIMITS.buttons.max}`,
      'buttons',
    )
  }
  const seen = new Set<string>()
  for (const b of buttons) {
    assertMax(b.title, WA_LIMITS.buttons.titleMax, `button.title "${b.title}"`)
    assertMax(b.id, WA_LIMITS.buttons.idMax, 'button.id')
    if (seen.has(b.id)) throw new WhatsAppValidationError(`duplicate button id "${b.id}"`, 'buttons')
    seen.add(b.id)
  }
}

export function validateList(
  body: string,
  buttonText: string,
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[],
) {
  assertMax(body, WA_LIMITS.interactive.bodyMax, 'body')
  assertMax(buttonText, WA_LIMITS.list.buttonTextMax, 'buttonText')

  if (sections.length > WA_LIMITS.list.sectionsMax) {
    throw new WhatsAppValidationError(`${sections.length} sections, max ${WA_LIMITS.list.sectionsMax}`, 'sections')
  }

  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0)
  if (totalRows === 0) throw new WhatsAppValidationError('at least one row is required', 'sections')
  if (totalRows > WA_LIMITS.list.totalRowsMax) {
    throw new WhatsAppValidationError(
      `${totalRows} rows across all sections, max ${WA_LIMITS.list.totalRowsMax}`,
      'sections',
    )
  }

  const seen = new Set<string>()
  for (const s of sections) {
    assertMax(s.title, WA_LIMITS.list.sectionTitleMax, `section.title "${s.title}"`)
    for (const r of s.rows) {
      assertMax(r.title, WA_LIMITS.list.rowTitleMax, `row.title "${r.title}"`)
      if (r.description) assertMax(r.description, WA_LIMITS.list.rowDescriptionMax, `row.description`)
      if (seen.has(r.id)) throw new WhatsAppValidationError(`duplicate row id "${r.id}"`, 'sections')
      seen.add(r.id)
    }
  }
}

/** True when a free-form (non-template) message is still allowed. */
export function isWindowOpen(windowExpiresAt: Date | null | undefined, now = new Date()): boolean {
  return !!windowExpiresAt && windowExpiresAt.getTime() > now.getTime()
}

export function windowExpiryFrom(lastInboundAt: Date): Date {
  return new Date(lastInboundAt.getTime() + WA_LIMITS.customerServiceWindowHours * 3_600_000)
}
