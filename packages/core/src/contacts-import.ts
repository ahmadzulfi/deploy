/**
 * Turning a spreadsheet export into contact rows.
 *
 * Pure so the parsing rules can be tested without a database, and so the
 * dashboard's "add contact" form normalises a number exactly the way an
 * import does.
 */

/**
 * A phone number as people type it, in the E.164-without-plus form Meta uses
 * as `wa_id`. Local Indonesian numbers (`0812…`) get the 62 country code.
 *
 * @returns null when what is left cannot be a phone number
 */
export function normalizeWaId(raw: string): string | null {
  let digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
  // "812…" typed without any prefix is still an Indonesian mobile number.
  // Capped at 12 digits so a Chinese number with its 86 code is left alone.
  else if (digits.startsWith('8') && digits.length >= 9 && digits.length <= 12) digits = `62${digits}`
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}

/**
 * Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF, a UTF-8 BOM.
 * The delimiter is guessed from the header line, because Excel in an
 * Indonesian locale saves CSV with semicolons.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.slice(0, src.search(/\r?\n|$/))
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  // Blank lines, including the one a trailing newline leaves behind.
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export interface ImportedContact {
  waId: string
  name?: string
  tags: string[]
  attributes: Record<string, string>
}

export interface ImportResult {
  rows: ImportedContact[]
  /** `line` is the spreadsheet row number, header being line 1. */
  errors: { line: number; reason: string }[]
}

export const IMPORT_MAX_ROWS = 5000

const PHONE = new Set(['phone', 'nomor', 'no_hp', 'nohp', 'hp', 'wa', 'whatsapp', 'no_wa', 'telepon', 'phone_number'])
const NAME = new Set(['name', 'nama'])
const TAGS = new Set(['tags', 'tag', 'grup', 'group', 'groups'])
const ATTRIBUTE_KEY = /^[A-Za-z_][\w]{0,49}$/

const headerKey = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_')

/**
 * Reads a contact CSV. The phone column is required; name and tags are
 * recognised by a few common spellings; every other column becomes a contact
 * attribute. A number listed twice is merged into one row.
 */
export function contactRowsFromCsv(text: string): ImportResult {
  const table = parseCsv(text)
  const errors: ImportResult['errors'] = []
  if (table.length === 0) return { rows: [], errors: [{ line: 1, reason: 'File kosong.' }] }

  const header = table[0]!.map(headerKey)
  const phoneCol = header.findIndex((h) => PHONE.has(h))
  if (phoneCol < 0) {
    return { rows: [], errors: [{ line: 1, reason: 'Tidak ada kolom nomor (phone / nomor / no_hp / whatsapp).' }] }
  }
  const nameCol = header.findIndex((h) => NAME.has(h))
  const tagsCol = header.findIndex((h) => TAGS.has(h))
  const attrCols = header
    .map((h, i) => ({ key: h, i }))
    .filter(({ i }) => i !== phoneCol && i !== nameCol && i !== tagsCol)
  for (const { key } of attrCols) {
    if (key && !ATTRIBUTE_KEY.test(key)) {
      errors.push({ line: 1, reason: `Kolom "${key}" dilewati: nama atribut hanya huruf, angka, dan garis bawah.` })
    }
  }
  const usableAttrCols = attrCols.filter(({ key }) => ATTRIBUTE_KEY.test(key))

  const body = table.slice(1)
  if (body.length > IMPORT_MAX_ROWS) {
    errors.push({ line: IMPORT_MAX_ROWS + 2, reason: `Maksimal ${IMPORT_MAX_ROWS} baris per impor; sisanya dilewati.` })
  }

  const byWaId = new Map<string, ImportedContact>()
  body.slice(0, IMPORT_MAX_ROWS).forEach((cells, idx) => {
    const line = idx + 2
    const rawPhone = cells[phoneCol]?.trim() ?? ''
    if (!rawPhone) return errors.push({ line, reason: 'Nomor kosong.' })
    const waId = normalizeWaId(rawPhone)
    if (!waId) return errors.push({ line, reason: `Nomor "${rawPhone}" tidak valid.` })

    const name = nameCol >= 0 ? cells[nameCol]?.trim().slice(0, 200) : undefined
    const tags =
      tagsCol >= 0
        ? (cells[tagsCol] ?? '')
            .split(/[;|,]/)
            .map((t) => t.trim().slice(0, 50))
            .filter(Boolean)
        : []
    const attributes: Record<string, string> = {}
    for (const { key, i } of usableAttrCols) {
      const v = cells[i]?.trim()
      if (v) attributes[key] = v
    }

    const prev = byWaId.get(waId)
    if (prev) {
      prev.name = name || prev.name
      prev.tags = [...new Set([...prev.tags, ...tags])]
      Object.assign(prev.attributes, attributes)
    } else {
      byWaId.set(waId, { waId, ...(name ? { name } : {}), tags: [...new Set(tags)], attributes })
    }
  })

  return { rows: [...byWaId.values()], errors }
}
