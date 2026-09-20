import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function initials(name: string | null | undefined, fallback: string) {
  const source = name?.trim() || fallback
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/** "01:27" today, "Kemarin" yesterday, otherwise "20 Sep". */
export function shortTime(date: Date | null | undefined) {
  if (!date) return ''
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Kemarin'
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}
