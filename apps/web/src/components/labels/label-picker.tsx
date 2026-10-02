'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { setConversationLabels } from '@/lib/actions/labels'
import { Menu } from '@/components/ui/menu'
import { IconCheck, IconTag } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { LabelChip, LabelDot, type LabelView } from './label-chip'

/**
 * The labels on one conversation, and the menu that changes them.
 *
 * Each tick saves at once - there is no "apply" step to forget - and shows
 * straight away; a refusal from the server puts the old set back.
 */
export function LabelPicker({
  conversationId,
  labels,
  selected,
  readOnly,
  canManage,
}: {
  conversationId: string
  /** Every label in the org, in the order the menu lists them. */
  labels: LabelView[]
  selected: string[]
  readOnly: boolean
  canManage: boolean
}) {
  const [ids, setIds] = useState(selected)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [, start] = useTransition()

  // A refresh after someone else's change brings a new set from the server.
  const key = selected.join()
  useEffect(() => setIds(selected), [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const on = labels.filter((l) => ids.includes(l.id))
  const q = search.trim().toLowerCase()
  const listed = q ? labels.filter((l) => l.name.toLowerCase().includes(q)) : labels

  function toggle(id: string) {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    setIds(next)
    setError('')
    start(async () => {
      const res = await setConversationLabels(conversationId, next)
      if (res.error) {
        setError(res.error)
        setIds(selected)
      }
    })
  }

  const chips = (
    <>
      {on.slice(0, 3).map((l) => (
        <LabelChip key={l.id} name={l.name} color={l.color} className="max-w-32" />
      ))}
      {on.length > 3 && (
        <span className="text-[11px] text-fg-muted" title={on.slice(3).map((l) => l.name).join(', ')}>
          +{on.length - 3}
        </span>
      )}
    </>
  )

  if (readOnly) return on.length ? <div className="flex min-w-0 items-center gap-1">{chips}</div> : null

  return (
    <div className="flex min-w-0 items-center gap-1">
      {chips}
      <Menu
        label="Atur label percakapan"
        triggerClassName={cn(
          'flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] text-fg-muted hover:bg-muted hover:text-fg',
          error && 'border-danger text-danger',
        )}
        trigger={
          <>
            <IconTag size={13} />
            {on.length === 0 && 'Label'}
          </>
        }
        panelClassName="w-60 p-0"
      >
        {labels.length > 8 && (
          <div className="border-b p-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari label"
              aria-label="Cari label"
              className="h-8 w-full rounded-md border bg-surface px-2.5 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-accent"
            />
          </div>
        )}

        <div className="max-h-64 overflow-y-auto p-1">
          {labels.length === 0 && (
            <p className="px-2.5 py-3 text-xs text-fg-muted">
              Belum ada label.{canManage ? '' : ' Minta supervisor atau admin membuatnya.'}
            </p>
          )}
          {labels.length > 0 && listed.length === 0 && (
            <p className="px-2.5 py-3 text-xs text-fg-muted">Tidak ada label yang cocok.</p>
          )}
          {listed.map((l) => {
            const checked = ids.includes(l.id)
            return (
              <label
                key={l.id}
                className="relative flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-fg hover:bg-muted"
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(l.id)} className="peer sr-only" />
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border peer-focus-visible:outline-2 peer-focus-visible:outline-accent',
                    checked && 'border-fg bg-fg text-on-fg',
                  )}
                >
                  {checked && <IconCheck size={11} />}
                </span>
                <LabelDot color={l.color} />
                <span className="truncate">{l.name}</span>
              </label>
            )
          })}
        </div>

        {error && <p className="border-t px-3 py-2 text-[11px] text-danger">{error}</p>}

        {canManage && (
          <Link
            href="/settings/labels"
            className="block border-t px-3 py-2 text-[11px] font-semibold tracking-wide text-accent uppercase hover:bg-muted"
          >
            Kelola label
          </Link>
        )}
      </Menu>
    </div>
  )
}
