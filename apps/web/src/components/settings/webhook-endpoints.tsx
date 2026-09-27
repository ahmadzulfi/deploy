'use client'

import { useActionState, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import {
  createEndpoint,
  deleteEndpoint,
  pingEndpoint,
  retryDelivery,
  toggleEndpoint,
  type EndpointState,
} from '@/lib/actions/webhooks'
import { cn } from '@/lib/utils'

interface Delivery {
  id: string
  event: string
  status: string
  attempts: number
  responseStatus: number | null
  error: string | null
  createdAt: string
}

interface Endpoint {
  id: string
  name: string
  url: string
  events: string[]
  active: boolean
  /** Last attempt failed and nothing has succeeded since. */
  failing: boolean
  lastError: string | null
  deliveries: Delivery[]
}

const EVENT_HINT: Record<string, string> = {
  'message.received': 'Pesan masuk dari kontak',
  'message.sent': 'Pesan keluar diterima Meta',
  'message.delivered': 'Sampai di HP kontak',
  'message.read': 'Dibaca kontak',
  'message.failed': 'Gagal terkirim',
  'flow.completed': 'Flow selesai, beserta variabel yang dikumpulkan',
}

const STATUS_TONE: Record<string, string> = {
  SUCCEEDED: 'text-ok',
  PENDING: 'text-warn',
  FAILED: 'text-danger',
}

export function WebhookEndpoints({
  canManage,
  endpoints,
  events,
}: {
  canManage: boolean
  endpoints: Endpoint[]
  events: readonly string[]
}) {
  const [state, action] = useActionState<EndpointState, FormData>(createEndpoint, {})
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  return (
    <div>
      <div className="overflow-hidden rounded-lg border bg-surface">
        {endpoints.length === 0 && (
          <p className="p-6 text-center text-xs text-fg-muted">Belum ada webhook keluar.</p>
        )}

        {endpoints.map((e, i) => (
          <div key={e.id} className={cn(i > 0 && 'border-t')}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] text-fg">{e.name}</span>
                  {!e.active && (
                    <span className="rounded bg-muted px-1.5 py-px text-[10px] text-fg-muted">nonaktif</span>
                  )}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">{e.url}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {e.events.map((ev) => (
                    <span key={ev} className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-fg-muted">
                      {ev}
                    </span>
                  ))}
                </div>
                {e.failing && e.lastError && (
                  <p className="mt-1 truncate text-[11px] text-danger" title={e.lastError}>
                    Gagal terakhir: {e.lastError}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1 text-[11px]">
                <button
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="rounded-md px-2 py-1 text-fg-muted hover:bg-muted hover:text-fg"
                >
                  {expanded === e.id ? 'Tutup log' : 'Log'}
                </button>
                {canManage && (
                  <>
                    <button
                      disabled={pending}
                      onClick={() => start(() => void pingEndpoint(e.id))}
                      className="rounded-md px-2 py-1 text-fg-muted hover:bg-muted hover:text-fg disabled:opacity-50"
                      title="Kirim event ping untuk mengecek URL dan tanda tangan"
                    >
                      Tes
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => start(() => void toggleEndpoint(e.id))}
                      className="rounded-md px-2 py-1 text-fg-muted hover:bg-muted hover:text-fg disabled:opacity-50"
                    >
                      {e.active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                    {confirmDelete === e.id ? (
                      <>
                        <button
                          disabled={pending}
                          onClick={() => start(() => void deleteEndpoint(e.id))}
                          className="rounded-md px-2 py-1 text-danger hover:bg-danger-bg disabled:opacity-50"
                        >
                          Ya, hapus
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="rounded-md px-2 py-1 text-fg-muted hover:bg-muted"
                        >
                          Batal
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(e.id)}
                        className="rounded-md px-2 py-1 text-fg-muted hover:text-danger"
                      >
                        Hapus
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {expanded === e.id && (
              <div className="border-t bg-bg px-3 py-2">
                {e.deliveries.length === 0 ? (
                  <p className="py-2 text-[11px] text-fg-muted">Belum ada pengiriman.</p>
                ) : (
                  <table className="w-full text-[11px]">
                    <tbody>
                      {e.deliveries.map((d) => (
                        <tr key={d.id} className="border-t first:border-t-0 align-top">
                          <td className="py-1.5 pr-3 whitespace-nowrap text-fg-muted">{d.createdAt}</td>
                          <td className="py-1.5 pr-3 font-mono text-fg">{d.event}</td>
                          <td className={cn('py-1.5 pr-3 whitespace-nowrap', STATUS_TONE[d.status])}>
                            {d.status.toLowerCase()}
                            {d.responseStatus ? ` · ${d.responseStatus}` : ''}
                            {d.attempts > 1 ? ` · ${d.attempts}×` : ''}
                          </td>
                          <td className="max-w-[16rem] truncate py-1.5 pr-3 text-fg-muted" title={d.error ?? undefined}>
                            {d.error}
                          </td>
                          <td className="py-1.5 text-right">
                            {canManage && d.status === 'FAILED' && (
                              <button
                                disabled={pending}
                                onClick={() => start(() => void retryDelivery(d.id))}
                                className="text-accent hover:opacity-80 disabled:opacity-50"
                              >
                                Kirim ulang
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {state.secret && (
        <div className="mt-3 rounded-lg border border-ok bg-ok-bg p-3">
          <p className="text-[11px] text-ok">
            Secret untuk memverifikasi tanda tangan. Salin sekarang — tidak akan ditampilkan lagi.
          </p>
          <code className="mt-1.5 block rounded bg-surface px-2 py-1.5 font-mono text-[11px] break-all text-fg">
            {state.secret}
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
                placeholder="CRM pengaduan"
                className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent"
              />
            </label>

            <label className="mt-3 block">
              <span className="text-xs text-fg">URL penerima</span>
              <input
                name="url"
                type="url"
                required
                placeholder="https://sistem-lain.example.com/webhooks/wa"
                className="mt-1 h-9 w-full rounded-md border bg-surface px-3 font-mono text-[12px] outline-none placeholder:text-fg-muted focus:border-accent"
              />
            </label>

            <fieldset className="mt-3">
              <legend className="text-xs text-fg">Event</legend>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {events.map((ev) => (
                  <label key={ev} className="flex items-start gap-2 text-[11px] text-fg">
                    <input type="checkbox" name={`event:${ev}`} className="mt-0.5" defaultChecked={ev === 'message.received'} />
                    <span>
                      <code className="font-mono">{ev}</code>
                      <span className="block text-[10px] text-fg-muted">{EVENT_HINT[ev]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

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
            Tambah webhook
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
      {pending ? 'Menyimpan…' : 'Simpan'}
    </button>
  )
}
