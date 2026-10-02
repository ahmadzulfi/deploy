'use server'

import { requireUser } from '@/lib/auth'
import { loadInbox } from '@/lib/inbox'
import type { InboxFilter, InboxRow } from '@/lib/inbox-filter'

/**
 * The inbox list under a filter.
 *
 * A layout never receives searchParams, so the list cannot be filtered where
 * it is rendered; the client list asks for the filtered rows here instead.
 */
export async function listConversations(filter: InboxFilter): Promise<InboxRow[]> {
  const user = await requireUser()
  // Straight from the browser, so nothing in it is trusted to be well-formed.
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return loadInbox(user, {
    channelId: text(filter.channelId),
    labelId: text(filter.labelId),
    status: filter.status === 'mine' || filter.status === 'closed' ? filter.status : 'open',
  })
}
