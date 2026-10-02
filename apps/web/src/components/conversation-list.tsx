'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { listConversations } from '@/lib/actions/inbox'
import { filterFrom, isDefaultFilter, queryOf, type InboxFilter, type InboxRow } from '@/lib/inbox-filter'
import { ChannelFilter } from '@/components/channel-filter'
import { ConversationRow } from '@/components/conversation-row'

/**
 * The inbox's left column.
 *
 * The layout renders the unfiltered list; a filter in the URL is fetched from
 * here, because a layout is never given searchParams. A refresh hands down a
 * new `initial`, which is the cue to fetch the filtered rows again too.
 */
export function ConversationList({
  initial,
  channels,
  labels,
}: {
  initial: InboxRow[]
  channels: { id: string; name: string }[]
  labels: { id: string; name: string; color: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const filter = filterFrom(useSearchParams())
  const query = queryOf(filter)
  const filtered = !isDefaultFilter(filter)

  const [fetched, setFetched] = useState<{ query: string; rows: InboxRow[] } | null>(null)
  useEffect(() => {
    if (!filtered) return
    let live = true
    listConversations(filter).then((rows) => live && setFetched({ query, rows }))
    return () => {
      live = false
    }
    // `filter` is rebuilt every render; `query` is its stable spelling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, initial])

  // A refetch of the same filter keeps its old rows up meanwhile; a new
  // filter shows "Memuat…" rather than rows that do not match it.
  const rows = !filtered ? initial : fetched?.query === query ? fetched.rows : null

  const change = (next: InboxFilter) => router.replace(`${pathname}${queryOf(next)}`, { scroll: false })

  return (
    <>
      <ChannelFilter channels={channels} labels={labels} filter={filter} onChange={change} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null && <p className="p-6 text-center text-xs text-fg-muted">Memuat…</p>}

        {rows?.length === 0 &&
          (filtered ? (
            <div className="p-6 text-center text-xs text-fg-muted">
              <p>Tidak ada percakapan yang cocok dengan saringan ini.</p>
              <button
                type="button"
                onClick={() => change({ channelId: null, labelId: null, status: 'open' })}
                className="mt-2 text-accent hover:underline"
              >
                Hapus saringan
              </button>
            </div>
          ) : (
            <p className="p-6 text-center text-xs text-fg-muted">
              Belum ada percakapan. Pesan masuk akan muncul di sini.
            </p>
          ))}

        {rows?.map((c) => (
          <ConversationRow
            key={c.id}
            id={c.id}
            query={query}
            title={c.title}
            preview={c.preview}
            time={c.time}
            channelName={c.channelName}
            windowExpiresAt={c.windowExpiresAt}
            unreadCount={c.unreadCount}
            labels={c.labels}
          />
        ))}
      </div>
    </>
  )
}
