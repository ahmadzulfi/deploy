/**
 * Conversation labels: a short name, an optional description and one colour
 * from a fixed palette.
 *
 * Kept apart from contact tags on purpose. Tags are groups - broadcasts and
 * the flow's tag node target them - while a label only sorts the inbox, so
 * marking a chat "Komplain" never puts that person on a mailing list.
 *
 * Colours are palette keys, not hex: every key has a light and a dark pair of
 * tokens in globals.css, measured for contrast, so a chip stays readable in
 * both themes whatever an admin picks.
 */

export const LABEL_COLORS = ['gray', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'purple'] as const

export type LabelColor = (typeof LABEL_COLORS)[number]

export const LABEL_COLOR_NAMES: Record<LabelColor, string> = {
  gray: 'Abu-abu',
  blue: 'Biru',
  teal: 'Toska',
  green: 'Hijau',
  yellow: 'Kuning',
  orange: 'Oranye',
  red: 'Merah',
  purple: 'Ungu',
}

export const LABEL_NAME_MAX = 40
export const LABEL_DESCRIPTION_MAX = 200
/** More than this and the picker stops being something an agent can scan. */
export const LABELS_PER_ORG_MAX = 100

export function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === 'string' && (LABEL_COLORS as readonly string[]).includes(value)
}

/** Trimmed, with runs of whitespace collapsed - "  Butuh   tindak lanjut " is one name. */
export function cleanLabelName(raw: string) {
  return raw.trim().replace(/\s+/g, ' ')
}

export interface LabelInput {
  name: string
  description: string
  color: string
}

/** The first problem with a label as typed, in the words the form shows; null when it is fine. */
export function checkLabel({ name, description, color }: LabelInput): string | null {
  if (!name) return 'Nama label wajib diisi.'
  if (name.length > LABEL_NAME_MAX) return `Nama label maksimal ${LABEL_NAME_MAX} karakter.`
  if (description.length > LABEL_DESCRIPTION_MAX) return `Deskripsi maksimal ${LABEL_DESCRIPTION_MAX} karakter.`
  if (!isLabelColor(color)) return 'Pilih salah satu warna.'
  return null
}
