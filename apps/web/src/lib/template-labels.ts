import { TEMPLATE_LANGUAGES } from '@wa/core/template-draft'

/** Browser-safe display rules for templates, shared by the list and detail pages. */

export const TEMPLATE_STATUS: Record<string, { label: string; dot: string }> = {
  APPROVED: { label: 'Disetujui', dot: 'bg-ok' },
  PENDING: { label: 'Menunggu', dot: 'bg-warn' },
  REJECTED: { label: 'Ditolak', dot: 'bg-danger' },
  PAUSED: { label: 'Dijeda', dot: 'bg-warn' },
  DISABLED: { label: 'Nonaktif', dot: 'bg-fg-muted' },
  DRAFT: { label: 'Draf', dot: 'bg-fg-muted' },
}

export const CATEGORY_LABEL: Record<string, { label: string; tone: string }> = {
  MARKETING: { label: 'Marketing', tone: 'bg-accent-bg text-accent' },
  UTILITY: { label: 'Utility', tone: 'bg-ok-bg text-ok' },
  AUTHENTICATION: { label: 'Authentication', tone: 'bg-brand-bg text-brand' },
}

/** Tabs of the list page and the statuses each one shows. */
export const TEMPLATE_TABS = {
  all: { label: 'Semua', statuses: null },
  pending: { label: 'Menunggu', statuses: ['PENDING', 'DRAFT'] },
  action: { label: 'Perlu tindakan', statuses: ['REJECTED', 'PAUSED', 'DISABLED'] },
  approved: { label: 'Disetujui', statuses: ['APPROVED'] },
} as const

export type TemplateTab = keyof typeof TEMPLATE_TABS

export function languageLabel(code: string) {
  const known = TEMPLATE_LANGUAGES.find((l) => l.code === code)
  if (known) return known.label
  try {
    return new Intl.DisplayNames('id', { type: 'language' }).of(code.replace('_', '-')) ?? code
  } catch {
    return code
  }
}

/** "10-03-2026 19:32", the way the list shows edits. */
export function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
