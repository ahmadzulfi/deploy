'use client'

import { useActionState, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { createApiKey, revokeApiKey, type ApiKeyState } from '@/lib/actions/settings'
import { cn } from '@/lib/utils'

interface Key {
  id: string
  name: string
  scopes: string[]
  /** Names of the numbers the key is limited to; empty = every number. */
  channels: string[]
  createdAt: string
  lastUsedAt: string | null
}

export function ApiKeys({
  canManage,
  keys,
  channels,
  scopes,
}: {
  canManage: boolean
  keys: Key[]
  channels: { id: string; name: string }[]
  scopes: readonly string[]
}) {
  const [state, action] = useActionState<ApiKeyState, FormData>(createApiKey, {})
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  return (
    <div>
      <div className="overflow-hidden rounded-lg border bg-surface">
        {keys.length === 0 && (
          <p className="p-6 text-center text-xs text-fg-muted">Belum ada API key.</p>
        )}

        {keys.map((k, i) => (
          <div key={k.id} className={cn('flex items-center gap-4 p-3', i > 0 && 'border-t')}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-fg">{k.name}</div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {k.scopes.map((s) => (
                  <span key={s} className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-fg-muted">
                    {s}
                  </span>
                ))}
              </div>
              <div className="mt-0.5 text-[10px] text-fg-muted">
                {k.channels.length ? `Hanya: ${k.channels.join(', ')}` : 'Semua nomor'}
              </div>
            </div>

            <div className="hidden w-32 shrink-0 text-[11px] text-fg-muted sm:block">
              {k.lastUsedAt ? `Dipakai ${k.lastUsedAt}` : 'Belum pernah dipakai'}
            </div>

            {canManage && (
              <button
                disabled={pending}
                onClick={() => start(() => void revokeApiKey(k.id))}
                className="shrink-0 text-[11px] text-fg-muted hover:text-danger disabled:opacity-50"
                title="Cabut kunci ini secara permanen"
              >
                Cabut
              </button>
            )}
          </div>
        ))}
      </div>

      {state.created && (
        <div className="mt-3 rounded-lg border border-ok bg-ok-bg p-3">
          <p className="text-[11px] text-ok">
            Salin sekarang — kunci ini tidak akan ditampilkan lagi.
          </p>
          <code className="mt-1.5 block rounded bg-surface px-2 py-1.5 font-mono text-[11px] break-all text-fg">
            {state.created}
          </code>
        </div>
      )}

      {canManage &&
        (open ? (
          <form action={action} className="mt-3 rounded-lg border bg-surface p-4">
            <label className="block">
              <span className="text-xs text-fg">Nama</span>
              <input
                name="name"
                required
                placeholder="Integrasi ERP"
                className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent"
              />
            </label>

            <fieldset className="mt-3">
              <legend className="text-xs text-fg">Izin</legend>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {scopes.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-[11px] text-fg">
                    <input type="checkbox" name={`scope:${s}`} />
                    <code className="font-mono">{s}</code>
                  </label>
                ))}
              </div>
            </fieldset>

            {channels.length > 1 && (
              <fieldset className="mt-3">
                <legend className="text-xs text-fg">Nomor</legend>
                <p className="mt-0.5 text-[11px] text-fg-muted">
                  Kosongkan semua untuk mengizinkan setiap nomor, termasuk yang ditambahkan nanti.
                </p>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                  {channels.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-[11px] text-fg">
                      <input type="checkbox" name="channel" value={c.id} />
                      {c.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {state.error && <p className="mt-3 text-xs text-danger">{state.error}</p>}

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
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="mt-3 h-9 rounded-md border bg-surface px-3 text-sm text-fg hover:bg-muted"
          >
            Buat API key
          </button>
        ))}
    </div>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className="h-9 rounded-md bg-fg px-3 text-sm text-on-fg hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Membuat…' : 'Buat kunci'}
    </button>
  )
}
