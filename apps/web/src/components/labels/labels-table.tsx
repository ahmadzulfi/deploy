'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { LABEL_COLORS, LABEL_COLOR_NAMES, LABEL_DESCRIPTION_MAX, LABEL_NAME_MAX } from '@wa/core/labels'
import { deleteLabel, saveLabel, type LabelFormState } from '@/lib/actions/labels'
import { Modal } from '@/components/ui/modal'
import { IconPencil, IconPlusCircle, IconSearch, IconTrash } from '@/components/ui/icons'
import {
  dialogDanger,
  dialogPrimary,
  dialogSecondary,
  hint,
  input,
  label,
  primaryButton,
  toolbarCard,
} from '@/components/ui/styles'
import { cn } from '@/lib/utils'
import { LabelChip, LabelDot, colorOf } from './label-chip'

export interface LabelRow {
  id: string
  name: string
  description: string | null
  color: string
  conversations: number
}

export function LabelsTable({ labels, canManage }: { labels: LabelRow[]; canManage: boolean }) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<LabelRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<LabelRow | null>(null)

  const q = search.trim().toLowerCase()
  const shown = q
    ? labels.filter((l) => l.name.toLowerCase().includes(q) || l.description?.toLowerCase().includes(q))
    : labels
  const iconButton = 'flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg'

  return (
    <>
      <div className={cn(toolbarCard, 'flex flex-wrap items-center gap-2')}>
        {canManage && (
          <button type="button" onClick={() => setEditing('new')} className={primaryButton}>
            <IconPlusCircle size={15} />
            Tambah label
          </button>
        )}
        <label className="relative ml-auto w-full sm:w-60">
          <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari label"
            aria-label="Cari label"
            className={cn(input, 'pl-9')}
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-surface">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-[11px] text-fg-muted">
              <th className="py-2.5 pl-4 font-medium">Nama label</th>
              <th className="px-2 py-2.5 font-medium">Deskripsi</th>
              <th className="px-2 py-2.5 font-medium">Warna</th>
              <th className="px-2 py-2.5 font-medium">Dipakai</th>
              {canManage && <th className="py-2.5 pr-4 pl-2 text-right font-medium">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="p-10 text-center text-sm text-fg-muted">
                  {q
                    ? 'Tidak ada label yang cocok.'
                    : canManage
                      ? 'Belum ada label. Buat label pertama, lalu pasang di percakapan dari halaman Inbox.'
                      : 'Belum ada label. Supervisor atau admin bisa membuatnya di sini.'}
                </td>
              </tr>
            )}
            {shown.map((l) => (
              <tr key={l.id} className="border-t first:border-t-0 hover:bg-muted/60">
                <td className="py-2.5 pl-4">
                  <LabelChip name={l.name} color={l.color} />
                </td>
                <td className="max-w-72 px-2 py-2.5 text-fg-muted">
                  <span className="line-clamp-2">{l.description || '—'}</span>
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap text-fg-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <LabelDot color={l.color} />
                    {LABEL_COLOR_NAMES[colorOf(l.color)]}
                  </span>
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap">
                  {l.conversations > 0 ? (
                    <Link href={`/inbox?label=${l.id}`} className="text-accent hover:underline">
                      {l.conversations} percakapan
                    </Link>
                  ) : (
                    <span className="text-fg-muted">0 percakapan</span>
                  )}
                </td>
                {canManage && (
                  <td className="py-2.5 pr-4 pl-2">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => setEditing(l)} aria-label={`Ubah ${l.name}`} className={iconButton}>
                        <IconPencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(l)}
                        aria-label={`Hapus ${l.name}`}
                        className={`${iconButton} hover:text-danger`}
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Tambah label' : 'Ubah label'}
        description="Label hanya untuk memilah percakapan di Inbox, bukan grup broadcast."
      >
        {editing && <LabelForm label={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Modal>
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={`Hapus label ${deleting?.name ?? ''}?`}>
        {deleting && <DeleteForm label={deleting} onClose={() => setDeleting(null)} />}
      </Modal>
    </>
  )
}

function LabelForm({ label: existing, onClose }: { label: LabelRow | null; onClose: () => void }) {
  const [state, action] = useActionState<LabelFormState, FormData>(saveLabel, {})
  const [name, setName] = useState(existing?.name ?? '')
  const [color, setColor] = useState(existing ? colorOf(existing.color) : 'blue')

  useEffect(() => {
    if (state.saved) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.saved])

  return (
    <form action={action} className="space-y-4">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <label className="block">
        <span className={label}>Nama label</span>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={LABEL_NAME_MAX}
          placeholder="Komplain"
          className={input}
        />
      </label>
      <label className="block">
        <span className={label}>Deskripsi (opsional)</span>
        <textarea
          name="description"
          defaultValue={existing?.description ?? ''}
          maxLength={LABEL_DESCRIPTION_MAX}
          rows={2}
          placeholder="Kapan label ini dipakai"
          className="w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
        />
      </label>

      <fieldset>
        <legend className={label}>Warna</legend>
        <div className="flex flex-wrap gap-2">
          {LABEL_COLORS.map((c) => (
            <label key={c} title={LABEL_COLOR_NAMES[c]} className="relative cursor-pointer">
              <input
                type="radio"
                name="color"
                value={c}
                checked={color === c}
                onChange={() => setColor(c)}
                aria-label={LABEL_COLOR_NAMES[c]}
                className="peer sr-only"
              />
              <span className="flex size-8 items-center justify-center rounded-full border-2 border-transparent peer-checked:border-fg peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                <LabelDot color={c} className="size-5" />
              </span>
            </label>
          ))}
        </div>
        <span className={cn(hint, 'flex items-center gap-2')}>
          Pratinjau: <LabelChip name={name.trim() || 'Nama label'} color={color} />
        </span>
      </fieldset>

      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <Submit editing={!!existing} />
      </div>
    </form>
  )
}

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className={dialogPrimary}>
      {pending ? 'Menyimpan…' : editing ? 'Simpan' : 'Tambah label'}
    </button>
  )
}

function DeleteForm({ label: l, onClose }: { label: LabelRow; onClose: () => void }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <div>
      <p className="text-[13px] text-fg">
        {l.conversations > 0 ? (
          <>
            Label <b>{l.name}</b> dilepas dari {l.conversations} percakapan. Percakapannya sendiri tidak terhapus.
          </>
        ) : (
          <>
            Label <b>{l.name}</b> belum dipakai di percakapan mana pun.
          </>
        )}
      </p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2 pt-5">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await deleteLabel(l.id)
              if (res.error) setError(res.error)
              else onClose()
            })
          }
          className={dialogDanger}
        >
          {pending ? 'Menghapus…' : 'Hapus label'}
        </button>
      </div>
    </div>
  )
}
