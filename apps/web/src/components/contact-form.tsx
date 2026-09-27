'use client'

import { useActionState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { setOptIn, updateContact, type ContactState } from '@/lib/actions/contacts'

interface Props {
  id: string
  name: string
  tags: string[]
  attributes: string
  optInStatus: string
  canEdit: boolean
}

export function ContactForm({ id, name, tags, attributes, optInStatus, canEdit }: Props) {
  const [state, action] = useActionState<ContactState, FormData>(updateContact, {})
  const [pending, start] = useTransition()

  return (
    <div className="space-y-4">
      <form action={action} className="rounded-lg border bg-surface p-4">
        <input type="hidden" name="id" value={id} />
        <fieldset disabled={!canEdit} className="space-y-3">
          <label className="block">
            <span className="text-xs text-fg">Nama</span>
            <input
              name="name"
              defaultValue={name}
              className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none focus:border-accent disabled:bg-muted"
            />
          </label>

          <label className="block">
            <span className="text-xs text-fg">Tag</span>
            <input
              name="tags"
              defaultValue={tags.join(', ')}
              placeholder="pelapor, rw-05"
              className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent disabled:bg-muted"
            />
            <span className="mt-1 block text-[11px] text-fg-muted">Pisahkan dengan koma.</span>
          </label>

          <label className="block">
            <span className="text-xs text-fg">Atribut</span>
            <textarea
              name="attributes"
              defaultValue={attributes}
              rows={Math.max(3, attributes.split('\n').length + 1)}
              placeholder={'kelurahan=Cibabat\nnik_terverifikasi=true'}
              className="mt-1 w-full rounded-md border bg-surface px-3 py-2 font-mono text-[12px] outline-none placeholder:text-fg-muted focus:border-accent disabled:bg-muted"
            />
            <span className="mt-1 block text-[11px] text-fg-muted">
              Satu per baris, <code className="font-mono">kunci=nilai</code>. Hapus barisnya untuk menghapus atribut.
            </span>
          </label>
        </fieldset>

        {state.error && <p className="mt-3 text-xs text-danger">{state.error}</p>}
        {state.ok && !state.error && <p className="mt-3 text-xs text-ok">Tersimpan.</p>}
        {canEdit && <Save />}
      </form>

      {canEdit && (
        <div className="flex items-center justify-between rounded-lg border bg-surface p-4">
          <div>
            <div className="text-xs text-fg">Persetujuan pesan broadcast</div>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              {optInStatus === 'OPTED_OUT'
                ? 'Kontak ini berhenti berlangganan dan dilewati semua broadcast.'
                : optInStatus === 'OPTED_IN'
                  ? 'Kontak ini setuju menerima broadcast.'
                  : 'Belum ada persetujuan tercatat. Broadcast yang hanya ke kontak opt-in melewatinya.'}
            </p>
          </div>
          <button
            disabled={pending}
            onClick={() => start(() => void setOptIn(id, optInStatus !== 'OPTED_IN'))}
            className="h-8 shrink-0 rounded-md border bg-surface px-3 text-xs text-fg hover:bg-muted disabled:opacity-50"
          >
            {optInStatus === 'OPTED_IN' ? 'Tandai berhenti' : 'Tandai opt-in'}
          </button>
        </div>
      )}
    </div>
  )
}

function Save() {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className="mt-4 h-9 rounded-md bg-fg px-3 text-sm text-on-fg hover:opacity-90 disabled:opacity-50">
      {pending ? 'Menyimpan…' : 'Simpan'}
    </button>
  )
}
