'use client'

import { useActionState, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { addConnection, removeConnection, syncConnection, type ConnState } from '@/lib/actions/connections'
import { cn } from '@/lib/utils'

const input =
  'h-9 w-full rounded-md border bg-surface px-3 text-sm outline-none placeholder:text-fg-muted focus:border-accent'

export interface ConnectionRow {
  id: string
  name: string
  wabaId: string
  metaAppId: string | null
  verifyToken: string
  status: string
  graphVersion: string
  channelCount: number
  lastSyncAt: string | null
  lastError: string | null
}

export function Connections({
  rows,
  canManage,
  origin,
}: {
  rows: ConnectionRow[]
  canManage: boolean
  origin: string
}) {
  const [state, action] = useActionState<ConnState, FormData>(addConnection, {})
  const [open, setOpen] = useState(false)

  return (
    <div>
      <div className="overflow-hidden rounded-lg border bg-surface">
        {rows.length === 0 && (
          <p className="p-8 text-center text-xs text-fg-muted">
            Belum ada WABA terhubung. Tambahkan yang pertama di bawah.
          </p>
        )}
        {rows.map((c, i) => (
          <Row key={c.id} row={c} canManage={canManage} origin={origin} bordered={i > 0} />
        ))}
      </div>

      {state.error && <p className="mt-3 text-xs text-danger">{state.error}</p>}
      {state.ok && <p className="mt-3 text-xs text-ok">{state.ok}</p>}

      {canManage &&
        (open ? (
          <form action={action} className="mt-3 rounded-lg border bg-surface p-4">
            <h3 className="text-sm text-fg">Hubungkan WABA</h3>
            <p className="mt-1 mb-4 text-xs text-fg-muted">
              Kredensial diverifikasi ke Meta sebelum disimpan, dan nomor di bawah WABA ini
              ditarik otomatis.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nama koneksi" hint="Hanya untuk kamu.">
                <input name="name" required placeholder="WABA Divisi Sales" className={input} />
              </Field>
              <Field label="WhatsApp Business Account ID">
                <input name="wabaId" required placeholder="868891459412926" className={input} />
              </Field>
              <Field label="Meta App ID" hint="Opsional, untuk catatan.">
                <input name="metaAppId" placeholder="1403892334946632" className={input} />
              </Field>
              <Field label="Graph API version">
                <input name="graphVersion" defaultValue="v21.0" className={input} />
              </Field>

              <Field
                label="App secret"
                hint="Dari App Dashboard → Settings → Basic. Dipakai memverifikasi tanda tangan webhook."
              >
                <input
                  name="appSecret"
                  type="password"
                  required
                  placeholder="••••••••"
                  className={cn(input, 'font-mono')}
                />
              </Field>
              <Field
                label="Access token (API key)"
                hint="System User token, bukan token sementara dari Graph API Explorer."
              >
                <input
                  name="accessToken"
                  type="password"
                  required
                  placeholder="EAAG…"
                  className={cn(input, 'font-mono')}
                />
              </Field>
            </div>

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
            className="mt-3 h-9 rounded-md bg-fg px-3 text-sm text-white hover:opacity-90"
          >
            Hubungkan WABA
          </button>
        ))}
    </div>
  )
}

function Row({
  row,
  canManage,
  origin,
  bordered,
}: {
  row: ConnectionRow
  canManage: boolean
  origin: string
  bordered: boolean
}) {
  const [pending, start] = useTransition()
  const [copied, setCopied] = useState<'url' | 'token' | null>(null)
  const callback = `${origin}/webhooks/whatsapp/${row.id}`

  const copy = (text: string, what: 'url' | 'token') => {
    navigator.clipboard?.writeText(text)
    setCopied(what)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className={cn('p-4', bordered && 'border-t')}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] text-fg">{row.name}</span>
            <span
              className={cn(
                'rounded px-1.5 py-px text-[10px]',
                row.status === 'CONNECTED' ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn',
              )}
            >
              {row.status.toLowerCase()}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-fg-muted">
            WABA {row.wabaId}
            {row.metaAppId && ` · App ${row.metaAppId}`} · {row.graphVersion}
          </div>
        </div>

        <div className="hidden w-24 shrink-0 sm:block">
          <div className="text-[10px] text-fg-muted">Nomor</div>
          <div className="mt-0.5 text-xs text-fg">{row.channelCount}</div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            disabled={pending}
            onClick={() => start(() => void syncConnection(row.id))}
            className="rounded-md px-2 py-1 text-[11px] text-fg-muted hover:bg-muted hover:text-fg disabled:opacity-50"
            title="Tarik ulang daftar nomor dan quality rating dari Meta"
          >
            {pending ? '…' : 'Sinkron'}
          </button>
          {canManage && (
            <button
              disabled={pending}
              onClick={() => start(() => void removeConnection(row.id))}
              className="rounded-md px-2 py-1 text-[11px] text-fg-muted hover:text-danger disabled:opacity-50"
              title="Putuskan koneksi. Riwayat percakapan tetap tersimpan."
            >
              Putuskan
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1.5 rounded-md bg-muted p-2.5">
        <CopyRow label="Callback URL" value={callback} onCopy={() => copy(callback, 'url')} copied={copied === 'url'} />
        <CopyRow
          label="Verify token"
          value={row.verifyToken}
          onCopy={() => copy(row.verifyToken, 'token')}
          copied={copied === 'token'}
        />
        <p className="text-[10px] text-fg-muted">
          Paste keduanya di App Dashboard → WhatsApp → Configuration, lalu berlangganan field
          <code className="mx-1 font-mono">messages</code>.
        </p>
      </div>

      {row.lastError && <p className="mt-2 text-[11px] text-danger">{row.lastError}</p>}
      {row.lastSyncAt && !row.lastError && (
        <p className="mt-2 text-[10px] text-fg-muted">Disinkron {row.lastSyncAt}</p>
      )}
    </div>
  )
}

function CopyRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string
  value: string
  onCopy: () => void
  copied: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[10px] text-fg-muted">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">{value}</code>
      <button onClick={onCopy} className="shrink-0 text-[11px] text-accent hover:opacity-80">
        {copied ? 'Disalin' : 'Salin'}
      </button>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-xs text-fg">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] leading-4 text-fg-muted">{hint}</span>}
    </label>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className="h-9 rounded-md bg-fg px-3 text-sm text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Memverifikasi ke Meta…' : 'Verifikasi dan hubungkan'}
    </button>
  )
}
