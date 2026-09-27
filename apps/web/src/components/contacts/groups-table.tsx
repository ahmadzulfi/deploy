'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { createGroup, deleteGroup, renameGroup, type GroupState } from '@/lib/actions/contacts'
import { Modal } from '@/components/ui/modal'
import { IconGroup, IconPencil, IconTrash } from '@/components/ui/icons'
import { dialogDanger, dialogPrimary, dialogSecondary, hint, input, label } from '@/components/ui/styles'

/**
 * A group is a tag: every contact carrying it is a member. Renaming or
 * deleting one rewrites the tag on those contacts; the contacts stay.
 */
export function GroupsTable({
  groups,
  canManage,
  searching,
}: {
  groups: { tag: string; count: number }[]
  canManage: boolean
  searching: boolean
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const iconButton = 'flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg'

  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-surface">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-[11px] text-fg-muted">
              <th className="py-2.5 pl-4 font-medium">Nama grup</th>
              <th className="px-2 py-2.5 font-medium">Anggota</th>
              <th className="py-2.5 pr-4 pl-2 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={3} className="p-10 text-center text-sm text-fg-muted">
                  {searching
                    ? 'Tidak ada grup yang cocok.'
                    : 'Belum ada grup. Buat grup dari daftar nomor, atau pilih kontak lalu Aksi → Tambah ke grup.'}
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <tr key={g.tag} className="border-t first:border-t-0 hover:bg-muted/60">
                <td className="py-2.5 pl-4">
                  <Link href={`/contacts?tag=${encodeURIComponent(g.tag)}`} className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-bg text-accent">
                      <IconGroup size={15} />
                    </span>
                    <span className="truncate text-fg hover:underline">{g.tag}</span>
                  </Link>
                </td>
                <td className="px-2 py-2.5 text-fg-muted">{g.count} kontak</td>
                <td className="py-2.5 pr-4 pl-2">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/contacts?tag=${encodeURIComponent(g.tag)}`}
                      className="mr-1 text-[11px] font-semibold tracking-wide text-accent uppercase hover:underline"
                    >
                      Lihat anggota
                    </Link>
                    {canManage && (
                      <>
                        <button type="button" onClick={() => setRenaming(g.tag)} aria-label={`Ganti nama ${g.tag}`} className={iconButton}>
                          <IconPencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(g.tag)}
                          aria-label={`Hapus grup ${g.tag}`}
                          className={`${iconButton} hover:text-danger`}
                        >
                          <IconTrash size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {groups.length >= 200 && (
          <p className="border-t px-4 py-2 text-[11px] text-fg-muted">Menampilkan 200 grup terbesar.</p>
        )}
      </div>

      <Modal open={renaming !== null} onClose={() => setRenaming(null)} title="Ganti nama grup">
        {renaming && <RenameForm from={renaming} onClose={() => setRenaming(null)} />}
      </Modal>
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={`Hapus grup ${deleting ?? ''}?`}>
        {deleting && <DeleteForm tag={deleting} onClose={() => setDeleting(null)} />}
      </Modal>
    </>
  )
}

function RenameForm({ from, onClose }: { from: string; onClose: () => void }) {
  const [to, setTo] = useState(from)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await renameGroup(from, to)
          if (res.error) setError(res.error)
          else onClose()
        })
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className={label}>Nama baru</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} required maxLength={50} autoFocus className={input} />
        <span className={hint}>Kalau nama ini sudah dipakai grup lain, kedua grup digabung.</span>
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <button disabled={pending || !to.trim()} className={dialogPrimary}>
          {pending ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </form>
  )
}

function DeleteForm({ tag, onClose }: { tag: string; onClose: () => void }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <div>
      <p className="text-[13px] text-fg">
        Anggotanya tidak dihapus, hanya dikeluarkan dari grup <b>{tag}</b>. Broadcast yang sudah dibuat dengan grup ini
        tidak berubah.
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
              const res = await deleteGroup(tag)
              if (res.error) setError(res.error)
              else onClose()
            })
          }
          className={dialogDanger}
        >
          {pending ? 'Menghapus…' : 'Hapus grup'}
        </button>
      </div>
    </div>
  )
}

export function CreateGroupDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: (message: string) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Buat grup" description="Nomor yang belum jadi kontak akan ditambahkan.">
      <CreateGroupForm onClose={onClose} onDone={onDone} />
    </Modal>
  )
}

function CreateGroupForm({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [state, action] = useActionState<GroupState, FormData>(createGroup, {})

  useEffect(() => {
    if (!state.ok) return
    const skipped = state.invalid?.length ? `, ${state.invalid.length} nomor tidak valid dilewati` : ''
    onDone(`Grup dibuat: ${state.added ?? 0} anggota (${state.created ?? 0} kontak baru)${skipped}.`)
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className={label}>Nama grup</span>
        <input name="name" required maxLength={50} autoFocus placeholder="rw-05" className={input} />
      </label>
      <label className="block">
        <span className={label}>Nomor anggota</span>
        <textarea
          name="numbers"
          required
          rows={6}
          placeholder={'081234567890\n+6285700001111'}
          className="w-full rounded-md border bg-surface px-3 py-2 font-mono text-[12px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
        />
        <span className={hint}>Satu nomor per baris, atau pisahkan dengan koma.</span>
      </label>
      {state.error && (
        <p className="text-xs text-danger">
          {state.error}
          {state.invalid?.length ? ` Tidak valid: ${state.invalid.slice(0, 5).join(', ')}` : ''}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <CreateSubmit />
      </div>
    </form>
  )
}

function CreateSubmit() {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className={dialogPrimary}>
      {pending ? 'Membuat…' : 'Buat grup'}
    </button>
  )
}
