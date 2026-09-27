'use client'

import Link from 'next/link'
import { useActionState, useEffect, useId, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  createContact,
  importContacts,
  type AddContactState,
  type ImportState,
} from '@/lib/actions/contacts'
import { Modal } from '@/components/ui/modal'
import { IconDownload, IconUpload } from '@/components/ui/icons'
import { dialogDanger, dialogPrimary, dialogSecondary, hint, input, label } from '@/components/ui/styles'

type Tags = { tag: string; count: number }[]

function Submit({ children, pendingText }: { children: React.ReactNode; pendingText: string }) {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className={dialogPrimary}>
      {pending ? pendingText : children}
    </button>
  )
}

function TagOptions({ id, tags }: { id: string; tags: string[] }) {
  return (
    <datalist id={id}>
      {tags.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  )
}

// ---------- Add one contact ----------

export function AddContactDialog({
  open,
  tags,
  onClose,
  onDone,
}: {
  open: boolean
  tags: Tags
  onClose: () => void
  onDone: (message: string) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Tambah kontak" description="Nomor ditulis dengan awalan 0 atau kode negara.">
      <AddContactForm tags={tags} onClose={onClose} onDone={onDone} />
    </Modal>
  )
}

function AddContactForm({ tags, onClose, onDone }: { tags: Tags; onClose: () => void; onDone: (m: string) => void }) {
  const [state, action] = useActionState<AddContactState, FormData>(createContact, {})
  const listId = useId()

  useEffect(() => {
    if (!state.ok) return
    onDone('Kontak ditambahkan.')
    onClose()
    // Only a new success should close the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className={label}>Nomor WhatsApp</span>
        <input name="phone" required inputMode="tel" autoComplete="off" placeholder="0812 3456 7890" className={input} />
      </label>
      <label className="block">
        <span className={label}>Nama</span>
        <input name="name" maxLength={200} placeholder="Budi Santoso" className={input} />
      </label>
      <label className="block">
        <span className={label}>Grup</span>
        <input name="tags" list={listId} placeholder="pelapor, rw-05" className={input} />
        <TagOptions id={listId} tags={tags.map((t) => t.tag)} />
        <span className={hint}>Pisahkan dengan koma. Grup baru dibuat otomatis.</span>
      </label>
      <label className="flex items-start gap-2 text-[12px] text-fg">
        <input type="checkbox" name="optIn" className="mt-0.5 size-4 accent-accent" />
        <span>
          Kontak ini sudah setuju menerima pesan
          <span className="block text-[11px] text-fg-muted">Dicatat sebagai opt-in manual atas nama kamu.</span>
        </span>
      </label>

      {state.error && (
        <p className="text-xs text-danger">
          {state.error}{' '}
          {state.existingId && (
            <Link href={`/contacts/${state.existingId}`} className="underline">
              Buka kontaknya
            </Link>
          )}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <Submit pendingText="Menyimpan…">Simpan</Submit>
      </div>
    </form>
  )
}

// ---------- Import from CSV ----------

const SAMPLE_CSV = 'nomor,nama,grup,kelurahan\n081234567890,Budi Santoso,pelapor;rw-05,Cibabat\n+6285700001111,Siti Aminah,rw-05,Cimahi\n'

function downloadSample() {
  const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'contoh-kontak.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export function ImportDialog({
  open,
  tags,
  onClose,
  onDone,
}: {
  open: boolean
  tags: Tags
  onClose: () => void
  onDone: (message: string) => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Impor kontak"
      description="File CSV, maksimal 2 MB atau 5.000 baris."
      className="max-w-lg"
    >
      <ImportForm tags={tags} onClose={onClose} onDone={onDone} />
    </Modal>
  )
}

function ImportForm({ tags, onClose, onDone }: { tags: Tags; onClose: () => void; onDone: (m: string) => void }) {
  const [state, action] = useActionState<ImportState, FormData>(importContacts, {})
  const [fileName, setFileName] = useState('')
  const listId = useId()
  const r = state.result

  useEffect(() => {
    if (r) onDone(`Impor selesai: ${r.created} baru, ${r.updated} diperbarui.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r])

  if (r) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ['Baru', r.created],
            ['Diperbarui', r.updated],
            ['Tidak berubah', r.unchanged],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-muted px-2 py-3">
              <div className="text-h5 text-fg">{v}</div>
              <div className="text-[11px] text-fg-muted">{k}</div>
            </div>
          ))}
        </div>
        {r.errors.length > 0 && (
          <div>
            <p className="text-xs text-fg">{r.errors.length} baris dilewati</p>
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border text-[11px]">
              {r.errors.map((e, i) => (
                <li key={i} className="flex gap-3 border-t px-3 py-1.5 first:border-t-0">
                  <span className="w-14 shrink-0 text-fg-muted">baris {e.line}</span>
                  <span className="text-danger">{e.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <button type="button" onClick={onClose} className={dialogPrimary}>
            Selesai
          </button>
        </div>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-6 text-center hover:border-accent">
        <IconUpload size={22} className="text-accent" />
        <span className="text-[13px] text-fg">{fileName || 'Pilih file CSV'}</span>
        <span className="text-[11px] text-fg-muted">
          Kolom wajib: <code className="font-mono">nomor</code>. Opsional: <code className="font-mono">nama</code>,{' '}
          <code className="font-mono">grup</code> (pisahkan dengan ;), kolom lain jadi atribut.
        </span>
        <input
          type="file"
          name="file"
          required
          accept=".csv,text/csv"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
          className="sr-only"
        />
      </label>

      <button type="button" onClick={downloadSample} className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline">
        <IconDownload size={14} />
        Unduh contoh CSV
      </button>

      <label className="block">
        <span className={label}>Masukkan semua ke grup (opsional)</span>
        <input name="group" list={listId} maxLength={50} placeholder="impor-september" className={input} />
        <TagOptions id={listId} tags={tags.map((t) => t.tag)} />
      </label>

      <label className="flex items-start gap-2 text-[12px] text-fg">
        <input type="checkbox" name="optIn" className="mt-0.5 size-4 accent-accent" />
        <span>
          Semua kontak di file ini sudah setuju menerima pesan
          <span className="block text-[11px] text-fg-muted">
            Kontak yang pernah membalas STOP tetap berhenti, apa pun isi file.
          </span>
        </span>
      </label>

      {state.error && <p className="text-xs text-danger">{state.error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <Submit pendingText="Mengimpor…">Impor</Submit>
      </div>
    </form>
  )
}

// ---------- Bulk: add to / remove from a group ----------

export function BulkTagDialog({
  mode,
  open,
  count,
  tags,
  busy,
  onClose,
  onSubmit,
}: {
  mode: 'add' | 'remove'
  open: boolean
  count: number
  tags: string[]
  busy: boolean
  onClose: () => void
  onSubmit: (tag: string) => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'add' ? 'Tambah ke grup' : 'Keluarkan dari grup'}
      description={`${count} kontak dipilih.`}
    >
      <BulkTagForm mode={mode} tags={tags} busy={busy} onClose={onClose} onSubmit={onSubmit} />
    </Modal>
  )
}

function BulkTagForm({
  mode,
  tags,
  busy,
  onClose,
  onSubmit,
}: {
  mode: 'add' | 'remove'
  tags: string[]
  busy: boolean
  onClose: () => void
  onSubmit: (tag: string) => void
}) {
  const [tag, setTag] = useState(mode === 'remove' ? (tags[0] ?? '') : '')
  const listId = useId()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (tag.trim()) onSubmit(tag.trim())
      }}
      className="space-y-3"
    >
      {mode === 'add' ? (
        <label className="block">
          <span className={label}>Nama grup</span>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            list={listId}
            required
            maxLength={50}
            autoFocus
            placeholder="rw-05"
            className={input}
          />
          <TagOptions id={listId} tags={tags} />
          <span className={hint}>Pilih grup yang ada atau ketik nama baru.</span>
        </label>
      ) : tags.length ? (
        <label className="block">
          <span className={label}>Grup</span>
          <select value={tag} onChange={(e) => setTag(e.target.value)} className={input}>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-xs text-fg-muted">Kontak yang dipilih belum masuk grup mana pun.</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <button disabled={busy || !tag.trim()} className={dialogPrimary}>
          {busy ? 'Menyimpan…' : mode === 'add' ? 'Tambahkan' : 'Keluarkan'}
        </button>
      </div>
    </form>
  )
}

// ---------- Bulk: delete ----------

export function DeleteContactsDialog({
  open,
  count,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  count: number
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={`Hapus ${count} kontak?`}>
      <p className="text-[13px] text-fg">
        Percakapan, riwayat pesan, dan catatan broadcast mereka ikut terhapus dan tidak bisa dikembalikan.
      </p>
      <p className="mt-2 text-[11px] text-fg-muted">
        Kalau hanya ingin berhenti mengirimi mereka, pakai <b>Tandai berhenti</b>.
      </p>
      <div className="flex justify-end gap-2 pt-5">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <button type="button" disabled={busy} onClick={onConfirm} className={dialogDanger}>
          {busy ? 'Menghapus…' : 'Hapus permanen'}
        </button>
      </div>
    </Modal>
  )
}
