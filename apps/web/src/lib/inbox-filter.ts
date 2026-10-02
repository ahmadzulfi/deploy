/**
 * The inbox filter as it lives in the URL - ?channel=&label=&status= - kept
 * free of database imports so the client list can read it too.
 */

export type InboxStatus = 'open' | 'mine' | 'closed'

export interface InboxFilter {
  channelId: string | null
  labelId: string | null
  status: InboxStatus
}

export interface InboxRow {
  id: string
  title: string
  preview: string
  time: string
  channelName: string
  windowExpiresAt: Date | null
  unreadCount: number
  labels: { id: string; name: string; color: string }[]
}

export const DEFAULT_FILTER: InboxFilter = { channelId: null, labelId: null, status: 'open' }

/** Anything unknown means "no filter" on that axis. */
export function filterFrom(params: { get(name: string): string | null }): InboxFilter {
  const status = params.get('status')
  return {
    channelId: params.get('channel') || null,
    labelId: params.get('label') || null,
    status: status === 'mine' || status === 'closed' ? status : 'open',
  }
}

export function isDefaultFilter(f: InboxFilter) {
  return !f.channelId && !f.labelId && f.status === 'open'
}

/** "?channel=…&label=…", or "" for the default view, so links stay clean. */
export function queryOf(f: InboxFilter) {
  const q = new URLSearchParams()
  if (f.channelId) q.set('channel', f.channelId)
  if (f.labelId) q.set('label', f.labelId)
  if (f.status !== 'open') q.set('status', f.status)
  const s = q.toString()
  return s ? `?${s}` : ''
}
