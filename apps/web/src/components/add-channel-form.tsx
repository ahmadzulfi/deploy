'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { addChannel, type ChannelFormState } from '@/lib/actions/channels'

const FIELDS = [
  {
    name: 'name',
    label: 'Nama internal',
    placeholder: 'CS Utama',
    hint: 'Hanya untuk kamu — tidak terlihat oleh pelanggan.',
  },
  {
    name: 'wabaId',
    label: 'WhatsApp Business Account ID',
    placeholder: '868891459412926',
    hint: null,
  },
  {
    name: 'phoneNumberId',
    label: 'Phone Number ID',
    placeholder: '1257109140820023',
    hint: 'Bukan nomor teleponnya — ID dari App Dashboard.',
  },
] as const

export function AddChannelForm() {
  const [state, action] = useActionState<ChannelFormState, FormData>(addChannel, {})
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-5 h-9 rounded-md border bg-surface px-3 text-sm text-fg hover:bg-muted"
      >
        Tambah nomor
      </button>
    )
  }

  return (
    <form action={action} className="mt-5 rounded-lg border bg-surface p-4">
      <h2 className="text-sm text-fg">Tambah nomor</h2>
      <p className="mt-1 mb-4 text-xs text-fg-muted">
        Kredensial diverifikasi ke Meta sebelum disimpan, dan token dienkripsi.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.name} className="block">
            <span className="text-xs text-fg">{f.label}</span>
            <input
              name={f.name}
              required
              placeholder={f.placeholder}
              className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent"
            />
            {f.hint && <span className="mt-1 block text-[11px] text-fg-muted">{f.hint}</span>}
          </label>
        ))}

        <label className="block sm:col-span-2">
          <span className="text-xs text-fg">System User token</span>
          <input
            name="token"
            type="password"
            required
            placeholder="EAAG…"
            className="mt-1 h-9 w-full rounded-md border bg-surface px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-fg-muted focus:border-accent"
          />
          <span className="mt-1 block text-[11px] text-fg-muted">
            Pakai System User token, bukan token sementara dari Graph API Explorer — yang itu
            kedaluwarsa dalam 24 jam dan pengiriman berhenti tanpa pesan yang menyebut expiry.
          </span>
        </label>
      </div>

      {state.error && <p className="mt-3 text-xs text-danger">{state.error}</p>}
      {state.ok && <p className="mt-3 text-xs text-ok">{state.ok}</p>}

      <div className="mt-4 flex gap-2">
        <Submit />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-9 rounded-md border bg-surface px-3 text-sm text-fg-muted hover:bg-muted"
        >
          Batal
        </button>
      </div>
    </form>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className="h-9 rounded-md bg-fg px-3 text-sm text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Memverifikasi ke Meta…' : 'Verifikasi dan simpan'}
    </button>
  )
}
