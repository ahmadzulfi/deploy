/**
 * Variable resolution for flow runs.
 *
 * Templates are written `{{name}}` and resolve against three scopes, checked
 * in order: session variables the flow itself set, contact fields, then a few
 * system values. Session wins so a flow can deliberately shadow a contact
 * field without editing the contact.
 */

export interface FlowContext {
  variables: Record<string, unknown>
  contact: {
    name?: string | null
    waId: string
    attributes?: Record<string, unknown>
    tags?: string[]
  }
  channel: { name: string; displayPhone?: string | null }
  now?: Date
}

const TEMPLATE = /\{\{\s*([\w.]+)\s*\}\}/g

/** Replaces every `{{name}}` in `input`. Unknown names resolve to "". */
export function interpolate(input: string, ctx: FlowContext): string {
  return input.replace(TEMPLATE, (_, path: string) => {
    const value = resolve(path, ctx)
    return value === undefined || value === null ? '' : String(value)
  })
}

export function resolve(path: string, ctx: FlowContext): unknown {
  if (path in ctx.variables) return ctx.variables[path]

  const [head, ...rest] = path.split('.')
  const tail = rest.join('.')

  switch (head) {
    case 'contact':
      if (tail === 'name') return ctx.contact.name ?? ''
      if (tail === 'phone' || tail === 'waId') return ctx.contact.waId
      if (tail === 'tags') return (ctx.contact.tags ?? []).join(', ')
      return ctx.contact.attributes?.[tail]

    case 'channel':
      if (tail === 'name') return ctx.channel.name
      if (tail === 'phone') return ctx.channel.displayPhone ?? ''
      return undefined

    case 'system': {
      const now = ctx.now ?? new Date()
      if (tail === 'now') return now.toISOString()
      if (tail === 'date') return now.toLocaleDateString('id-ID')
      if (tail === 'time') return now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      return undefined
    }

    default:
      return ctx.variables[path]
  }
}

/** Validation for the waitReply node's `expect` setting. */
export function validateAnswer(
  expect: 'any' | 'text' | 'number' | 'email' | 'phone' | 'media' | 'location',
  answer: { type: string; text?: string },
): boolean {
  const text = (answer.text ?? '').trim()

  switch (expect) {
    case 'any':
      return true
    case 'text':
      return answer.type === 'text' && text.length > 0
    case 'number':
      return text.length > 0 && Number.isFinite(Number(text.replace(',', '.')))
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)
    case 'phone':
      // Indonesian numbers arrive in several shapes; accept digits with the
      // usual separators and require a plausible length.
      return /^[\d+\-\s()]{8,20}$/.test(text) && text.replace(/\D/g, '').length >= 8
    case 'media':
      return ['image', 'video', 'audio', 'document', 'sticker'].includes(answer.type)
    case 'location':
      return answer.type === 'location'
  }
}

export function compare(
  left: unknown,
  operator: 'eq' | 'neq' | 'contains' | 'startsWith' | 'gt' | 'lt' | 'isSet' | 'isEmpty',
  right: string,
  caseSensitive = false,
): boolean {
  if (operator === 'isSet') return left !== undefined && left !== null && String(left) !== ''
  if (operator === 'isEmpty') return left === undefined || left === null || String(left) === ''

  const a = caseSensitive ? String(left ?? '') : String(left ?? '').toLowerCase()
  const b = caseSensitive ? right : right.toLowerCase()

  switch (operator) {
    case 'eq':
      return a === b
    case 'neq':
      return a !== b
    case 'contains':
      return a.includes(b)
    case 'startsWith':
      return a.startsWith(b)
    case 'gt':
    case 'lt': {
      // Numeric when both sides parse as numbers, lexicographic otherwise -
      // "10" > "9" should hold for a quantity but not for a product code.
      const na = Number(a)
      const nb = Number(b)
      const numeric = a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)
      if (numeric) return operator === 'gt' ? na > nb : na < nb
      return operator === 'gt' ? a > b : a < b
    }
  }
}
