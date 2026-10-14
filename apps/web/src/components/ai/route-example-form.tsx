'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { ROUTE_EXAMPLE_MAX } from '@wa/core/flow'
import { saveRouteExample, type ExampleFormState } from '@/lib/actions/route-review'
import { dialogPrimary, dialogSecondary, hint, input, label } from '@/components/ui/styles'
import type { MenuOption } from '@/lib/route-review'

/**
 * One example question and the menu destination it belongs to. Opened from a
 * contact's decision (prefilled with their words) or empty, by hand.
 */
export function RouteExampleForm({
  flowId,
  menu,
  decisionId,
  question = '',
  destinationId = '',
  onClose,
}: {
  flowId: string
  menu: MenuOption[]
  decisionId?: string
  question?: string
  destinationId?: string
  onClose: () => void
}) {
  const [state, action] = useActionState<ExampleFormState, FormData>(saveRouteExample, {})

  useEffect(() => {
    if (state.saved) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.saved])

  const known = menu.some((m) => m.id === destinationId)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="flowId" value={flowId} />
      {decisionId && <input type="hidden" name="decisionId" value={decisionId} />}

      <label className="block">
        <span className={label}>Pertanyaan</span>
        <textarea
          name="question"
          defaultValue={question}
          required
          maxLength={ROUTE_EXAMPLE_MAX}
          rows={3}
          placeholder="cara bikin skck"
          className="w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
        />
        <span className={hint}>
          Dikirim ke AI sebagai contoh, tidak pernah tampil ke warga. Hapus nama, alamat, atau isi keluhan pribadi; nomor
          panjang dan email disamarkan otomatis.
        </span>
      </label>

      <label className="block">
        <span className={label}>Tujuan yang benar</span>
        <select name="destinationId" defaultValue={known ? destinationId : ''} required className={input}>
          <option value="" disabled>
            Pilih menu tujuan
          </option>
          {menu.map((m) => (
            <option key={m.id} value={m.id}>
              {m.path}
            </option>
          ))}
        </select>
        {destinationId && !known && (
          <span className={hint}>Tujuan aslinya sudah tidak ada di menu yang sedang terbit. Pilih yang sekarang.</span>
        )}
      </label>

      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className={dialogSecondary}>
          Batal
        </button>
        <Submit />
      </div>
    </form>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button disabled={pending} className={dialogPrimary}>
      {pending ? 'Menyimpan…' : 'Jadikan contoh'}
    </button>
  )
}
